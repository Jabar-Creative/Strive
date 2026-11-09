"""Test ekstraksi PDF/DOCX + penyusunan dari profil — AI-02.

AC AI-02: "CV lama dua kolom tetap terbaca. Dokumen tanpa teks (hasil scan
gambar) ditolak dengan pesan yang jelas."

Semua berkas uji DIBUAT di sini (reportlab menulis PDF, python-docx menulis
DOCX, pypdf mengenkripsi) — bukan hasil rekaman layar — supaya test bisa
diperbaiki bersama perilaku yang diujinya, dan fixture-nya jujur: PDF dua
kolom benar-benar digambar dua kolom, bukan teks yang diklaim dua kolom.

Kode galat yang dites adalah daftar TERTUTUP §10.2 (isu #197):
FILE_TOO_LARGE · UNSUPPORTED_FILE_TYPE · DOCUMENT_TOO_LONG · SOURCE_TOO_SHORT.
"""

import io
import zipfile
import zlib

import pytest
from docx import Document
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas

from app.core.errors import GalatLayanan
from app.pipelines.extract import ProfilCv, ekstrak_dokumen, susun_dari_profil

# ── Fixture berkas ────────────────────────────────────────────────────────


def buat_pdf_satu_kolom() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, 842))
    baris_cv = [
        "Budi Santoso",
        "budi.santoso@yopmail.com",
        "Pengalaman kerja:",
        "Software Engineer PT Maju 2021-06 sampai 2024-02",
        "Membangun API pembayaran untuk 2 juta pengguna aktif",
        "Menulis 40 unit test dan menurunkan bug produksi 30 persen",
        "Keterampilan: Python TypeScript PostgreSQL Redis",
    ]
    y = 780
    for baris in baris_cv:
        c.drawString(72, y, baris)
        y -= 24
    c.save()
    return buf.getvalue()


def buat_pdf_dua_kolom() -> bytes:
    """AC utama: teks kiri harus terbaca UTUH sebelum teks kanan."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, 842))
    c.setFont("Helvetica", 10)
    kiri = [
        "Kiri pengalaman kerja satu",
        "Kiri pengalaman kerja dua",
        "Kiri pengalaman kerja tiga",
        "Kiri pengalaman kerja empat",
        "Kiri pengalaman kerja lima",
        "Kiri pengalaman kerja enam",
    ]
    kanan = [
        "Kanan pendidikan gelar sarjana",
        "Kanan pendidikan magister teknik",
        "Kanan sertifikasi AWS tersedia",
        "Kanan sertifikasi GCP tersedia",
        "Kanan kontak email yopmail",
        "Kanan kontak telepon aktif",
    ]
    y = 780
    for i in range(6):
        c.drawString(40, y, kiri[i])
        c.drawString(330, y, kanan[i])
        y -= 24
    c.save()
    return buf.getvalue()


def buat_pdf_dua_kolom_tajuk() -> bytes:
    """CV klasik: tajuk lebar penuh + dua kolom dengan panjang BERBEDA.

    Regresi verifikasi nyata: versi pertama salah memindahkan baris kiri
    ke tajuk saat sisinya cuma satu kata ("KETERAMPILAN"), dan menggabung
    judul seksi "PENGALAMAN | PENDIDIKAN" — urutan baca rusak diam-diam
    padahal fixture sintetis (4+4 kata per baris) hijau.
    """
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, 842))
    c.setFont("Helvetica-Bold", 14)
    c.drawString(40, 800, "Dewi Lestari")
    c.setFont("Helvetica", 10)
    c.drawString(40, 784, "dewi.lestari@yopmail.com · Bandung")
    c.setFont("Helvetica", 9)
    kiri = [
        "PENGALAMAN",
        "Product Designer, PT Kreasi (2022-04 - kini)",
        "Memimpin desain ulang checkout; konversi naik 18 persen.",
        "Membangun design system dipakai 4 tim produk.",
        "UI Designer, CV Media (2020-01 - 2022-03)",
        "Merancang 30+ layar aplikasi berita mobile.",
    ]
    kanan = [
        "PENDIDIKAN",
        "S1 Desain Komunikasi Visual, ITB (2019)",
        "KETERAMPILAN",
        "Figma, user research, prototyping,",
        "usability testing, design tokens,",
        "kolaborasi lintas tim yang rapat.",
    ]
    y = 750
    for i in range(6):
        c.drawString(40, y, kiri[i])
        c.drawString(320, y, kanan[i])
        y -= 18
    c.save()
    return buf.getvalue()


def buat_pdf_tanpa_teks() -> bytes:
    """Halaman berisi gambar bingkai saja — meniru hasil scan gambar."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, 842))
    c.rect(100, 500, 395, 300)
    c.showPage()
    c.save()
    return buf.getvalue()


