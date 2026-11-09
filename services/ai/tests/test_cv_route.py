"""Test `POST /v1/cv` — orkestrasi AI-07: ekstrak → susun → skor → render.

LLM dan cache DIINJEKSI sebagai palsu (pola test_prompt_lab.py): vendor
tanpa kunci tidak bisa diuji di CI. Yang dikunci test ini adalah keputusan
jahitan rute — amplop DATAR untuk `bacaHasil` Node, cache-first (AC CV-1),
temuan ekstraksi + keterlacakan sampai ke pemanggil, dan penolakan dokumen
dengan kode §10.2 yang bisa diteruskan ke pengguna (isu #197).
"""

import base64
import binascii
import io
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

from app.core.errors import GalatLayanan
from app.main import app
from app.pipelines.extract import ekstrak_dokumen
from app.pipelines.llm import PemakaianLlm
from app.prompts.ats_cv import PROMPT_VERSION
from app.routers.cv import pabrik_cache, pabrik_klien_llm

client = TestClient(app)

JOB_ID = "22222222-2222-4222-8222-222222222222"


def buat_pdf_budi() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, 842))
    baris = [
        "Budi Santoso",
        "budi.santoso@yopmail.com",
        "Pengalaman kerja:",
        "Software Engineer PT Maju 2021-06 sampai 2024-02",
        "Membangun API pembayaran untuk 2 juta pengguna aktif",
        "Menulis 40 unit test dan menurunkan bug produksi 30 persen",
        "Keterampilan: Python TypeScript PostgreSQL Redis",
    ]
    y = 780
    for baris in baris:
        c.drawString(72, y, baris)
        y -= 24
    c.save()
    return buf.getvalue()


def cv_json_budi() -> dict[str, Any]:
    """StructuredCV yang SELURUH itemnya tertelusur ke buat_pdf_budi.

    Satu keterampilan sengaja tidak ada di sumber (Kubernetes) — penghapusan
    keterlacakan (CV-4) harus terlihat di keluaran rute, bukan ditelen.
    """
    return {
        "nama": "Budi Santoso",
        "headline": "Software Engineer",
        "kontak": {"email": "budi.santoso@yopmail.com"},
        "pengalaman": [
            {
                "posisi": "Software Engineer",
                "perusahaan": "PT Maju",
                "mulai": "2021-06",
                "selesai": "2024-02",
                "deskripsi": "Membangun API pembayaran untuk 2 juta pengguna aktif",
            }
        ],
        "pendidikan": [],
        "keterampilan": ["Python", "TypeScript", "PostgreSQL", "Redis", "Kubernetes"],
    }


class LlmJsonPalsu:
    """Klien json-palsu; argumen dan jumlah panggilan dicatat."""

    def __init__(self, jawaban: str | Exception = "") -> None:
        self.jawaban = jawaban
        self.panggilan: list[dict[str, Any]] = []

    @property
    def model_nama(self) -> str:
        return "palsu-mini"

    async def json(
        self, system: str, user: str, temperature: float
    ) -> tuple[str, PemakaianLlm]:
        self.panggilan.append({"system": system, "user": user, "temperature": temperature})
        if isinstance(self.jawaban, Exception):
            raise self.jawaban
        if not self.jawaban:
            return json.dumps(cv_json_budi()), PemakaianLlm(
                model="palsu-mini", input_tokens=210, output_tokens=96
            )
        return self.jawaban, PemakaianLlm(model="palsu-mini", input_tokens=210, output_tokens=96)


class CachePalsu:
    """AmbilSimpan dari dict; kunci yang disimpan dicatat."""

    def __init__(self, isi: dict[str, str] | None = None) -> None:
        self.data: dict[str, str] = dict(isi or {})
        self.kunci_disimpan: list[str] = []

    async def ambil(self, kunci: str) -> str | None:
        return self.data.get(kunci)

    async def simpan(self, kunci: str, nilai: str) -> None:
        self.data[kunci] = nilai
        self.kunci_disimpan.append(kunci)

    async def tutup(self) -> None:
        return None


def body(isi: dict[str, Any]) -> dict[str, Any]:
    return {"job_id": JOB_ID, "input": isi}


