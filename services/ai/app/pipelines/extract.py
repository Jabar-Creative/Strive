"""Ekstraksi teks dari dokumen CV + penyusunan teks dari profil — AI-02.

Tahap 3 pipeline ATS CV (PRD §13.2): "PDF/DOCX lama **atau** profil
pengguna → teks mentah". Fungsi di sini MURNI atas bytes dan dict — tanpa
I/O jaringan/penyimpanan — supaya bisa diuji tanpa S3 dan dipakai ulang
oleh router `/v1/cv` saat AI-03 menyusun pipeline penuh.

Kode galat yang dilempar HANYA dari daftar tertutup §10.2 (isu #197):
`FILE_TOO_LARGE` (> 25 MB, atau DOCX yang memuai saat dibuka) ·
`UNSUPPORTED_FILE_TYPE` (bukan PDF/DOCX, terenkripsi, rusak) ·
`DOCUMENT_TOO_LONG` (> 15.000 kata, KL-1) · `SOURCE_TOO_SHORT` (teks hasil
< 120 karakter — itulah jalur penolakan dokumen hasil scan gambar; AC
AI-02: "ditolak dengan pesan yang jelas").
"""

from __future__ import annotations

import io
import statistics
import zipfile
from collections.abc import Iterator
from typing import Any, Literal

import pdfplumber
from docx import Document as DokumenDocx
from pdfminer.pdfdocument import PDFEncryptionError, PDFPasswordIncorrect
from pydantic import BaseModel, Field

from app.core.errors import GalatLayanan

# ── Batas (KL-1 dan §10.2) ────────────────────────────────────────────────

MAKS_BYTE = 25 * 1024 * 1024
"""FILE_TOO_LARGE — dokumen terkompresi yang dikirim punya ukuran ini."""

MAKS_MUAI_DOCX = 100 * 1024 * 1024
"""DOCX adalah ZIP: 25 MB terkompresi bisa memuai ratusan MB saat dibuka.
Batas ini dihitung dari jumlah `file_size` (TERURAI) seluruh entri SEBELUM
kontennya dipercaya — penjaga zip-bomb, dibaca lebih dulu daripada isi."""

MAKS_KATA = 15_000
MIN_KARAKTER_SUMBER = 120

MAKS_HALAMAN = 200
"""Cap halaman SEBELUM iterasi (temuan audit AI-02): PDF bisa memuat
ratusan ribu objek halaman kecil yang masing-masing dijalankan layout
analysis — CPU terikat menit-menit dan `DOCUMENT_TOO_LONG` baru menyala
setelah seluruh pekerjaan mahal selesai. CV nyata < 10 halaman; 200
sudah sangat longgar."""

AMBANG_GAP_KOLOM = 40.0
"""Celah horizontal (pt) yang memisahkan dua kolom. Jarak antar-kata pada
teks satu kolom jarang melebihi ~15 pt; gutter dua kolom puluhan pt."""

MIN_BARIS_BERCelah = 3
RASIO_BARIS_BERCelah = 0.35


class Temuan(BaseModel):
    severity: Literal["error", "warning", "info"]
    pesan: str


class HasilEkstraksi(BaseModel):
    teks: str
    sumber: Literal["pdf", "docx"]
    temuan: list[Temuan] = Field(default_factory=list)


# ── API ───────────────────────────────────────────────────────────────────


def ekstrak_dokumen(data: bytes) -> HasilEkstraksi:
    """Bytes dokumen → teks mentah + temuan tata letak.

    Tipe ditentukan dari BYTE-nya (aturan K-01): nama berkas dan
    Content-Type datang dari klien dan tidak pernah dipercaya.
    """
    if len(data) > MAKS_BYTE:
        raise _galat(413, "FILE_TOO_LARGE", "Dokumen melebihi batas 25 MB.")

    if data.startswith(b"%PDF-"):
        teks, temuan = _ekstrak_pdf(data)
        sumber: Literal["pdf", "docx"] = "pdf"
    elif data.startswith(b"PK\x03\x04"):
        teks = _ekstrak_docx(data)
        temuan: list[Temuan] = []
        sumber = "docx"
    else:
        raise _galat(
            415,
            "UNSUPPORTED_FILE_TYPE",
            "Berkas bukan PDF atau DOCX — format lain belum didukung.",
        )

    _periksa_panjang(teks)
    return HasilEkstraksi(teks=teks, sumber=sumber, temuan=temuan)


# ── PDF ───────────────────────────────────────────────────────────────────