def buat_pdf_terenkripsi() -> bytes:
    masuk = io.BytesIO(buat_pdf_satu_kolom())
    pembaca = PdfReader(masuk)
    penulis = PdfWriter()
    for halaman in pembaca.pages:
        penulis.add_page(halaman)
    penulis.encrypt("rahasia-tes")
    keluar = io.BytesIO()
    penulis.write(keluar)
    return keluar.getvalue()


def buat_docx_cv() -> bytes:
    dok = Document()
    dok.add_paragraph("Sinta Wijaya")
    dok.add_paragraph("sinta.wijaya@yopmail.com")
    dok.add_paragraph("Data analyst tiga tahun di sektor fintech dengan fokus")
    dok.add_paragraph("pada eksperimen pertumbuhan dan dashboard eksekutif.")
    tabel = dok.add_table(rows=2, cols=2)
    tabel.cell(0, 0).text = "Python"
    tabel.cell(0, 1).text = "Lanjutan"
    tabel.cell(1, 0).text = "SQL"
    tabel.cell(1, 1).text = "Mahir"
    buf = io.BytesIO()
    dok.save(buf)
    return buf.getvalue()


def buat_pdf_banyak_halaman(jumlah: int) -> bytes:
    """Halaman kosong bertumpuk — objek halaman kecil, kata nol.

    Meniru temuan audit: PDF bisa memuat ratusan ribu objek halaman yang
    masing-masing dijalankan layout analysis; cap harus menyala SEBELUM
    iterasi, bukan setelah seluruh pekerjaan mahal selesai.
    """
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, 842))
    for _ in range(jumlah):
        c.showPage()
    c.save()
    return buf.getvalue()


def buat_pdf_padat_kata(jumlah_kata: int) -> bytes:
    """Kata padat lintas halaman — anggaran kata harus menyala di tengah jalan."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, 842))
    c.setFont("Helvetica", 8)
    per_baris = 12
    y = 800
    for _ in range(0, jumlah_kata, per_baris):
        c.drawString(30, y, ("kata " * per_baris).strip())
        y -= 11
        if y < 40:
            c.showPage()
            c.setFont("Helvetica", 8)
            y = 800
    c.save()
    return buf.getvalue()


def buat_zip_biasa() -> bytes:
    """Magic PK benar (zip), tapi bukan DOCX — jebakan K-01 berulang."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("catatan.txt", "ini zip biasa, bukan docx")
    return buf.getvalue()