def input_upload(dokumen: bytes = b"", **ganti: Any) -> dict[str, Any]:
    isi = {
        "source": "upload",
        "target_role": "Backend Engineer",
        "language": "id",
        "document_base64": base64.b64encode(dokumen or buat_pdf_budi()).decode(),
    }
    isi.update(ganti)
    return isi


@pytest.fixture
def llm_palsu() -> LlmJsonPalsu:
    palsu = LlmJsonPalsu()
    app.dependency_overrides[pabrik_klien_llm] = lambda: (lambda: palsu)
    yield palsu
    app.dependency_overrides.pop(pabrik_klien_llm, None)


@pytest.fixture
def cache_palsu() -> CachePalsu:
    palsu = CachePalsu()
    app.dependency_overrides[pabrik_cache] = lambda: (lambda: palsu)
    yield palsu
    app.dependency_overrides.pop(pabrik_cache, None)


def jalankan(isi: dict[str, Any], token: str) -> Any:
    return client.post(
        "/v1/cv", json=body(isi), headers={"Authorization": f"Bearer {token}"}
    )


# ── Skema permintaan ──────────────────────────────────────────────────────


def test_source_hilang_ditolak(token_terpasang: str) -> None:
    hasil = jalankan({"target_role": "Backend"}, token_terpasang)
    assert hasil.status_code == 422
    assert hasil.json()["error"]["code"] == "VALIDATION_ERROR"


def test_upload_tanpa_dokumen_ditolak(token_terpasang: str) -> None:
    hasil = jalankan({"source": "upload"}, token_terpasang)
    assert hasil.status_code == 422


def test_profile_tanpa_profil_ditolak(token_terpasang: str) -> None:
    hasil = jalankan({"source": "profile"}, token_terpasang)
    assert hasil.status_code == 422


def test_base64_tidak_sah_ditolak(token_terpasang: str) -> None:
    # Node sudah mendekode untuk cap 7 MB; yang sampai di sini seharusnya
    # sah — tapi kunci bersama tidak berarti Node satu-satunya penulis.
    hasil = jalankan({"source": "upload", "document_base64": "@@ bukan base64 @@"}, token_terpasang)
    assert hasil.status_code == 422
    assert hasil.json()["error"]["code"] == "VALIDATION_ERROR"


def test_galat_validasi_tidak_menggema_input(token_terpasang: str) -> None:
    # Audit AI-07 temuan 2: pydantic v2 menyertakan `input` (nilai mentah
    # permintaan, bisa seluruh teks CV) di tiap butir errors(). Respons 422
    # hanya boleh membawa kunci putih — nilai mentah tidak boleh tergema.
    penanda = "RAHASIA-PENANDA-951"
    hasil = jalankan({"source": "upload", "target_role": {"nilai": penanda}}, token_terpasang)
    assert hasil.status_code == 422
    assert penanda not in hasil.text
    for butir in hasil.json()["error"]["details"]["errors"]:
        assert set(butir) <= {"type", "loc", "msg", "ctx"}


# ── Jalur bahagia: upload ─────────────────────────────────────────────────


def test_run_upload_amplop_datar_untuk_node(
    token_terpasang: str, llm_palsu: LlmJsonPalsu, cache_palsu: CachePalsu
) -> None:
    hasil = jalankan(input_upload(), token_terpasang)
    assert hasil.status_code == 200
    isi = hasil.json()
    # Kontrak `bacaHasil` Node: enam kolom DI LEVEL ATAS, bukan bersarang.
    assert set(isi) == {
        "output",
        "model",
        "prompt_version",
        "input_tokens",
        "output_tokens",
        "cost_usd",
    }
    assert isi["model"] == "palsu-mini"
    assert isi["prompt_version"] == PROMPT_VERSION
    assert isi["input_tokens"] == 210
    assert isi["output_tokens"] == 96
    assert isinstance(isi["cost_usd"], (int, float))

    keluar = isi["output"]
    assert set(keluar) == {
        "structured",
        "ats_score",
        "ats_findings",
        "pdf_base64",
        "temuan_ekstraksi",
        "dari_cache",
    }
    assert keluar["structured"]["nama"] == "Budi Santoso"
    assert keluar["dari_cache"] is False
    assert isinstance(keluar["ats_score"], int) and 0 <= keluar["ats_score"] <= 100
    assert isinstance(keluar["ats_findings"], list)
    # PDF benar-benar PDF — render di server, bukan janji.
    assert base64.b64decode(keluar["pdf_base64"]).startswith(b"%PDF")


