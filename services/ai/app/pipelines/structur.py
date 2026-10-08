"""Penyusunan teks mentah → StructuredCV — AI-03 (Dev B), PRD §13.2 tahap 4.

Dua acceptance criteria item ini tinggal di file ini:

  AC 1: "Input identik tidak menagih biaya LLM dua kali." — cache SHA-256
        (AI-01) diperiksa SEBELUM memanggil LLM; kunci memuat
        (sumber, target_role, bahasa, prompt_version) — CV-5.
  AC 2: "LLM tidak pernah menambahkan pengalaman/gelar/angka yang tidak ada
        di sumber." — BUKAN sekadar doa di prompt: `validasi_keterlacakan`
        memeriksa tiap item keluaran terhadap teks sumber dan MENGHAPUS
        yang tak terlacak, dengan temuan yang menjelaskannya (CV-4).

Pembagian tugas yang sama dengan AI-02/AI-04: LLM MENULIS, kode MENILAI.
Hasil yang DISIMPAN di cache adalah hasil SETELAH validasi — cache hit
tidak melompati penjaga.
"""

from __future__ import annotations

import json
import re
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field, ValidationError

from app.core.cache import kunci_cache
from app.core.errors import GalatLayanan
from app.pipelines.llm import LlmKlien, PemakaianLlm, TEMPERATURE_PENYUSUNAN
from app.prompts.ats_cv import (
    INSTRUKSI_PERBAIKAN,
    PROMPT_VERSION,
    SYSTEM_PROMPT_ATS_CV,
    buat_permintaan_pengguna,
)

# ── Bentuk keluaran ───────────────────────────────────────────────────────


class KontakCv(BaseModel):
    email: str | None = None
    telepon: str | None = None
    linkedin: str | None = None


class PengalamanCv(BaseModel):
    posisi: str
    perusahaan: str | None = None
    mulai: str | None = None
    selesai: str | None = None
    deskripsi: str | None = None


class PendidikanCv(BaseModel):
    gelar: str
    institusi: str | None = None
    tahun: str | None = None


class StructuredCV(BaseModel):
    """Kunci bahasa Indonesia — satu bentuk dengan ProfilCv AI-02."""

    nama: str | None = None
    headline: str | None = None
    ringkasan: str | None = None
    kontak: KontakCv = Field(default_factory=KontakCv)
    pengalaman: list[PengalamanCv] = Field(default_factory=list)
    pendidikan: list[PendidikanCv] = Field(default_factory=list)
    keterampilan: list[str] = Field(default_factory=list)
    # §13.4.5: output selalu ditandai sebagai SARAN, bukan penilaian resmi.
    saran: bool = True


class TemuanKeterlacakan(BaseModel):
    severity: Literal["error", "warning", "info"]
    pesan: str


class HasilSusun(BaseModel):
    cv: StructuredCV
    temuan: list[TemuanKeterlacakan] = Field(default_factory=list)
    prompt_version: str
    model: str
    pemakaian: PemakaianLlm | None = None
    dari_cache: bool = False


# ── Normalisasi untuk penelusuran ─────────────────────────────────────────

_HURUF_ANGKA = re.compile(r"[a-z0-9]+", re.UNICODE)
# Hanya angka >= 3 digit (tahun, jumlah besar): "06" bisa muncul dari
# NORMALISASI tanggal (2021-06) padahal sumber menulis "Juni 2021" —
# membunuh konten jujur lebih buruk daripada melepas angka dua digit.
_ANGKA = re.compile(r"\d{3,}")


def _token(teks: str) -> set[str]:
    """Token alfanumerik lowercase; kata hubung pendek ikut agar 'go'
    tetap bisa dilacak jujur (skill satu kata itu sah)."""
    return set(_HURUF_ANGKA.findall(teks.casefold()))


def _semua_ada(token_item: set[str], token_sumber: set[str]) -> bool:
    """Semua token item (termasuk yang pendek) ada di sumber."""
    return token_item.issubset(token_sumber)


