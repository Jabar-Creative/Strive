"""Test skor ATS deterministik — AI-04, aturan PRD §13.3.

Satu test per aturan (penalti + severity), dua AC item (dokumen sama →
skor sama persis; tanggal 'Jan 2024' → error menyebut YYYY-MM = AC-CV-3),
plus clamp bawah di 0. Semua murni — nol I/O, nol LLM.
"""

import pytest

from app.pipelines.ats_score import nilai_ats
from app.pipelines.structur import (
    KontakCv,
    PendidikanCv,
    PengalamanCv,
    StructuredCV,
)

RINGKASAN_30_KATA = (
    "Data engineer yang membangun pipeline data andal untuk 500 juta baris "
    "per hari dengan dbt dan Airflow, menurunkan waktu proses menjadi "
    "seperempatnya sejak tahun ini."
)


def cv_sehat() -> StructuredCV:
    """CV nyaris tanpa pelanggaran — baseline untuk mengukur penalti satu aturan."""
    return StructuredCV(
        nama="Farhan Aditya",
        ringkasan=RINGKASAN_30_KATA,
        kontak=KontakCv(email="farhan.aditya@yopmail.com", telepon="0812 3456 7890"),
        pengalaman=[
            PengalamanCv(
                posisi="Data Engineer",
                perusahaan="Bank Nusa",
                mulai="2022-01",
                selesai="2024-06",
                deskripsi="Membangun pipeline 500 juta baris. Mengurangi biaya 40 persen.",
            )
        ],
        pendidikan=[PendidikanCv(gelar="S1 Statistika", institusi="IPB", tahun="2021-06")],
        keterampilan=["SQL", "Airflow", "dbt", "Python", "Spark"],
    )


def penalti(hasil, aturan: str) -> int:
    return sum(t.penalti for t in hasil.temuan if t.aturan == aturan)


def aturan(hasil, nama: str):
    return [t for t in hasil.temuan if t.aturan == nama]


# ── Baseline ─────────────────────────────────────────────────────────────


def test_cv_sehat_skor_100() -> None:
    hasil = nilai_ats(cv_sehat())
    assert hasil.skor == 100, [t.pesan for t in hasil.temuan]
    assert hasil.temuan == []


# ── Satu aturan satu test ────────────────────────────────────────────────


def test_email_hilang_atau_tidak_valid() -> None:
    for email in (None, "bukan-email", "a@b"):
        cv = cv_sehat()
        cv.kontak = KontakCv(email=email, telepon="0812")
        hasil = nilai_ats(cv)
        assert penalti(hasil, "email") == 20
        assert aturan(hasil, "email")[0].severity == "error"
    # Email sah tidak dihukum.
    cv = cv_sehat()
    cv.kontak = KontakCv(email="a.b@yopmail.co.id", telepon="0812")
    assert penalti(nilai_ats(cv), "email") == 0


def test_email_melebihi_254_karakter_ditolak_tanpa_regex() -> None:
    """Guard panjang (temuan audit AI-04): POLA_EMAIL backtracks kuadratik
    atas string berpola titik — email 300 karakter berpola itu harus
    dihukum INSTAN, bukan lewat regex (vonisnya sama: tidak sah)."""
    cv = cv_sehat()
    cv.kontak = KontakCv(email="x@" + "a." * 150, telepon="0812")  # 303 karakter
    hasil = nilai_ats(cv)
    assert penalti(hasil, "email") == 20


def test_telepon_hilang() -> None:
    cv = cv_sehat()
    cv.kontak = KontakCv(email="a@b.c", telepon=None)
    hasil = nilai_ats(cv)
    assert penalti(hasil, "telepon") == 5
    assert aturan(hasil, "telepon")[0].severity == "warning"


def test_ringkasan_dibawah_25_kata() -> None:
    cv = cv_sehat()
    cv.ringkasan = "Singkat saja."
    hasil = nilai_ats(cv)
    assert penalti(hasil, "ringkasan-pendek") == 8
    assert aturan(hasil, "ringkasan-pendek")[0].severity == "warning"


def test_ringkasan_kosong_dihitung_pendek() -> None:
    cv = cv_sehat()
    cv.ringkasan = None
    assert penalti(nilai_ats(cv), "ringkasan-pendek") == 8


def test_ringkasan_diatas_120_kata() -> None:
    cv = cv_sehat()
    cv.ringkasan = "kata " * 121
    hasil = nilai_ats(cv)
    assert penalti(hasil, "ringkasan-panjang") == 5
    assert aturan(hasil, "ringkasan-panjang")[0].severity == "info"


def test_tanpa_pengalaman() -> None:
    cv = cv_sehat()
    cv.pengalaman = []
    hasil = nilai_ats(cv)
    assert penalti(hasil, "tanpa-pengalaman") == 25
    assert aturan(hasil, "tanpa-pengalaman")[0].severity == "error"


def test_format_tanggal_jan_2024_ac_cv3() -> None:
    """AC-CV-3: severity error dan pesan MENYEBUT 'YYYY-MM'."""
    cv = cv_sehat()
    cv.pengalaman[0].mulai = "Jan 2024"
    hasil = nilai_ats(cv)
    t = aturan(hasil, "format-tanggal")
    assert len(t) == 1
    assert t[0].penalti == 4
    assert t[0].severity == "error"
    assert "YYYY-MM" in t[0].pesan
    assert "Jan 2024" in t[0].pesan


