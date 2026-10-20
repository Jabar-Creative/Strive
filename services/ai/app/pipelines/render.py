"""Render StructuredCV → PDF satu kolom, ramah parser — AI-05 (Dev B), PRD §13.2 tahap 6.

> **Selesai berarti:** "Hasil PDF terbaca oleh parser ATS sumber terbuka
> (diuji dengan pyresparser atau setara)." Parser "setara"-nya dipakai di
> test: pdfplumber (kata + posisi x — alat baca tahap 3 pipeline ini)
> lalu skor §13.3 atas CV yang dibangun ulang dari teks hasil render.

Kenapa satu kolom dan tanpa hiasan: parser ATS membaca urutan teks dari
geometri. Dua kolom, tabel berdampingan, dan karakter dekoratif adalah tiga
cara paling umum CV gagal terbaca. Ketiganya dihindari secara KONSTRUKSI
di sini: semua baris digambar dari margin kiri yang sama, tanpa tabel,
tanpa karakter di luar WinAnsi (font dasar reportlab).

Fungsi MURNI atas StructuredCV → bytes: tanpa I/O, tanpa jam, tanpa acak.
`invariant=1` membekukan metadata tanggal reportlab supaya dokumen sama
menghasilkan byte yang sama. Router `/v1/cv` TETAP 503 — render dipanggil
bersama kontrak job AI-06/AI-07 (prinsip #197: kode tanpa pemanggil
menunggu pemanggilnya, jangan mengubah kontrak router sepihak).
"""

from __future__ import annotations

import io
import re

from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from app.pipelines.structur import StructuredCV

# ── Tata letak ────────────────────────────────────────────────────────────

LEBAR_HALAMAN = 595.0
TINGGI_HALAMAN = 842.0
MARGIN = 54.0
"""Margin kiri-satu-satunya: semua baris dimulai dari sini. Pengecualian
satu: baris lanjutan poin (lihat LEKAT_LANJUTAN) yang tetap dekat margin —
bukan klaster kolom kedua."""

LEKAT_LANJUTAN = 12.0
"""Inden baris lanjutan poin yang terbungkus. Parser membedakan baris poin
(awalan '- ' di margin) dari lanjutannya lewat x0; tanpa inden ini, baris
lanjutan tak terbedakan dari baris entri baru."""

LEBAR_ISI = LEBAR_HALAMAN - 2 * MARGIN

FONT_NAMA = ("Helvetica-Bold", 14)
FONT_SEKSI = ("Helvetica-Bold", 11)
FONT_TUBUH = ("Helvetica", 10)

# Poin capaian dipotong dengan pembatas yang SAMA dengan ats_score._poin
# ([.;\n]): satu poin di data = satu baris poin di PDF = satu poin saat
# hasil render dinilai ulang — jumlah poin tidak berubah karena render.
_PEMBATAS_POIN = re.compile(r"[.;\n]")

# Font dasar reportlab (Helvetica dkk.) meng-encode WinAnsi, bukan Unicode
# penuh. Karakter tipografis lazim DIPETAKAN ke ASCII setara — bukan dibuang
# supaya maknanya tetap terbaca — dan sisanya menjadi '?' secara deterministik.
_GANTI_UNICODE = {
    "–": "-",  # en dash
    "—": "-",  # em dash
    "‘": "'",
    "’": "'",
    "“": '"',
    "”": '"',
    "•": "-",  # butir → poin ASCII tak bernomor
    "…": "...",
    " ": " ",  # spasi tak-putus menyatukan dua kata di parser
}


def _amen(teks: str) -> str:
    """Teks → yang bisa digambar font dasar dan tidak memecah kata parser."""
    for asal, ganti in _GANTI_UNICODE.items():
        teks = teks.replace(asal, ganti)
    return teks.encode("cp1252", errors="replace").decode("cp1252")


def _bungkus(teks: str, font: str, ukuran: float, lebar: float) -> list[str]:
    """Pecah teks jadi baris yang muat `lebar` — kata tidak pernah dipotong:
    parser mencari KATA, dan setengah kata tidak dicari siapa pun."""
    baris: list[str] = []
    kini = ""
    for kata in teks.split():
        calon = f"{kini} {kata}" if kini else kata
        if stringWidth(calon, font, ukuran) <= lebar:
            kini = calon
        else:
            if kini:
                baris.append(kini)
            # Satu kata yang sendirinya lebih lebar dari kolom tetap utuh —
            # memotongnya membuat kata yang tidak bisa ditemukan.
            kini = kata
    if kini:
        baris.append(kini)
    return baris