def _angka_ada(teks_item: str, token_sumber: set[str]) -> bool:
    """Setiap ANGKA di item harus hadir sebagai angka di sumber — angka
    adalah klaim terukur (CV-4: 'angka harus bisa ditelusuri')."""
    for angka in _ANGKA.findall(teks_item):
        if angka not in token_sumber:
            return False
    return True


def _tampil(teks: str) -> str:
    return teks if len(teks) <= 48 else teks[:45] + "…"


# ── AC 2: validasi keterlacakan ───────────────────────────────────────────


def validasi_keterlacakan(sumber: str, cv: StructuredCV) -> tuple[StructuredCV, list[TemuanKeterlacakan]]:
    """Hapus item keluaran yang tidak tertelusur ke sumber + catat temuan.

    Aturan per bagian:
    - pengalaman: posisi DAN perusahaan (bila ada) tertelusur; angka pada
      seluruh item (tahun, bulan, deskripsi) hadir di sumber.
    - pendidikan: gelar DAN institusi (bila ada) tertelusur.
    - keterampilan: seluruh token skill hadir.
    - kontak: email/telepon/linkedin hadir hampir harfiah.
    - nama: token hadir.
    - ringkasan: ANGKA apa pun di ringkasan harus hadir di sumber; kalau
      tidak, ringkasan dibuang utuh (angka bohong di paragraf paling atas
      adalah tempat terburuk untuk berbohong).
    Item yang tak lolos DIHAPUS, bukan dipercaya — pengguna tidak perlu
    membaca saran yang ternyata karangan.
    """
    tok_sumber = _token(sumber)
    temuan: list[TemuanKeterlacakan] = []

    pengalaman: list[PengalamanCv] = []
    for p in cv.pengalaman:
        butir = f"{p.posisi} {p.perusahaan or ''} {p.mulai or ''} {p.selesai or ''} {p.deskripsi or ''}"
        if _semua_ada(_token(p.posisi), tok_sumber) and _semua_ada(
            _token(p.perusahaan or ""), tok_sumber
        ):
            if _angka_ada(butir, tok_sumber):
                pengalaman.append(p)
                continue
        temuan.append(
            TemuanKeterlacakan(
                severity="error",
                pesan=f"Pengalaman '{_tampil(p.posisi)}' dihapus: tidak tertelusur ke sumber (CV-4).",
            )
        )

    pendidikan: list[PendidikanCv] = []
    for d in cv.pendidikan:
        butir = f"{d.gelar} {d.institusi or ''} {d.tahun or ''}"
        if _semua_ada(_token(d.gelar), tok_sumber) and _semua_ada(
            _token(d.institusi or ""), tok_sumber
        ):
            if _angka_ada(butir, tok_sumber):
                pendidikan.append(d)
                continue
        temuan.append(
            TemuanKeterlacakan(
                severity="error",
                pesan=f"Pendidikan '{_tampil(d.gelar)}' dihapus: tidak tertelusur ke sumber (CV-4).",
            )
        )

    keterampilan: list[str] = []
    for k in cv.keterampilan:
        if _semua_ada(_token(k), tok_sumber):
            keterampilan.append(k)
        else:
            temuan.append(
                TemuanKeterlacakan(
                    severity="warning",
                    pesan=f"Keterampilan '{_tampil(k)}' dihapus: tidak ada di sumber.",
                )
            )

    kontak = KontakCv(
        email=cv.kontak.email if (cv.kontak.email and _semua_ada(_token(cv.kontak.email), tok_sumber)) else None,
        telepon=(
            cv.kontak.telepon
            if (cv.kontak.telepon and _semua_ada(_token(cv.kontak.telepon), tok_sumber))
            else None
        ),
        linkedin=(
            cv.kontak.linkedin
            if (cv.kontak.linkedin and _semua_ada(_token(cv.kontak.linkedin), tok_sumber))
            else None
        ),
    )

    nama = cv.nama if (cv.nama and _semua_ada(_token(cv.nama), tok_sumber)) else None
    if cv.nama and nama is None:
        temuan.append(
            TemuanKeterlacakan(severity="warning", pesan="Nama dihapus: tidak ada di sumber.")
        )

    ringkasan = cv.ringkasan
    if ringkasan and not _angka_ada(ringkasan, tok_sumber):
        ringkasan = None
        temuan.append(
            TemuanKeterlacakan(
                severity="error",
                pesan="Ringkasan dihapus: memuat angka yang tidak ada di sumber.",
            )
        )

    bersih = StructuredCV(
        nama=nama,
        headline=cv.headline,
        ringkasan=ringkasan,
        kontak=kontak,
        pengalaman=pengalaman,
        pendidikan=pendidikan,
        keterampilan=keterampilan,
        saran=True,
    )
    return bersih, temuan