def test_format_tanggal_per_kejadian() -> None:
    cv = cv_sehat()
    cv.pengalaman[0].mulai = "Jan 2024"
    cv.pengalaman[0].selesai = "Des 2024"
    cv.pendidikan[0].tahun = "2021"
    assert penalti(nilai_ats(cv), "format-tanggal") == 12  # 3 × 4


def test_tanggal_kosong_bukan_pelanggaran() -> None:
    cv = cv_sehat()
    cv.pengalaman[0].selesai = None
    cv.pendidikan[0].tahun = None
    assert penalti(nilai_ats(cv), "format-tanggal") == 0


def test_peran_tanpa_poin() -> None:
    cv = cv_sehat()
    cv.pengalaman[0].deskripsi = None
    hasil = nilai_ats(cv)
    assert penalti(hasil, "tanpa-poin") == 6
    assert aturan(hasil, "tanpa-poin")[0].severity == "warning"


def test_poin_tanpa_angka_tak_terukur() -> None:
    cv = cv_sehat()
    cv.pengalaman[0].deskripsi = "Membangun pipeline data. Mengurangi biaya."
    hasil = nilai_ats(cv)
    assert penalti(hasil, "tanpa-terukur") == 5
    assert aturan(hasil, "tanpa-terukur")[0].severity == "warning"


def test_poin_tidak_mulai_kata_kerja() -> None:
    cv = cv_sehat()
    cv.pengalaman[0].deskripsi = (
        "Tanggung jawab atas pipeline. Halaman dashboard dikelola. "
        "Anggaran 40 persen dipotong."
    )
    hasil = nilai_ats(cv)
    assert penalti(hasil, "kata-kerja") == 3
    assert aturan(hasil, "kata-kerja")[0].severity == "info"


def test_poin_lebih_dari_enam() -> None:
    cv = cv_sehat()
    cv.pengalaman[0].deskripsi = "Membangun 1. " + "Menulis 2. " * 6
    hasil = nilai_ats(cv)
    assert penalti(hasil, "poin-banyak") == 2


def test_skill_dikit_dan_banyak() -> None:
    cv = cv_sehat()
    cv.keterampilan = ["SQL"]
    hasil = nilai_ats(cv)
    assert penalti(hasil, "skill-dikit") == 6
    assert aturan(hasil, "skill-dikit")[0].severity == "warning"

    cv.keterampilan = [f"skill{i}" for i in range(26)]
    hasil = nilai_ats(cv)
    assert penalti(hasil, "skill-banyak") == 4
    assert penalti(hasil, "skill-dikit") == 0


def test_pendidikan_kosong() -> None:
    cv = cv_sehat()
    cv.pendidikan = []
    hasil = nilai_ats(cv)
    assert penalti(hasil, "tanpa-pendidikan") == 8
    assert aturan(hasil, "tanpa-pendidikan")[0].severity == "warning"


def test_rentang_terbalik() -> None:
    cv = cv_sehat()
    cv.pengalaman[0].mulai = "2024-06"
    cv.pengalaman[0].selesai = "2022-01"
    hasil = nilai_ats(cv)
    assert penalti(hasil, "rentang-terbalik") == 6
    assert aturan(hasil, "rentang-terbalik")[0].severity == "error"


# ── Dua AC AI-04 ─────────────────────────────────────────────────────────


def test_dokumen_sama_skor_sama_persis() -> None:
    """AC: 'Dokumen yang sama menghasilkan skor yang sama persis, selalu.'"""
    cv = cv_sehat()
    cv.pengalaman[0].mulai = "Jan 2024"
    cv.keterampilan = ["SQL"]
    a = nilai_ats(cv)
    b = nilai_ats(cv)
    assert a.skor == b.skor
    assert a.temuan == b.temuan


def test_tidak_ada_llm_di_jalur_penilaian() -> None:
    """AC CV-6: jalur penilaian tidak pernah memanggil LLM — fungsi
    nilai_ats sendiri (bukan docstring modul) tidak menyebut LLM/import."""
    import inspect

    sumber_fungsi = inspect.getsource(nilai_ats)
    assert "llm" not in sumber_fungsi.casefold()
    assert "httpx" not in sumber_fungsi.casefold()
    assert "await" not in sumber_fungsi  # murni sinkron: tak ada panggilan keluar


def test_skor_dibatasi_bawah_nol() -> None:
    """Penalti kumulatif bisa melebihi 100 — CV kosong saja mentok 72, tapi
    10 peran penuh pelanggaran (tanggal salah ×2 + tanpa poin = 14/peran)
    mendorongnya lewat 100; skor tidak boleh negatif."""
    cv = StructuredCV(
        kontak=KontakCv(),
        ringkasan=None,
        pengalaman=[
            PengalamanCv(
                posisi=f"Peran {i}", mulai="Jan 2024", selesai="Des 2023", deskripsi=None
            )
            for i in range(10)
        ],
        pendidikan=[],
        keterampilan=[],
    )
    hasil = nilai_ats(cv)
    assert hasil.skor == 0
    assert all(t.penalti > 0 for t in hasil.temuan)