def _ekstrak_pdf(data: bytes) -> tuple[str, list[Temuan]]:
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            if len(pdf.pages) > MAKS_HALAMAN:
                raise _galat(
                    422,
                    "DOCUMENT_TOO_LONG",
                    f"Dokumen melebihi {MAKS_HALAMAN} halaman — tidak sewajarnya "
                    "sebesar itu untuk sebuah CV.",
                )
            temuan: list[Temuan] = []
            halaman_teks: list[str] = []
            kata_terkumpul = 0
            for halaman in pdf.pages:
                baris = list(_baris_dari_kata(halaman.extract_words()))
                if not baris:
                    continue
                dua_kolom, x_celah = _deteksi_dua_kolom(baris)
                if dua_kolom:
                    temuan.append(
                        Temuan(
                            severity="info",
                            pesan=(
                                "Tata letak dua kolom terdeteksi — teks dibaca "
                                "kolom kiri lalu kanan (PRD E8 kasus tepi)."
                            ),
                        )
                    )
                teks_halaman = _susun_bacaan(baris, dua_kolom, x_celah)
                # Anggaran kata dihitung DI DALAM loop (temuan audit AI-02):
                # menunggu dokumen habis berarti membayar seluruh layout
                # analysis sebelum tahu dokumennya terlalu panjang.
                kata_terkumpul += len(teks_halaman.split())
                if kata_terkumpul > MAKS_KATA:
                    raise _galat(
                        422,
                        "DOCUMENT_TOO_LONG",
                        f"Dokumen melebihi batas 15.000 kata (>{kata_terkumpul} kata).",
                    )
                halaman_teks.append(teks_halaman)
            return "\n".join(halaman_teks), temuan
    except GalatLayanan:
        raise
    except Exception as ex:
        # pdfplumber membungkus SEMUA galat pdfminer menjadi
        # `PdfminerException` berpesan kosong — jenis aslinya (termasuk
        # enkripsi) hanya hidup di rantai `__cause__`. Byte datang dari
        # pengguna; parser boleh gagal dengan ribuan bentuk exception
        # berbeda, tapi bentuk GALAT keluarannya tetap §10.1.
        if _dalam_rantai(ex, (PDFPasswordIncorrect, PDFEncryptionError)):
            raise _galat(
                415,
                "UNSUPPORTED_FILE_TYPE",
                "PDF terenkripsi (berpassword) tidak bisa dibaca — "
                "simpan ulang tanpa password, lalu unggah.",
            ) from ex
        raise _galat(
            415,
            "UNSUPPORTED_FILE_TYPE",
            f"PDF rusak atau tidak bisa dibaca ({type(ex).__name__}).",
        ) from ex


Kata = dict[str, Any]


def _dalam_rantai(ex: BaseException, jenis: tuple[type[BaseException], ...]) -> bool:
    """Cari `jenis` di rantai penyebab (`__cause__`/`__context__`) exception."""
    kini: BaseException | None = ex
    while kini is not None:
        if isinstance(kini, jenis):
            return True
        kini = kini.__cause__ or kini.__context__
    return False


def _baris_dari_kata(kata: list[Kata], toleransi: float = 4.0) -> Iterator[list[Kata]]:
    """Kelompokkan kata menjadi baris visual berdasarkan posisi `top`.

    Kata pada satu baseline punya `top` yang sama, jadi pengelompokan
    toleransi kecil sudah cukup — tanpa perlu OCR ulang struktur PDF.
    """
    if not kata:
        return
    urut = sorted(kata, key=lambda k: (k["top"], k["x0"]))
    baris: list[Kata] = [urut[0]]
    acuan = urut[0]["top"]
    for k in urut[1:]:
        if abs(k["top"] - acuan) <= toleransi:
            baris.append(k)
        else:
            yield sorted(baris, key=lambda b: b["x0"])
            baris = [k]
            acuan = k["top"]
    yield sorted(baris, key=lambda b: b["x0"])


def _celah_terbesar(baris: list[Kata]) -> tuple[float, int] | None:
    """Celah horizontal terbesar antara dua kata berurutan, dan indeksnya.

    `None` kalau baris cuma 0-1 kata (tak ada celah yang bisa diukur).
    Baris 2 kata PUN diukur — judul seksi satu kata per kolom
    ("PENGALAMAN | PENDIDIKAN"-style) adalah konten kolom, bukan tajuk.
    """
    if len(baris) < 2:
        return None
    celah = [
        (baris[i + 1]["x0"] - baris[i]["x1"], i)
        for i in range(len(baris) - 1)
    ]
    return max(celah, key=lambda c: c[0])