# ── Cache tipis (diinjeksi; redis sungguhan lewat core/cache) ────────────


class AmbilSimpan(Protocol):
    """Satu pintu cache — redis sungguhan atau dict test."""

    async def ambil(self, kunci: str) -> str | None: ...

    async def simpan(self, kunci: str, nilai: str) -> None: ...


# ── AC 1 + orkestrasi ─────────────────────────────────────────────────────


async def susun_cv(
    sumber: str,
    llm: LlmKlien,
    cache: AmbilSimpan | None = None,
    target_role: str = "",
    bahasa: str = "id",
) -> HasilSusun:
    """Teks sumber → StructuredCV tervalidasi. Cache-first (AC 1).

    Panggilan LLM maksimal DUA: JSON tidak valid dijawab satu kali dengan
    instruksi perbaikan, lalu gagal dengan 422 `LLM_OUTPUT_INVALID`
    (§12.3; kode di luar §10.2 — dicatat di #197 untuk batas klien).
    """
    parameter: dict[str, Any] = {"target_role": target_role, "bahasa": bahasa}
    kunci = kunci_cache(sumber, parameter, PROMPT_VERSION)

    if cache is not None:
        tersimpan = await cache.ambil(kunci)
        if tersimpan is not None:
            cv = StructuredCV.model_validate_json(tersimpan)
            return HasilSusun(
                cv=cv,
                prompt_version=PROMPT_VERSION,
                model=llm.model_nama,
                dari_cache=True,
            )

    permintaan = buat_permintaan_pengguna(sumber, target_role=target_role, bahasa=bahasa)
    pemakaian: PemakaianLlm | None = None
    cv: StructuredCV | None = None
    galat_terakhir: Exception | None = None

    for percobaan, tambahan in enumerate(("", INSTRUKSI_PERBAIKAN)):
        try:
            teks, pakai = await llm.json(
                SYSTEM_PROMPT_ATS_CV,
                permintaan + tambahan,
                TEMPERATURE_PENYUSUNAN,
            )
            pemakaian = pakai
            cv = StructuredCV.model_validate(muat_json(teks))
            galat_terakhir = None
            break
        except (ValidationError, ValueError) as ex:
            galat_terakhir = ex

    if cv is None:
        raise GalatLayanan(
            422,
            "LLM_OUTPUT_INVALID",
            "Model tidak menghasilkan JSON yang diminta setelah 1 percobaan ulang "
            f"({type(galat_terakhir).__name__}).",
        )

    bersih, temuan = validasi_keterlacakan(sumber, cv)

    if cache is not None:
        await cache.simpan(kunci, bersih.model_dump_json())

    return HasilSusun(
        cv=bersih,
        temuan=temuan,
        prompt_version=PROMPT_VERSION,
        model=llm.model_nama,
        pemakaian=pemakaian,
        dari_cache=False,
    )


def muat_json(teks: str) -> dict[str, Any]:
    """Parse JSON longgar: model kadang membungkus dengan ```json ... ```."""
    try:
        return json.loads(teks)
    except json.JSONDecodeError:
        potong = re.search(r"\{.*\}", teks, re.DOTALL)
        if potong:
            return json.loads(potong.group(0))
        raise
