"""Test penyusunan LLM → StructuredCV — AI-03.

Lima dokumen kontrol (PRD §13.4.4) menguji AC 2: tidak ada fakta baru
yang lolos dari LLM ke hasil. LLM dan cache DIINJEKSI sebagai palsu —
vendor sungguhan tanpa kunci tidak bisa diuji di CI, dan logika yang
bernilai justru keputusannya (kapan cache, kapan ulang, kapan hapus).

Test sinkron lewat asyncio.run: job pytest CI tidak punya plugin runner
async, dan menambah satu dependensi test demi ini tidak perlu.
"""

import asyncio
import json

import pytest

from app.core.cache import kunci_cache
from app.core.errors import GalatLayanan
from app.pipelines.llm import PemakaianLlm
from app.pipelines.structur import susun_cv
from app.prompts.ats_cv import (
    INSTRUKSI_PERBAIKAN,
    PROMPT_VERSION,
    SYSTEM_PROMPT_ATS_CV,
    buat_permintaan_pengguna,
)


class LlmPalsu:
    """Klien LLM yang mengembalikan antrian jawaban tetap."""

    def __init__(self, jawaban: list[str]) -> None:
        self.jawaban = list(jawaban)
        self.panggilan: list[tuple[str, str]] = []

    @property
    def model_nama(self) -> str:
        return "palsu-1"

    async def json(self, system: str, user: str, temperature: float):
        self.panggilan.append((system, user))
        teks = self.jawaban.pop(0)
        return teks, PemakaianLlm(model="palsu-1", input_tokens=100, output_tokens=len(teks) // 4)


class CacheDict:
    """Cache dua-langkah (ambil/simpan) dari dict — cukup untuk AC 1."""

    def __init__(self) -> None:
        self.isi: dict[str, str] = {}
        self.simpan_dipanggil = 0

    async def ambil(self, kunci: str) -> str | None:
        return self.isi.get(kunci)

    async def simpan(self, kunci: str, nilai: str) -> None:
        self.simpan_dipanggil += 1
        self.isi[kunci] = nilai


def cv_json(**ubah) -> str:
    dasar = {
        "nama": "Budi Santoso",
        "headline": None,
        "ringkasan": None,
        "kontak": {"email": "budi.santoso@yopmail.com", "telepon": None, "linkedin": None},
        "pengalaman": [
            {
                "posisi": "Software Engineer",
                "perusahaan": "PT Maju",
                "mulai": "Juni 2021",
                "selesai": None,
                "deskripsi": "Membangun API untuk 2 juta pengguna.",
            }
        ],
        "pendidikan": [
            {"gelar": "S1 Informatika", "institusi": "Universitas Gadjah Mada", "tahun": "2019"}
        ],
        "keterampilan": ["Python", "PostgreSQL"],
        "saran": True,
    }
    dasar.update(ubah)
    return json.dumps(dasar, ensure_ascii=False)


SUMBER_BUDI = (
    "Budi Santoso\nbudi.santoso@yopmail.com\n"
    "Software Engineer di PT Maju sejak Juni 2021. Membangun API untuk 2 juta "
    "pengguna.\nS1 Informatika, Universitas Gadjah Mada, lulus 2019.\n"
    "Keterampilan: Python, PostgreSQL."
)


# ── Lima dokumen kontrol (AC 2 / §13.4.4) ────────────────────────────────


def test_kontrol_1_keluaran_setia_utuh() -> None:
    hasil = asyncio.run(susun_cv(SUMBER_BUDI, LlmPalsu([cv_json()])))
    assert hasil.cv.nama == "Budi Santoso"
    assert len(hasil.cv.pengalaman) == 1
    assert hasil.cv.pengalaman[0].perusahaan == "PT Maju"
    assert hasil.cv.pendidikan[0].gelar == "S1 Informatika"
    assert hasil.cv.keterampilan == ["Python", "PostgreSQL"]
    assert hasil.temuan == []
    assert hasil.dari_cache is False


def test_kontrol_2_sumber_tanpa_pengalaman_tidak_dikarangi() -> None:
    """AC-CV-2: structured.experiences kosong — LLM tidak mengarang."""
    sumber_fresh = (
        "Rani Melati\nrani.melati@yopmail.com\nMahasiswa tingkat akhir.\n"
        "Keterampilan: analisis data."
    )
    jawaban = cv_json(
        nama="Rani Melati",
        kontak={"email": "rani.melati@yopmail.com", "telepon": None, "linkedin": None},
        pengalaman=[],
        pendidikan=[],
        keterampilan=["analisis", "data"],
    )
    hasil = asyncio.run(susun_cv(sumber_fresh, LlmPalsu([jawaban])))
    assert hasil.cv.pengalaman == []
    assert hasil.temuan == []


def test_kontrol_3_pengalaman_karangan_dihapus() -> None:
    karangan = {
        "posisi": "Chief Executive Officer",
        "perusahaan": "Google",
        "mulai": "2019",
        "selesai": "2023",
        "deskripsi": None,
    }
    hasil = asyncio.run(susun_cv(SUMBER_BUDI, LlmPalsu([cv_json(pengalaman=[karangan])])))
    assert hasil.cv.pengalaman == []
    assert any("Chief Executive Officer" in t.pesan for t in hasil.temuan)
    assert any(t.severity == "error" for t in hasil.temuan)


def test_kontrol_4_gelar_karangan_dihapus() -> None:
    hasil = asyncio.run(
        susun_cv(
            SUMBER_BUDI,
            LlmPalsu(
                [
                    cv_json(
                        pendidikan=[
                            {"gelar": "S2 Computer Science", "institusi": "MIT", "tahun": "2017"}
                        ]
                    )
                ]
            ),
        )
    )
    assert hasil.cv.pendidikan == []
    assert any("S2 Computer Science" in t.pesan for t in hasil.temuan)


def test_kontrol_5_skill_dan_angka_karangan_dihapus() -> None:
    jawaban = cv_json(
        ringkasan="Membangun API untuk 200 juta pengguna dengan Kubernetes.",
        keterampilan=["Python", "Kubernetes"],
    )
    hasil = asyncio.run(susun_cv(SUMBER_BUDI, LlmPalsu([jawaban])))
    assert hasil.cv.keterampilan == ["Python"]
    assert hasil.cv.ringkasan is None  # "200 juta" tidak ada di sumber (2 juta)
    assert any("Kubernetes" in t.pesan for t in hasil.temuan)
    assert any("Ringkasan" in t.pesan for t in hasil.temuan)
    # Yang jujur tetap hidup:
    assert len(hasil.cv.pengalaman) == 1


def test_headline_karangan_dihapus() -> None:
    """Headline ikut ditelusur (temuan audit AI-03): tanpa ini, satu-satunya
    teks bebas yang lolos tanpa pemeriksaan — tempat terbaik untuk injeksi."""
    hasil = asyncio.run(
        susun_cv(SUMBER_BUDI, LlmPalsu([cv_json(headline="Chief Technology Officer")]))
    )
    assert hasil.cv.headline is None
    assert any("Headline" in t.pesan for t in hasil.temuan)


def test_token_percobaan_gagal_tetap_tercatat() -> None:
    """Percobaan JSON gagal tetap dibayar vendor — akuntansi utuh."""
    llm = LlmPalsu(["bukan json", cv_json()])
    hasil = asyncio.run(susun_cv(SUMBER_BUDI, llm))
    assert hasil.pemakaian is not None
    assert hasil.pemakaian.input_tokens == 200  # 2 panggilan × 100



# ── AC 1: cache ──────────────────────────────────────────────────────────


def test_input_identik_tidak_menagih_llm_dua_kali() -> None:
    async def dua_kali():
        cache = CacheDict()
        llm = LlmPalsu([cv_json(), cv_json()])
        pertama = await susun_cv(SUMBER_BUDI, llm, cache=cache)
        kedua = await susun_cv(SUMBER_BUDI, llm, cache=cache)
        return cache, llm, pertama, kedua

    cache, llm, pertama, kedua = asyncio.run(dua_kali())
    assert pertama.dari_cache is False
    assert kedua.dari_cache is True
    assert kedua.cv == pertama.cv
    assert len(llm.panggilan) == 1  # panggilan kedua TIDAK terjadi
    assert cache.simpan_dipanggil == 1


def test_parameter_berbeda_cache_berbeda() -> None:
    async def dua_peran():
        cache = CacheDict()
        llm = LlmPalsu([cv_json(), cv_json()])
        await susun_cv(SUMBER_BUDI, llm, cache=cache, target_role="backend")
        await susun_cv(SUMBER_BUDI, llm, cache=cache, target_role="data")
        return llm

    assert len(asyncio.run(dua_peran()).panggilan) == 2


def test_prompt_version_memasuki_kunci_cache() -> None:
    a = kunci_cache("sumber", {"target_role": "", "bahasa": "id"}, PROMPT_VERSION)
    b = kunci_cache("sumber", {"target_role": "", "bahasa": "id"}, "ats-cv/lama")
    assert a != b


def test_cache_menyimpan_hasil_sudah_divalidasi() -> None:
    """Cache hit tidak boleh melompati penjaga: yang tersimpan hasil BERSIH."""

    async def jalan():
        cache = CacheDict()
        karangan = {
            "posisi": "Chief Executive Officer",
            "perusahaan": "Google",
            "mulai": None,
            "selesai": None,
            "deskripsi": None,
        }
        await susun_cv(SUMBER_BUDI, LlmPalsu([cv_json(pengalaman=[karangan])]), cache=cache)
        return await susun_cv(SUMBER_BUDI, LlmPalsu([]), cache=cache)

    kedua = asyncio.run(jalan())
    assert kedua.dari_cache is True
    assert kedua.cv.pengalaman == []


# ── Retry JSON (§12.3) ───────────────────────────────────────────────────


def test_json_rusak_dijawab_satu_percobaan_ulang() -> None:
    llm = LlmPalsu(["maaf, ini bukan json", cv_json()])
    hasil = asyncio.run(susun_cv(SUMBER_BUDI, llm))
    assert len(llm.panggilan) == 2
    assert INSTRUKSI_PERBAIKAN in llm.panggilan[1][1]
    assert hasil.cv.nama == "Budi Santoso"


def test_json_dibungkus_blok_kode_diterima_tanpa_retry() -> None:
    llm = LlmPalsu([f"```json\n{cv_json()}\n```"])
    hasil = asyncio.run(susun_cv(SUMBER_BUDI, llm))
    assert len(llm.panggilan) == 1
    assert hasil.cv.nama == "Budi Santoso"


def test_json_rusak_dua_kali_gagal_dengan_kode() -> None:
    llm = LlmPalsu(["bukan json", "masih bukan json"])
    with pytest.raises(GalatLayanan) as info:
        asyncio.run(susun_cv(SUMBER_BUDI, llm))
    assert info.value.code == "LLM_OUTPUT_INVALID"
    assert info.value.status == 422
    assert len(llm.panggilan) == 2  # tidak ada percobaan ketiga


# ── Prompt berversi (§13.4) ──────────────────────────────────────────────


def test_prompt_memuat_larangan_halusinasi_verbatim() -> None:
    assert "JANGAN menambahkan pengalaman, gelar, angka" in SYSTEM_PROMPT_ATS_CV


def test_prompt_version_berformat_domain_tanggal() -> None:
    assert PROMPT_VERSION.startswith("ats-cv/2")


def test_permintaan_membawa_sumber_dan_parameter() -> None:
    teks = buat_permintaan_pengguna("SUMBER-XYZ", target_role="backend", bahasa="en")
    assert "SUMBER-XYZ" in teks
    assert "backend" in teks
    assert "en" in teks