def _deteksi_dua_kolom(baris: list[list[Kata]]) -> tuple[bool, float | None]:
    """Dua kolom = banyak baris punya celah lebar di posisi yang SAMA.

    Cukup ada satu garis vertikal kosong yang dipakai berulang. Teks satu
    kolom punya celah antar-kata kecil (<~15 pt) sehingga tidak pernah
    melampaui ambang; baris penuh lebar HALAMAN tidak punya celah besar
    dan diperlakukan sebagai tajuk.
    """
    bercelah: list[float] = []
    jumlah_pantas = 0
    for satu_baris in baris:
        hasil = _celah_terbesar(satu_baris)
        if hasil is None:
            continue
        jumlah_pantas += 1
        lebar, indeks = hasil
        if lebar > AMBANG_GAP_KOLOM and indeks >= 1 and indeks + 2 < len(satu_baris):
            kiri = satu_baris[indeks]["x1"]
            kanan = satu_baris[indeks + 1]["x0"]
            bercelah.append((kiri + kanan) / 2)
    if not bercelah:
        return False, None
    cukup = len(bercelah) >= MIN_BARIS_BERCelah
    dominan = len(bercelah) >= RASIO_BARIS_BERCelah * max(jumlah_pantas, 1)
    # Celah-celah harus SEPADAN posisinya (median dipakai sebagai gutter);
    # sebaran lebar ±30 pt mencegah celah acak yang kebetulan lebar.
    if cukup and dominan:
        median = statistics.median(bercelah)
        seragam = all(abs(c - median) <= 30 for c in bercelah)
        if seragam:
            return True, median
    return False, None


def _susun_bacaan(
    baris: list[list[Kata]], dua_kolom: bool, x_celah: float | None
) -> str:
    """Rakit teks halaman dalam urutan baca manusia.

    Satu kolom: atas ke bawah. Dua kolom: tajuk (baris lebar penuh tanpa
    celah) dulu, lalu SELURUH kolom kiri, baru kolom kanan — bukan
    tercampur per baris visual seperti `extract_text` polos.
    """
    if not dua_kolom or x_celah is None:
        return "\n".join(" ".join(k["text"] for k in satu) for satu in baris)

    tajuk: list[str] = []
    kiri: list[str] = []
    kanan: list[str] = []
    for satu_baris in baris:
        hasil = _celah_terbesar(satu_baris)
        lebar, indeks = hasil if hasil else (0.0, -1)
        # Di mode dua kolom, celah lebar dengan ≥1 kata di tiap sisi adalah
        # batas kolom — termasuk saat sisinya cuma satu kata ("KETERAMPILAN").
        # Menuntut ≥2 kata per sisi di sini terbukti memindahkan baris kiri
        # utuh ke tajuk dan merusak urutan baca (temuan verifikasi nyata).
        if lebar > AMBANG_GAP_KOLOM and indeks >= 1 and indeks + 1 < len(satu_baris):
            kiri.append(" ".join(k["text"] for k in satu_baris[: indeks + 1]))
            kanan.append(" ".join(k["text"] for k in satu_baris[indeks + 1 :]))
        else:
            tajuk.append(" ".join(k["text"] for k in satu_baris))
    return "\n".join(tajuk + kiri + kanan)


# ── DOCX ──────────────────────────────────────────────────────────────────


def _ekstrak_docx(data: bytes) -> str:
    # Pemeriksaan dibaca SESUAI kepercayaan: integritas ZIP → batas muai →
    # baru keanggotaan word/document.xml. Bom zip jangan dibaca isinya dulu.
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if sum(info.file_size for info in z.infolist()) > MAKS_MUAI_DOCX:
                raise _galat(
                    413,
                    "FILE_TOO_LARGE",
                    "Isi DOCX memuai melebihi 100 MB saat dibuka — berkas ditolak.",
                )
            if "word/document.xml" not in z.namelist():
                raise _galat(
                    415,
                    "UNSUPPORTED_FILE_TYPE",
                    "Berkas ZIP bukan DOCX — tidak ada word/document.xml "
                    "(aturan yang sama dengan K-01).",
                )
    except zipfile.BadZipFile:
        raise _galat(
            415, "UNSUPPORTED_FILE_TYPE", "Berkas ZIP rusak — bukan DOCX yang sah."
        ) from None

    try:
        dok = DokumenDocx(io.BytesIO(data))
    except GalatLayanan:
        raise
    except Exception as ex:
        raise _galat(
            415,
            "UNSUPPORTED_FILE_TYPE",
            f"DOCX rusak atau tidak bisa dibaca ({type(ex).__name__}).",
        ) from ex

    bagian = [p.text for p in dok.paragraphs if p.text.strip()]
    # CV lama sering memakai tabel untuk keterampilan/riwayat — isinya
    # ikut terbaca, sel-sel dipisah " | " agar tidak menyatu jadi satu kata.
    for tabel in dok.tables:
        for baris in tabel.rows:
            isi = " | ".join(sel.text.strip() for sel in baris.cells)
            if isi.strip(" |"):
                bagian.append(isi)
    # v0.1: teks di dalam text box (w:txbxContent) belum dibaca — python-docx
    # tidak mengeksposnya; dicatat jujur, bukan diam-diam dilewati.
    return "\n".join(bagian)


