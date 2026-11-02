"""`POST /v1/cv` — orkestrasi CV builder AI-07 (AI-02→AI-06 dirangkai).

Jalur dikunci konstanta `JALUR_AI` di sisi Node (isu #132); mengubah nama
rute ini sama dengan memutus Core API diam-diam.

Empat tahap, sesuai PRD §13.2, dalam SATU request:

1. Sumber teks — profil terstruktur (deterministik) atau dokumen unggahan
   (ekstraksi; penjaga #207 menyala di dalamnya).
2. `susun_cv` — LLM menyusun StructuredCV, cache-first, tervalidasi
   keterlacapan. Cache di redis; saat redis bermasalah cache JATUH
   TERBUKA (cache kosong = biaya, bukan kebenaran — lihat core/cache).
3. `nilai_ats` — skor deterministik, TANPA LLM: skor tidak boleh berubah
   untuk dokumen yang sama.
4. `render_cv` — PDF satu kolom, murni atas StructuredCV hasil tahap 2.

Balasan DATAR (bukan `usage` bersarang): `bacaHasil` di `ai-service.client.ts`
membaca enam kolom di level atas. `job_id` diterima sebagai bagian amplop
tapi tidak dipakai di sini: penulisan `ai_jobs` hanya di sisi Node (aturan 8).
"""

from __future__ import annotations

import base64
import binascii
import logging
from collections.abc import Callable
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core import cache as cache_mod
from app.core.auth import butuh_token_core
from app.core.errors import GalatLayanan
from app.pipelines.ats_score import TemuanAts, nilai_ats
from app.pipelines.extract import ProfilCv, Temuan, ekstrak_dokumen, susun_dari_profil
from app.pipelines.llm import LlmKlien, buat_klien_dari_settings
from app.pipelines.prompt_lab import COST_USD_BELUM_DIHITUNG
from app.pipelines.render import render_cv
from app.pipelines.structur import StructuredCV, susun_cv

router = APIRouter(prefix="/v1", tags=["cv"], dependencies=[Depends(butuh_token_core)])

_log = logging.getLogger(__name__)

# ── Permintaan ────────────────────────────────────────────────────────────


class BagianCv(BaseModel):
    """Bentuk `ai_jobs.input` untuk kind `ats_cv` — satu bentuk dengan
    `cvGenerateRequestSchema` di packages/contracts (Dev B pemilik keduanya).

    `source` menentukan field wajib: `profile` untuk "profile",
    `document_base64` untuk "upload". Pemeriksaan pasangan itu ada di
    handler (bukan validator model) supaya galatnya bertipe §10.1 dengan
    kode VALIDATION_ERROR, bukan 422 pydantic yang menyebut jalur field.
    """

    source: Literal["profile", "upload"]
    target_role: str = Field(default="", max_length=120)
    language: str = Field(default="id", min_length=2, max_length=8)
    profile: ProfilCv | None = None
    document_base64: str | None = None


class CvRequest(BaseModel):
    """Amplop permintaan — bentuk sama dengan rute AI lain (isu #132)."""

    job_id: UUID
    input: BagianCv


# ── Balasan ───────────────────────────────────────────────────────────────


class OutputCv(BaseModel):
    structured: StructuredCV
    ats_score: int
    ats_findings: list[TemuanAts]
    pdf_base64: str
    # Temuan pipeline NON-ATS digabung di satu slot: tata letak ekstraksi
    # (AI-02) + penghapusan keterlacapan (AI-03). Keduanya berbentuk sama
    # (severity, pesan) dan sama-sama "mengapa hasil begini" bagi pengguna.
    temuan_ekstraksi: list[Temuan]
    dari_cache: bool


class HasilCv(BaseModel):
    """Amplop DATAR untuk `bacaHasil` Node — pola `HasilPromptLab`."""

    output: OutputCv
    model: str
    prompt_version: str
    input_tokens: int
    output_tokens: int
    cost_usd: float


# ── Cache yang jatuh terbuka ──────────────────────────────────────────────


