"""Skor ATS deterministik + daftar temuan — AI-04 (Dev B), PRD §13.3.

> **Selesai berarti:** "Dokumen yang sama menghasilkan skor yang sama persis,
> selalu. Tidak ada pemanggilan LLM di jalur penilaian." — CV-6.

Fungsi MURNI atas `StructuredCV` (keluaran AI-03): tanpa LLM, tanpa jam,
tanpa acak — deterministik secara konstruksi, bukan kebetulan. Aturan dan
penalti mengikuti tabel PRD §13.3 apa adanya; komentar "kenapa" per aturan
hanya ditulis kalau alasannya tidak terbaca dari tabelnya.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field

from app.pipelines.structur import StructuredCV

# ── Bentuk keluaran ───────────────────────────────────────────────────────

Severity = Literal["error", "warning", "info"]


class TemuanAts(BaseModel):
    severity: Severity
    pesan: str
    # Nama aturan §13.3 — pemanggil boleh mencabang/meringkas per aturan.
    aturan: str
    penalti: int


class HasilSkor(BaseModel):
    skor: int  # 0..100 — dibatasi bawah, penalti bisa melebihi 100
    temuan: list[TemuanAts] = Field(default_factory=list)


# ── Alat bantu ────────────────────────────────────────────────────────────

POLA_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
POLA_TANGGAL = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
POLA_ANGKA = re.compile(r"\d")

# Kata kerja aktif Indonesia yang lazim memulai poin capaian. Daftar TIDAK
# lengkap dan memang tidak perlu: aturannya "mayoritas", jadi satu-dua poin
# tanpa kata kerja tak menghukum — yang dihukum pola kalimat pasif/nomina.
KATA_KERJA_AKTIF = (
    "membangun", "merancang", "menulis", "memimpin", "mengembangkan",
    "meningkatkan", "membuat", "mengelola", "menganalisis", "mendesain",
    "mengoptimalkan", "menyusun", "menguji", "meluncurkan", "mengurangi",
    "menambah", "mengajar", "mentransfer", "memigrasi", "memperbaiki",
    "mengotomasi", "menginisiasi", "memenangkan", "menyelesaikan",
)


def _poin(deskripsi: str) -> list[str]:
    """Poin capaian = kalimat/baris. String kosong → nol poin."""
    return [p.strip() for p in re.split(r"[.;\n]", deskripsi) if p.strip()]


def _tanggal_salah(nilai: str | None) -> bool:
    """None = kosong (bukan pelanggaran); string tak cocok YYYY-MM = salah."""
    return nilai is not None and not POLA_TANGGAL.match(nilai)


def _mulai_kata_kerja(poin: str) -> bool:
    kata = poin.casefold().lstrip("•- 0123456789.")
    return kata.startswith(KATA_KERJA_AKTIF)


# ── Mesin skor ────────────────────────────────────────────────────────────


def nilai_ats(cv: StructuredCV) -> HasilSkor:
    """StructuredCV → (skor 0..100, temuan). 14 aturan §13.3, murni."""
    temuan: list[TemuanAts] = []

    def hukum(aturan: str, severity: Severity, penalti: int, pesan: str) -> None:
        temuan.append(TemuanAts(aturan=aturan, severity=severity, penalti=penalti, pesan=pesan))

    # 1. Email tidak ada / tidak valid — −20, error.
    # Guard panjang DULU (temuan audit AI-04): POLA_EMAIL backtracks
    # kuadratik atas string berpola titik — 16KB terukur 1,5 detik CPU.
    # RFC 5321 membatasi email 254 karakter; lebih dari itu memang tidak
    # sah, vonisnya sama tanpa regex menyentuhnya.
    email = cv.kontak.email
    if not email or len(email) > 254 or not POLA_EMAIL.match(email):
        hukum("email", "error", 20, "Email tidak ada atau tidak valid; parser ATS mencarinya untuk kontak.")

    # 2. Nomor telepon tidak ada — −5, warning.
    if not cv.kontak.telepon:
        hukum("telepon", "warning", 5, "Nomor telepon tidak ada.")

    # 3-4. Ringkasan < 25 kata (−8) / > 120 kata (−5). Kosong dihitung
    # 0 kata: aturannya tentang panjang, bukan keberadaan.
    jumlah_kata = len((cv.ringkasan or "").split())
    if jumlah_kata < 25:
        hukum("ringkasan-pendek", "warning", 8, f"Ringkasan {jumlah_kata} kata (kurang dari 25).")
    if jumlah_kata > 120:
        hukum("ringkasan-panjang", "info", 5, f"Ringkasan {jumlah_kata} kata (lebih dari 120).")

    # 5. Tidak ada pengalaman sama sekali — −25, error.
    if len(cv.pengalaman) == 0:
        hukum("tanpa-pengalaman", "error", 25, "Tidak ada pengalaman sama sekali.")

    for p in cv.pengalaman:
        # 6. Format tanggal bukan YYYY-MM — −4 per kejadian, error.
        for label, nilai in (("mulai", p.mulai), ("selesai", p.selesai)):
            if _tanggal_salah(nilai):
                hukum(
                    "format-tanggal",
                    "error",
                    4,
                    f"Tanggal {label} '{nilai}' pada pengalaman '{p.posisi}' bukan format YYYY-MM.",
                )
        # 7. Peran tanpa poin capaian — −6 per peran, warning.
        poin = _poin(p.deskripsi or "")
        if not poin:
            hukum("tanpa-poin", "warning", 6, f"Peran '{p.posisi}' tidak punya poin capaian.")
        else:
            # 8. Tidak ada poin terukur — −5 per peran, warning.
            if not any(POLA_ANGKA.search(p_str) for p_str in poin):
                hukum("tanpa-terukur", "warning", 5, f"Peran '{p.posisi}' tidak punya poin terukur (tanpa angka).")
            # 9. Mayoritas poin tidak mulai kata kerja aktif — −3, info.
            aktif = sum(1 for p_str in poin if _mulai_kata_kerja(p_str))
            if aktif * 2 < len(poin):
                hukum("kata-kerja", "info", 3, f"Mayoritas poin '{p.posisi}' tidak mulai dengan kata kerja aktif.")
            # 10. > 6 poin per peran — −2, info.
            if len(poin) > 6:
                hukum("poin-banyak", "info", 2, f"Peran '{p.posisi}' punya {len(poin)} poin (lebih dari 6).")

    # 6 (pendidikan). Tahun ikut dicek format tanggal — AC-CV-3 menyebut
    # "tanggal format 'Jan 2024'" tanpa membatasi ke pengalaman.
    for d in cv.pendidikan:
        if _tanggal_salah(d.tahun):
            hukum(
                "format-tanggal",
                "error",
                4,
                f"Tahun '{d.tahun}' pada pendidikan '{d.gelar}' bukan format YYYY-MM.",
            )

    # 11-12. Skill < 5 (−6, warning) / > 25 (−4, info).
    jumlah_skill = len(cv.keterampilan)
    if jumlah_skill < 5:
        hukum("skill-dikit", "warning", 6, f"Hanya {jumlah_skill} keterampilan (kurang dari 5).")
    if jumlah_skill > 25:
        hukum("skill-banyak", "info", 4, f"{jumlah_skill} keterampilan (lebih dari 25).")

    # 13. Pendidikan kosong — −8, warning.
    if len(cv.pendidikan) == 0:
        hukum("tanpa-pendidikan", "warning", 8, "Pendidikan kosong.")

    # 14. Tanggal selesai < mulai — −6 per kejadian, error. Dibandingkan
    # sebagai string YYYY-MM: urutan leksikografis = urutan kronologis.
    for p in cv.pengalaman:
        if (
            p.mulai
            and p.selesai
            and POLA_TANGGAL.match(p.mulai)
            and POLA_TANGGAL.match(p.selesai)
            and p.selesai < p.mulai
        ):
            hukum(
                "rentang-terbalik",
                "error",
                6,
                f"Pengalaman '{p.posisi}': selesai {p.selesai} lebih awal daripada mulai {p.mulai}.",
            )

    total = sum(t.penalti for t in temuan)
    return HasilSkor(skor=max(0, 100 - total), temuan=temuan)