class _Penulis:
    """Gambar baris demi baris dari margin kiri; ganti halaman otomatis.

    Satu panggilan drawString per baris visual: pdfplumber memisahkan kata
    lewat spasi dalam satu panggilan teks — dua teks bersebelahan di baris
    yang sama justru berisiko terbaca menyatu atau terpotong.
    """

    def __init__(self) -> None:
        self._buf = io.BytesIO()
        self._kanvas = canvas.Canvas(
            self._buf,
            pagesize=(LEBAR_HALAMAN, TINGGI_HALAMAN),
            # Tanpa invariant, setiap render menyemat tanggal pembuatan
            # BARU — dokumen sama menghasilkan byte berbeda, dan klaim
            # deterministik (semangat §13.3) gagal di byte pertama.
            invariant=1,
        )
        self._y = TINGGI_HALAMAN - MARGIN  # baseline baris pertama

    def baris(self, teks: str, font: str, ukuran: float, x: float = MARGIN) -> None:
        if self._y < MARGIN + ukuran:
            self._kanvas.showPage()
            self._y = TINGGI_HALAMAN - MARGIN
        self._kanvas.setFont(font, ukuran)
        self._kanvas.drawString(x, self._y, _amen(teks))
        self._y -= ukuran * 1.4  # leading

    def jeda(self, jarak: float) -> None:
        """Jarak antar seksi dari pergeseran y — tanpa baris kosong, supaya
        teks hasil ekstraksi tidak berisi baris hampa yang dihitung poin."""
        self._y -= jarak

    def selesai(self) -> bytes:
        self._kanvas.save()
        return self._buf.getvalue()


# ── API ───────────────────────────────────────────────────────────────────


def render_cv(cv: StructuredCV) -> bytes:
    """StructuredCV → bytes PDF satu kolom siap disimpan/diunduh.

    Urutan seksi (nama, headline, kontak, ringkasan, PENGALAMAN,
    PENDIDIKAN, KETERAMPILAN) SAMA dengan susun_dari_profil di extract:
    sumber yang sama harus terbaca dengan struktur yang sama di jalur
    profil maupun jalur PDF.
    """
    p = _Penulis()

    if cv.nama:
        p.baris(cv.nama, *FONT_NAMA)
    if cv.headline:
        p.baris(cv.headline, *FONT_TUBUH)
    kontak = " | ".join(
        nilai for nilai in (cv.kontak.email, cv.kontak.telepon, cv.kontak.linkedin) if nilai
    )
    if kontak:
        # Teks polos dipisah " | " — bukan tautan/gambar: parser kontak
        # mencari string email/telepon, dan ASCII murni nol risiko encoding.
        p.baris(kontak, *FONT_TUBUH)
    if cv.ringkasan:
        for b in _bungkus(cv.ringkasan, FONT_TUBUH[0], FONT_TUBUH[1], LEBAR_ISI):
            p.baris(b, *FONT_TUBUH)

    if cv.pengalaman:
        p.jeda(12)
        p.baris("PENGALAMAN", *FONT_SEKSI)
        for e in cv.pengalaman:
            baris_entri = e.posisi
            if e.perusahaan:
                baris_entri += f", {e.perusahaan}"
            rentang = _rentang(e.mulai, e.selesai)
            if rentang:
                baris_entri += f" ({rentang})"
            p.baris(baris_entri, *FONT_TUBUH)
            for poin in (x.strip() for x in _PEMBATAS_POIN.split(e.deskripsi or "")):
                if not poin:
                    continue
                # Bungkus dengan lebar kolom lanjutan: baris PERTAMA berprefiks
                # "- " di margin sehingga lebih pendek dari itu — konservatif,
                # tidak pernah meluber.
                for i, lanjut in enumerate(
                    _bungkus(poin, FONT_TUBUH[0], FONT_TUBUH[1], LEBAR_ISI - LEKAT_LANJUTAN)
                ):
                    if i == 0:
                        p.baris(f"- {lanjut}", *FONT_TUBUH)
                    else:
                        p.baris(lanjut, *FONT_TUBUH, x=MARGIN + LEKAT_LANJUTAN)

    if cv.pendidikan:
        p.jeda(12)
        p.baris("PENDIDIKAN", *FONT_SEKSI)
        for d in cv.pendidikan:
            baris_didik = d.gelar
            if d.institusi:
                baris_didik += f", {d.institusi}"
            if d.tahun:
                baris_didik += f" ({d.tahun})"
            p.baris(baris_didik, *FONT_TUBUH)

    if cv.keterampilan:
        p.jeda(12)
        p.baris("KETERAMPILAN", *FONT_SEKSI)
        # Satu paragraf dipisah koma — bukan tabel: tabel berdampingan adalah
        # bentuk lain dari layout multi-kolom yang memecah parser.
        for b in _bungkus(", ".join(cv.keterampilan), FONT_TUBUH[0], FONT_TUBUH[1], LEBAR_ISI):
            p.baris(b, *FONT_TUBUH)

    # §13.4.5: output ditandai sebagai SARAN — termasuk artefak yang diunduh
    # pengguna, bukan cuma di UI dan payload.
    p.jeda(16)
    p.baris("Disusun oleh Strive Academy - saran, bukan penilaian resmi.", *FONT_TUBUH)

    return p.selesai()


def _rentang(mulai: str | None, selesai: str | None) -> str | None:
    """Rentang tampil PERSIS seperti data (YYYY-MM) — jangan direformat:
    aturan §13.3 menghukum format selain YYYY-MM, dan render tidak boleh
    menambah pelanggaran yang tidak ada di datanya."""
    if mulai and selesai:
        return f"{mulai} - {selesai}"
    if mulai:
        return f"{mulai} - sekarang"
    if selesai:
        return selesai
    return None