def buat_docx_panjang(jumlah_kata: int) -> bytes:
    dok = Document()
    per_paragraf = 50
    for _ in range(jumlah_kata // per_paragraf):
        dok.add_paragraph("kata " * per_paragraf)
    buf = io.BytesIO()
    dok.save(buf)
    return buf.getvalue()


def buat_docx_bom() -> bytes:
    """ZIP sah bentuknya (terkompresi kecil), tapi memuai saat dibuka."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as z:
        # 2 × 80 MB nol terurai; terkompresi puluhan KB saja. Total terurai
        # 160 MB melampaui ambang dekompresi 100 MB sebelum isi dibaca.
        z.writestr("entri-besar-1.bin", b"\x00" * (80 * 1024 * 1024))
        z.writestr("entri-besar-2.bin", b"\x00" * (80 * 1024 * 1024))
    return buf.getvalue()


# ── Ekstraksi: jalur bahagia ──────────────────────────────────────────────


def test_pdf_satu_kolom_terbaca() -> None:
    hasil = ekstrak_dokumen(buat_pdf_satu_kolom())
    assert hasil.sumber == "pdf"
    assert "Budi Santoso" in hasil.teks
    assert "PT Maju" in hasil.teks
    # Satu kolom: tidak ada temuan tata letak.
    assert not any("dua kolom" in t.pesan for t in hasil.temuan)


def test_pdf_dua_kolom_terbaca_utuh_dan_ditandai() -> None:
    hasil = ekstrak_dokumen(buat_pdf_dua_kolom())
    teks = hasil.teks
    # Kolom kiri UTUH sebelum kolom kanan dimulai — bukan tercampur
    # per baris visual seperti extract_text polos.
    assert teks.index("Kiri pengalaman kerja enam") < teks.index("Kanan pendidikan gelar")
    # Tidak ada baris yang menggabungkan kiri dan kanan.
    for baris in teks.splitlines():
        if "Kiri" in baris:
            assert "Kanan" not in baris, f"baris tercampur: {baris!r}"
    # PRD E8 kasus tepi: "ditandai di findings".
    assert any("dua kolom" in t.pesan.lower() for t in hasil.temuan)


def test_pdf_dua_kolom_dengan_tajuk_urutan_baca_utuh() -> None:
    hasil = ekstrak_dokumen(buat_pdf_dua_kolom_tajuk())
    teks = hasil.teks
    # Tajuk halaman tetap di atas.
    assert teks.startswith("Dewi Lestari")
    # Kolom kiri UTUH dan berurutan, semua sebelum isi kanan pertama.
    for kiri_lebih_dulu in [
        "Product Designer, PT Kreasi",
        "Memimpin desain ulang checkout",
        "Membangun design system",
        "UI Designer, CV Media",
        "Merancang 30+ layar",
    ]:
        assert teks.index(kiri_lebih_dulu) < teks.index("S1 Desain Komunikasi Visual"), (
            f"baris kiri {kiri_lebih_dulu!r} jatuh setelah kolom kanan"
        )
    # Baris kiri TIDAK tercampur dengan kata tunggal kanan di tajuk.
    assert not any(
        "Memimpin" in baris and "KETERAMPILAN" in baris for baris in teks.splitlines()
    )
    # Tetap ditandai dua kolom.
    assert any("dua kolom" in t.pesan.lower() for t in hasil.temuan)


def test_docx_paragraf_dan_tabel_terbaca() -> None:
    hasil = ekstrak_dokumen(buat_docx_cv())
    assert hasil.sumber == "docx"
    assert "Sinta Wijaya" in hasil.teks
    assert "Data analyst" in hasil.teks
    # Isi tabel ikut terbaca — CV lama sering memakai tabel untuk skill.
    assert "Python" in hasil.teks
    assert "Mahir" in hasil.teks


# ── Ekstraksi: penolakan dengan pesan jelas ───────────────────────────────


def test_pdf_tanpa_teks_ditolak_pesan_scan() -> None:
    with pytest.raises(GalatLayanan) as info:
        ekstrak_dokumen(buat_pdf_tanpa_teks())
    assert info.value.code == "SOURCE_TOO_SHORT"
    # Pesan harus MENYEBUT kemungkinan scan gambar — "pesan jelas" di AC.
    assert "scan" in info.value.message.lower()


def test_pdf_terenkripsi_ditolak_pesan_password() -> None:
    with pytest.raises(GalatLayanan) as info:
        ekstrak_dokumen(buat_pdf_terenkripsi())
    assert info.value.code == "UNSUPPORTED_FILE_TYPE"
    assert "password" in info.value.message.lower() or "enkripsi" in info.value.message.lower()


def test_bukan_pdf_docx_ditolak() -> None:
    with pytest.raises(GalatLayanan) as info:
        ekstrak_dokumen(b"<html><body>ini bukan dokumen</body></html>")
    assert info.value.code == "UNSUPPORTED_FILE_TYPE"


def test_zip_biasa_bukan_docx_ditolak() -> None:
    with pytest.raises(GalatLayanan) as info:
        ekstrak_dokumen(buat_zip_biasa())
    assert info.value.code == "UNSUPPORTED_FILE_TYPE"


def test_dokumen_lebih_25mb_ditolak() -> None:
    with pytest.raises(GalatLayanan) as info:
        ekstrak_dokumen(b"%PDF-1.4\n" + b"\x00" * (25 * 1024 * 1024 + 1))
    assert info.value.code == "FILE_TOO_LARGE"
    assert info.value.status == 413


def test_dokumen_diatas_15000_kata_ditolak() -> None:
    with pytest.raises(GalatLayanan) as info:
        ekstrak_dokumen(buat_docx_panjang(15_050))
    assert info.value.code == "DOCUMENT_TOO_LONG"
    assert info.value.status == 422


def test_pdf_diatas_200_halaman_ditolak_sebelum_iterasi() -> None:
    # Temuan audit: cap halaman harus menyala SEBELUM layout analysis,
    # bukan setelah seluruh dokumen diproses.
    with pytest.raises(GalatLayanan) as info:
        ekstrak_dokumen(buat_pdf_banyak_halaman(201))
    assert info.value.code == "DOCUMENT_TOO_LONG"
    assert "halaman" in info.value.message


def test_pdf_anggaran_kata_menyala_di_tengah_dokumen() -> None:
    # Padat kata lintas halaman (di bawah cap halaman): penolakan tetap
    # terjadi dari akumulasi DALAM loop, tidak menunggu dokumen habis.
    with pytest.raises(GalatLayanan) as info:
        ekstrak_dokumen(buat_pdf_padat_kata(15_050))
    assert info.value.code == "DOCUMENT_TOO_LONG"


def test_docx_bom_dekompresi_ditolak() -> None:
    """Zip sah ≤25 MB terkompresi, tapi memuai melampaui batas saat dibuka."""
    with pytest.raises(GalatLayanan) as info:
        ekstrak_dokumen(buat_docx_bom())
    assert info.value.code == "FILE_TOO_LARGE"


def buat_pdf_bom_stream(muai: int, jumlah: int = 1) -> bytes:
    """PDF sah bentuknya (<25 MB) dengan stream FlateDecode yang memuai `muai` byte per stream.

    Isu #207: nol terkompresi ratusan kali lipat — 64 MB muai jadi ±60 KB
    terkompresi, jauh di bawah cap input 25 MB yang sudah ada.
    """
    bagian = [b"%PDF-1.4\n"]
    for i in range(jumlah):
        kompres = zlib.compress(b"\x00" * muai, 9)
        bagian.append(
            f"{i + 1} 0 obj\n<< /Length {len(kompres)} /Filter /FlateDecode >>\nstream\n".encode()
            + kompres
            + b"\nendstream\nendobj\n"
        )
    return b"".join(bagian) + b"%%EOF"


def test_pdf_bom_stream_tunggal_ditolak_sebelum_pdfplumber() -> None:
    """Isu #207: 60 KB terkompres memuai 64 MB — ditolak, bukan dimuat ke memori."""
    with pytest.raises(GalatLayanan) as info:
        ekstrak_dokumen(buat_pdf_bom_stream(64 * 1024 * 1024))
    assert info.value.code == "DOCUMENT_TOO_LONG"
    assert info.value.status == 422
    assert "memuai" in info.value.message.lower()


def test_pdf_bom_banyak_stream_kena_batas_total() -> None:
    """Tiap stream di bawah batas per-stream (30 MB < 32 MB), jumlahnya yang melampaui total."""
    with pytest.raises(GalatLayanan) as info:
        ekstrak_dokumen(buat_pdf_bom_stream(30 * 1024 * 1024, jumlah=6))
    assert info.value.code == "DOCUMENT_TOO_LONG"
    assert info.value.status == 422


# ── Regresi audit AI-07 (temuan 1): guard literal #207 bisa dilewati ──────
#
# Dua bypass yang terbukti lewat probe terukur (alokasi parser tetap
# ratusan MB meski guard meloloskan): kata "stream" di teks lain membuat
# scanner salah memasangkan segmen, dan /Filter berantai didekompresi
# parser lebih dari satu pass sedangkan scanner hanya mengukur satu.
# Penegakan yang benar ada di TITIK DEKOMPRESI parser (lihat
# app/pipelines/anggaran_pdf.py); test di bawah adalah penjaganya.
#
# PDF dibangun lengkap (Catalog/Pages/Page/Contents + xref), bukan cuma
# tumpukan objek: pdfminer hanya mendekode stream yang DIREFERENSIKAN
# halaman, jadi tanpa rantai referensi ini bypass tidak pernah tersentuh
# parser dan testnya bohong.


def _rakit_pdf(objek: dict[int, bytes]) -> bytes:
    out = bytearray(b"%PDF-1.4\n")
    ofset: dict[int, int] = {}
    for n in sorted(objek):
        ofset[n] = len(out)
        out += f"{n} 0 obj\n".encode() + objek[n] + b"\nendobj\n"
    maks = max(objek)
    px = len(out)
    out += b"xref\n" + f"0 {maks + 1}\n".encode() + b"0000000000 65535 f \n"
    for n in range(1, maks + 1):
        out += (
            (f"{ofset.get(n, 0):010d} 00000 n \n").encode() if n in ofset else b"0000000000 65535 f \n"
        )
    out += f"trailer\n<< /Size {maks + 1} /Root 1 0 R >>\nstartxref\n{px}\n%%EOF".encode()
    return bytes(out)


def _pdf_konten(isi: bytes, filt: bytes = b"/FlateDecode", komentar: bytes = b"") -> bytes:
    """Satu halaman yang content stream-nya = `isi` dengan `/Filter` = `filt`."""
    stream = (
        b"<< /Length "
        + str(len(isi)).encode()
        + b" /Filter "
        + filt
        + b" >>\nstream\n"
        + isi
        + b"\nendstream"
    )
    objek = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        4: stream,
        5: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    }
    pdf = _rakit_pdf(objek)
    if not komentar:
        return pdf
    return bytearray(b"%PDF-1.4\n") + komentar + pdf[len(b"%PDF-1.4\n") :]