def test_temuan_keterlacakan_sampai_ke_pemanggil(
    token_terpasang: str, llm_palsu: LlmJsonPalsu, cache_palsu: CachePalsu
) -> None:
    hasil = jalankan(input_upload(), token_terpasang)
    keluar = hasil.json()["output"]
    # Kubernetes tidak ada di sumber: dihapus dari structured + temuan menyebutnya.
    assert "Kubernetes" not in keluar["structured"]["keterampilan"]
    assert any("Kubernetes" in t["pesan"] for t in keluar["temuan_ekstraksi"])


def test_temuan_ekstraksi_dua_kolom_sampai_ke_pemanggil(
    token_terpasang: str, llm_palsu: LlmJsonPalsu, cache_palsu: CachePalsu
) -> None:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, 842))
    c.setFont("Helvetica", 10)
    kiri = ["Kiri pengalaman kerja satu", "Kiri pengalaman kerja dua", "Kiri pengalaman tiga"]
    kanan = ["Kanan pendidikan gelar sarjana", "Kanan sertifikasi AWS", "Kanan kontak email"]
    y = 780
    for i in range(3):
        c.drawString(40, y, kiri[i])
        c.drawString(330, y, kanan[i])
        y -= 24
    c.save()
    hasil = jalankan(input_upload(buf.getvalue()), token_terpasang)
    keluar = hasil.json()["output"]
    assert any("dua kolom" in t["pesan"].lower() for t in keluar["temuan_ekstraksi"])


# ── Jalur bahagia: profil ─────────────────────────────────────────────────


def test_run_profile_berhasil(
    token_terpasang: str, llm_palsu: LlmJsonPalsu, cache_palsu: CachePalsu
) -> None:
    profil = {
        "nama": "Rina Melati",
        "headline": "Backend engineer yang suka sistem terdistribusi",
        "kontak": {"email": "rina.melati@yopmail.com"},
        "pengalaman": [
            {
                "posisi": "Backend Engineer",
                "perusahaan": "PT Nusantara Digital",
                "mulai": "2022-03",
                "selesai": "2025-08",
                "deskripsi": "Merancang layanan pembayaran dengan throughput 500 rps.",
            }
        ],
        "pendidikan": [{"gelar": "S1 Informatika", "institusi": "Universitas Gadjah Mada"}],
        "keterampilan": ["Go", "PostgreSQL", "Kafka"],
    }
    # LLM palsu harus menjawab CV yang tertelusur ke teks profil.
    cv_profil = {
        "nama": "Rina Melati",
        "pengalaman": [
            {"posisi": "Backend Engineer", "perusahaan": "PT Nusantara Digital"}
        ],
        "pendidikan": [{"gelar": "S1 Informatika", "institusi": "Universitas Gadjah Mada"}],
        "keterampilan": ["Go", "PostgreSQL", "Kafka"],
    }
    llm_palsu.jawaban = json.dumps(cv_profil)
    hasil = jalankan({"source": "profile", "profile": profil}, token_terpasang)
    assert hasil.status_code == 200
    keluar = hasil.json()["output"]
    assert keluar["structured"]["nama"] == "Rina Melati"
    assert keluar["dari_cache"] is False


# ── Cache-first (AC CV-1) ─────────────────────────────────────────────────


def kunci_untuk_budi(target_role: str, bahasa: str) -> str:
    from app.core.cache import kunci_cache

    teks = ekstrak_dokumen(buat_pdf_budi()).teks
    return kunci_cache(teks, {"target_role": target_role, "bahasa": bahasa}, PROMPT_VERSION)


def test_cache_hit_tidak_memanggil_llm(
    token_terpasang: str, llm_palsu: LlmJsonPalsu, cache_palsu: CachePalsu
) -> None:
    from app.pipelines.structur import StructuredCV

    kunci = kunci_untuk_budi("Backend Engineer", "id")
    cache_palsu.data[kunci] = json.dumps(
        {"model": "palsu-mini", "cv": StructuredCV.model_validate(cv_json_budi()).model_dump()}
    )
    hasil = jalankan(input_upload(), token_terpasang)
    assert hasil.status_code == 200
    isi = hasil.json()
    assert isi["output"]["dari_cache"] is True
    # AC CV-1: input identik tidak menagih biaya LLM dua kali.
    assert llm_palsu.panggilan == []
    assert isi["input_tokens"] == 0
    assert isi["output_tokens"] == 0