class CacheRedis:
    """AmbilSimpan di atas redis sungguhan.

    Kegagalan redis TIDAK menjatuhkan job: cache di sini murni penghemat
    biaya LLM (aturan keras 7 — isi cache turunan, bukan kebenaran), jadi
    saat redis mati rute tetap jalan tanpa cache dan memperingatkan sekali.
    """

    def __init__(self, redis: object) -> None:
        self._redis = redis
        self._sudah_waru = False

    async def ambil(self, kunci: str) -> str | None:
        try:
            return await cache_mod.ambil(self._redis, kunci)  # type: ignore[arg-type]
        except Exception:
            self._waru()
            return None

    async def simpan(self, kunci: str, nilai: str) -> None:
        try:
            await cache_mod.simpan(self._redis, kunci, nilai)  # type: ignore[arg-type]
        except Exception:
            self._waru()

    async def tutup(self) -> None:
        try:
            await self._redis.aclose()  # type: ignore[attr-defined]
        except Exception:
            pass

    def _waru(self) -> None:
        if not self._sudah_waru:
            self._sudah_waru = True
            _log.warning("cache CV tidak terjangkau — berjalan tanpa cache (biaya LLM penuh)")


def pabrik_klien_llm() -> Callable[[], LlmKlien]:
    # Pabrik, bukan klien jadi — alasan sama dengan routers/prompt.py:
    # 503 vendor tidak boleh mendahului 422 salah-bentuk badan.
    return buat_klien_dari_settings


def pabrik_cache() -> Callable[[], CacheRedis]:
    # Pabrik juga: redis dibangun per request dan ditutup di finally.
    def buat() -> CacheRedis:
        return CacheRedis(cache_mod.buat_redis())

    return buat


# ── Handler ───────────────────────────────────────────────────────────────


@router.post("/cv", response_model=HasilCv)
async def jalankan_cv(
    job: CvRequest,
    pabrik: Callable[[], LlmKlien] = Depends(pabrik_klien_llm),
    pabrik_tembolok: Callable[[], CacheRedis] = Depends(pabrik_cache),
) -> HasilCv:
    bagian = job.input

    temuan_ekstraksi: list[Temuan] = []
    if bagian.source == "profile":
        if bagian.profile is None:
            raise GalatLayanan(
                422, "VALIDATION_ERROR", "source 'profile' wajib memuat field profile."
            )
        teks = susun_dari_profil(bagian.profile)
    else:
        if not bagian.document_base64:
            raise GalatLayanan(
                422, "VALIDATION_ERROR", "source 'upload' wajib memuat field document_base64."
            )
        try:
            dokumen = base64.b64decode(bagian.document_base64, validate=True)
        except (binascii.Error, ValueError) as ex:
            raise GalatLayanan(422, "VALIDATION_ERROR", "document_base64 bukan base64 sah.") from ex
        hasil_ekstrak = ekstrak_dokumen(dokumen)
        teks = hasil_ekstrak.teks
        temuan_ekstraksi = list(hasil_ekstrak.temuan)

    tembolok = pabrik_tembolok()
    try:
        # Pabrik dikirim APA ADANYA: susun_cv hanya memanggilnya saat cache
        # miss, jadi 503 kunci vendor kosong tidak mendahului cache hit
        # (audit AI-07 — jawaban tersimpan tetap terlayani).
        susunan = await susun_cv(
            teks,
            pabrik,
            cache=tembolok,
            target_role=bagian.target_role,
            bahasa=bagian.language,
        )
    finally:
        await tembolok.tutup()

    temuan_ekstraksi.extend(
        Temuan(severity=t.severity, pesan=t.pesan) for t in susunan.temuan
    )
    skor = nilai_ats(susunan.cv)
    pdf = base64.b64encode(render_cv(susunan.cv)).decode()

    pakai = susunan.pemakaian
    return HasilCv(
        output=OutputCv(
            structured=susunan.cv,
            ats_score=skor.skor,
            ats_findings=skor.temuan,
            pdf_base64=pdf,
            temuan_ekstraksi=temuan_ekstraksi,
            dari_cache=susunan.dari_cache,
        ),
        model=susunan.model,
        prompt_version=susunan.prompt_version,
        input_tokens=pakai.input_tokens if pakai else 0,
        output_tokens=pakai.output_tokens if pakai else 0,
        cost_usd=COST_USD_BELUM_DIHITUNG,
    )