def _kompres_lapis(muai: int, lapis: int) -> bytes:
    isi = b"\x00" * muai
    for _ in range(lapis):
        isi = zlib.compress(isi, 9)
    return isi


def buat_pdf_komentar_stream(muai: int) -> bytes:
    """Bypass 1a: komentar `%stream` di atas objek membuat scanner literal
    memasangkan segmen yang salah, stream bom di bawahnya tak pernah terukur."""
    return _pdf_konten(zlib.compress(b"\x00" * muai, 9), b"/FlateDecode", komentar=b"%stream catatan\n")


def buat_pdf_rantai_filter(muai: int, lapis: int = 2) -> bytes:
    """Bypass 1b: `/Filter [/FlateDecode /FlateDecode]` diterapkan parser
    BERURUTAN; scanner hanya menjalankan satu pass zlib per segmen, jadi muai
    lapis kedua ke atas tidak pernah diukur."""
    rantai = b" ".join([b"/FlateDecode"] * lapis)
    return _pdf_konten(_kompres_lapis(muai, lapis), b"[" + rantai + b"]")


def buat_pdf_rantai_banyak_objek(muai: int, jumlah: int, lapis: int = 2) -> bytes:
    """Varian 1b lintas halaman: tiap dekompresi di bawah cap per-stream,
    jumlah totalnya yang melampaui anggaran dokumen — hanya anggaran kumulatif
    di titik dekompresi yang bisa menangkapnya."""
    isi = _kompres_lapis(muai, lapis)
    stream = (
        b"<< /Length "
        + str(len(isi)).encode()
        + b" /Filter ["
        + b" ".join([b"/FlateDecode"] * lapis)
        + b"] >>\nstream\n"
        + isi
        + b"\nendstream"
    )
    id_font = 3 + jumlah * 2
    objek: dict[int, bytes] = {1: b"<< /Type /Catalog /Pages 2 0 R >>"}
    kids = []
    for i in range(jumlah):
        hal = 3 + i * 2
        objek[hal] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents {hal + 1} 0 R "
            f"/Resources << /Font << /F1 {id_font} 0 R >> >> >>".encode()
        )
        objek[hal + 1] = stream
        kids.append(f"{hal} 0 R")
    objek[2] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {jumlah} >>".encode()
    objek[id_font] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    return _rakit_pdf(objek)