def test_cache_hit_tanpa_klien_vendor(token_terpasang: str, cache_palsu: CachePalsu) -> None:
    # Audit AI-07: pabrik klien yang melempar 503 (kunci vendor kosong) tidak
    # boleh mendahului cache hit — jawaban tersimpan tetap terlayani tanpa
    # menyentuh vendor sama sekali.
    from app.pipelines.structur import StructuredCV

    def pabrik_melempar():
        raise GalatLayanan(503, "PROVIDER_UNAVAILABLE", "kunci vendor kosong")

    app.dependency_overrides[pabrik_klien_llm] = lambda: pabrik_melempar
    try:
        kunci = kunci_untuk_budi("Backend Engineer", "id")
        cache_palsu.data[kunci] = json.dumps(
            {"model": "palsu-mini", "cv": StructuredCV.model_validate(cv_json_budi()).model_dump()}
        )
        hasil = jalankan(input_upload(), token_terpasang)
    finally:
        app.dependency_overrides.pop(pabrik_klien_llm, None)
    assert hasil.status_code == 200
    isi = hasil.json()
    assert isi["output"]["dari_cache"] is True
    assert isi["model"] == "palsu-mini"


def test_cache_miss_menyimpan_dan_memanggil_llm_sekali(
    token_terpasang: str, llm_palsu: LlmJsonPalsu, cache_palsu: CachePalsu
) -> None:
    hasil = jalankan(input_upload(), token_terpasang)
    assert hasil.status_code == 200
    assert llm_palsu.panggilan, "cache kosong wajib memanggil LLM"
    assert len(llm_palsu.panggilan) == 1, "jawaban sah tidak boleh memicu percobaan kedua"
    assert cache_palsu.kunci_disimpan, "hasil wajib disimpan untuk pemanggilan berikutnya"


# ── Penolakan dengan kode §10.2 (isu #197) ────────────────────────────────


def test_dokumen_bukan_pdf_docx_415(
    token_terpasang: str, llm_palsu: LlmJsonPalsu, cache_palsu: CachePalsu
) -> None:
    hasil = jalankan(input_upload(b"<html><body>ini bukan dokumen</body></html>"), token_terpasang)
    assert hasil.status_code == 415
    assert hasil.json()["error"]["code"] == "UNSUPPORTED_FILE_TYPE"
    assert llm_palsu.panggilan == []


def test_llm_json_salah_dua_kali_422(
    token_terpasang: str, llm_palsu: LlmJsonPalsu, cache_palsu: CachePalsu
) -> None:
    llm_palsu.jawaban = "bukan-json"
    hasil = jalankan(input_upload(), token_terpasang)
    assert hasil.status_code == 422
    assert hasil.json()["error"]["code"] == "LLM_OUTPUT_INVALID"
    # Maksimal DUA panggilan: satu jawaban + satu instruksi perbaikan.
    assert len(llm_palsu.panggilan) == 2


def test_galat_vendor_menjalar_bentuk_101(
    token_terpasang: str, cache_palsu: CachePalsu
) -> None:
    palsu = LlmJsonPalsu(GalatLayanan(502, "PROVIDER_UNAVAILABLE", "vendor timeout"))
    app.dependency_overrides[pabrik_klien_llm] = lambda: (lambda: palsu)
    try:
        hasil = jalankan(input_upload(), token_terpasang)
    finally:
        app.dependency_overrides.pop(pabrik_klien_llm, None)
    assert hasil.status_code == 502
    assert hasil.json()["error"]["code"] == "PROVIDER_UNAVAILABLE"


def test_tanpa_token_401() -> None:
    hasil = client.post("/v1/cv", json=body(input_upload(b"%PDF-1.4 kosong")))
    assert hasil.status_code == 401
    assert hasil.json()["error"]["code"] == "UNAUTHENTICATED"


def test_binascii_error_tertangani() -> None:
    # Penjaga regresi: dekodegagal harus jadi GalatLayanan, bukan 500.
    with pytest.raises((binascii.Error, ValueError)):
        base64.b64decode("@@ bukan base64 @@", validate=True)