# ── Penyusunan dari profil ────────────────────────────────────────────────


class Kontak(BaseModel):
    email: str | None = None
    telepon: str | None = None
    linkedin: str | None = None


class Pengalaman(BaseModel):
    posisi: str
    perusahaan: str
    mulai: str
    selesai: str | None = None
    deskripsi: str | None = None


class Pendidikan(BaseModel):
    gelar: str
    institusi: str
    mulai: str | None = None
    selesai: str | None = None


class ProfilCv(BaseModel):
    """Bentuk profil dari sisi Node — diperketat bersama AI-03/AI-07."""

    nama: str
    headline: str | None = None
    ringkasan: str | None = None
    kontak: Kontak = Field(default_factory=Kontak)
    pengalaman: list[Pengalaman] = Field(default_factory=list)
    pendidikan: list[Pendidikan] = Field(default_factory=list)
    keterampilan: list[str] = Field(default_factory=list)


def susun_dari_profil(profil: ProfilCv) -> str:
    """Profil terstruktur → teks mentah, DETERMINISTIK (urutan field tetap).

    Sumber CV yang sama harus menghasilkan teks yang sama supaya cache
    SHA-256 CV-5 mengenainya, dan skor ATS-04 tidak berubah karena
    penyusunan ulang.
    """
    bagian: list[str] = [profil.nama]
    if profil.headline:
        bagian.append(profil.headline)
    kontak = " · ".join(
        nilai
        for nilai in (profil.kontak.email, profil.kontak.telepon, profil.kontak.linkedin)
        if nilai
    )
    if kontak:
        bagian.append(kontak)
    if profil.ringkasan:
        bagian.append(profil.ringkasan)
    if profil.pengalaman:
        bagian.append("PENGALAMAN")
        for p in profil.pengalaman:
            rentang = f"{p.mulai} - {p.selesai}" if p.selesai else f"{p.mulai} - sekarang"
            baris = f"{p.posisi}, {p.perusahaan} ({rentang})"
            if p.deskripsi:
                baris += f". {p.deskripsi}"
            bagian.append(baris)
    if profil.pendidikan:
        bagian.append("PENDIDIKAN")
        for d in profil.pendidikan:
            tahun = f" ({d.mulai} - {d.selesai})" if d.mulai and d.selesai else ""
            bagian.append(f"{d.gelar}, {d.institusi}{tahun}")
    if profil.keterampilan:
        bagian.append("KETERAMPILAN: " + ", ".join(profil.keterampilan))

    teks = "\n".join(bagian)
    _periksa_panjang(teks, konteks="Profil terlalu sedikit — lengkapi pengalaman atau pendidikan")
    return teks


# ── Batas bersama ─────────────────────────────────────────────────────────


def _periksa_panjang(teks: str, konteks: str | None = None) -> None:
    jumlah = len(teks.split())
    if jumlah > MAKS_KATA:
        raise _galat(
            422,
            "DOCUMENT_TOO_LONG",
            f"Dokumen melebihi batas 15.000 kata ({jumlah} kata).",
        )
    if len(teks.strip()) < MIN_KARAKTER_SUMBER:
        pesan = konteks or (
            "Tidak ada teks yang bisa dibaca dari dokumen — kemungkinan "
            "hasil scan gambar. Unggah DOCX, atau PDF yang teksnya bisa diseleksi."
        )
        raise _galat(422, "SOURCE_TOO_SHORT", pesan)


def _galat(status: int, code: str, message: str) -> GalatLayanan:
    return GalatLayanan(status, code, message)