def test_pdf_bom_komentar_stream_ditolak_di_titik_dekompresi() -> None:
    """Scanner literal dibutakan komentar; stream 40 MB di bawahnya harus
    tetap ditolak oleh anggaran di titik dekompresi parser."""
    with pytest.raises(GalatLayanan) as info:
        ekstrak_dokumen(buat_pdf_komentar_stream(40 * 1024 * 1024))
    assert info.value.code == "DOCUMENT_TOO_LONG"


def test_pdf_bom_rantai_filter_ditolak_di_titik_dekompresi() -> None:
    """160 MB nol terkompres dua lapis jadi ±100 KB; scanner mengukur pass
    pertama saja (lolos), parser menjalankan pass kedua penuh."""
    with pytest.raises(GalatLayanan) as info:
        ekstrak_dokumen(buat_pdf_rantai_filter(160 * 1024 * 1024))
    assert info.value.code == "DOCUMENT_TOO_LONG"


def test_pdf_bom_rantai_banyak_objek_kena_anggaran_total() -> None:
    """6 halaman x 2 lapis x 26 MB: tiap dekompresi < 32 MB (cap per-stream),
    kumulatif 156 MB > 150 MB (anggaran dokumen)."""
    with pytest.raises(GalatLayanan) as info:
        ekstrak_dokumen(buat_pdf_rantai_banyak_objek(26 * 1024 * 1024, jumlah=6))
    assert info.value.code == "DOCUMENT_TOO_LONG"


# ── Penyusunan dari profil ────────────────────────────────────────────────


def profil_lengkap() -> ProfilCv:
    return ProfilCv(
        nama="Rina Melati",
        headline="Backend engineer yang suka sistem terdistribusi",
        kontak={"email": "rina.melati@yopmail.com"},
        pengalaman=[
            {
                "posisi": "Backend Engineer",
                "perusahaan": "PT Nusantara Digital",
                "mulai": "2022-03",
                "selesai": "2025-08",
                "deskripsi": "Merancang layanan pembayaran dengan throughput 500 rps.",
            }
        ],
        pendidikan=[{"gelar": "S1 Informatika", "institusi": "Universitas Gadjah Mada"}],
        keterampilan=["Go", "PostgreSQL", "Kafka"],
    )


def test_susun_dari_profil_memuat_semua_bagian() -> None:
    teks = susun_dari_profil(profil_lengkap())
    for bagian in ("Rina Melati", "PT Nusantara Digital", "2022-03", "S1 Informatika", "Kafka"):
        assert bagian in teks


def test_susun_dari_profil_bentuk_kontrak_node() -> None:
    """Audit AI-07 T1/T3: profil persis bentuk kontrak zod Node tidak boleh
    gagal validasi atau kehilangan field — dulu `posisi` vs `judul` bertabrakan
    dan website/jurusan dibuang pydantic secara diam-diam."""
    profil = ProfilCv.model_validate(
        {
            "nama": "Rina Melati",
            "kontak": {
                "email": "rina.melati@yopmail.com",
                "telepon": "+628120000000",
                "linkedin": "linkedin.com/in/rina",
                "website": "rina.dev",
            },
            "pengalaman": [
                {
                    "posisi": "Backend Engineer",
                    "perusahaan": "PT Nusantara Digital",
                    "mulai": "2022-03",
                }
            ],
            "pendidikan": [
                {
                    "gelar": "S1",
                    "institusi": "Universitas Gadjah Mada",
                    "mulai": "2018-08",
                    "selesai": "2022-03",
                    "jurusan": "Informatika",
                }
            ],
            "keterampilan": ["Go"],
        }
    )
    teks = susun_dari_profil(profil)
    for bagian in ("rina.dev", "Backend Engineer", "S1 (Informatika)"):
        assert bagian in teks


def test_susun_dari_profil_deterministik() -> None:
    assert susun_dari_profil(profil_lengkap()) == susun_dari_profil(profil_lengkap())


def test_susun_dari_profil_terlalu_pendek_ditolak() -> None:
    with pytest.raises(GalatLayanan) as info:
        susun_dari_profil(ProfilCv(nama="Rina Melati"))
    assert info.value.code == "SOURCE_TOO_SHORT"
