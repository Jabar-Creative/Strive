"""Test render PDF satu kolom — AI-05, PRD §13.2 tahap 6 + §13.3.

AC AI-05: "Hasil PDF terbaca oleh parser ATS sumber terbuka (diuji dengan
pyresparser atau setara)." Parser "setara"-nya adalah dua lapis yang SUDAH
dipakai pipeline ini, bukan dependensi baru: pdfplumber (kata + posisi x —
alat baca tahap 3) untuk geometri dan round-trip, lalu skor §13.3 atas CV
yang dibangun ULANG dari teks hasil render. pyresparse tidak ditambahkan
karena bukti yang dimintanya (teks terbaca utuh oleh parser) sudah dipenuhi
dua lapis ini, dan menambah dependensi tanpa alasan kuat dilarang repo.

Empat kelompok test (peta ke brief item):
  (a) %PDF + terbuka pdfplumber        (c) round-trip field kunci
  (b) SATU kolom dari posisi x kata    (d) skor parse ulang tanpa penalti baru

Semua CV uji memakai email @yopmail (aturan global data dummy). Parser
`parse_ulang` di bawah HANYA membaca byte PDF hasil render — kalau ia
menyentuh objek CV masukan, test (d) berubah jadi tautologi, bukti bohong.
"""

import io
import re
from typing import Any

import pdfplumber

from app.pipelines.ats_score import nilai_ats
from app.pipelines.extract import (
    AMBANG_GAP_KOLOM,
    _baris_dari_kata,
    _deteksi_dua_kolom,
    ekstrak_dokumen,
)
from app.pipelines.render import LEKAT_LANJUTAN, MARGIN, render_cv
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


def cv_ramai() -> StructuredCV:
    """CV sehat (skor 100) lintas semua seksi — bahan round-trip.

    Satu poin sengaja panjang (> satu baris) supaya jalur bungkus-baris
    poin ikut diuji, bukan cuma jalur bahagia.
    """
    return StructuredCV(
        nama="Farhan Aditya",
        headline="Data engineer pipeline dan gudang data",
        ringkasan=RINGKASAN_30_KATA,
        kontak=KontakCv(
            email="farhan.aditya@yopmail.com",
            telepon="0812 3456 7890",
            linkedin="linkedin.com/in/farhan-aditya",
        ),
        pengalaman=[
            PengalamanCv(
                posisi="Data Engineer",
                perusahaan="Bank Nusa",
                mulai="2022-01",
                selesai="2024-06",
                deskripsi=(
                    "Membangun pipeline 500 juta baris. "
                    "Mengurangi biaya komputasi 40 persen dengan menyetel ulang "
                    "query SQL pada gudang data dan menjadwalkan ulang pekerjaan "
                    "ETL ke jam sepi."
                ),
            ),
            PengalamanCv(
                posisi="Backend Engineer",
                perusahaan="PT Nusantara Digital",
                mulai="2020-05",
                selesai="2021-12",
                deskripsi="Merancang layanan pembayaran dengan throughput 500 rps. Menulis 120 unit test.",
            ),
        ],
        pendidikan=[PendidikanCv(gelar="S1 Statistika", institusi="IPB", tahun="2021-06")],
        keterampilan=["SQL", "Airflow", "dbt", "Python", "Spark"],
    )


# ── Alat baca PDF (parser "setara" pihak test) ────────────────────────────


def baris_pdf(data: bytes) -> list[list[dict[str, Any]]]:
    """Kata per halaman dikelompokkan jadi baris visual — memakai pengelompok
    milik ekstraksi sendiri supaya definisi "baris" tidak berbeda antara
    pembaca dan penulis."""
    semua: list[list[dict[str, Any]]] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for halaman in pdf.pages:
            semua.extend(_baris_dari_kata(halaman.extract_words()))
    return semua


SEKSI = ("PENGALAMAN", "PENDIDIKAN", "KETERAMPILAN")


def parse_ulang(data: bytes) -> StructuredCV:
    """Bangun StructuredCV HANYA dari geometri + teks PDF hasil render.

    Inilah peran "parser ATS setara" di AC: cara bacanya (cari baris
    kontak lewat '@', seksi lewat judul kata kunci, poin lewat awalan '-'
    dan inden baris lanjutan) adalah heuristik yang dipakai parser nyata.
    """
    baris = [(kata[0]["x0"], " ".join(k["text"] for k in kata)) for kata in baris_pdf(data)]
    teks_baris = [t for _, t in baris]

    indeks_seksi = {s: teks_baris.index(s) for s in SEKSI if s in teks_baris}
    awal_seksi = min(indeks_seksi.values(), default=len(teks_baris))
    kepala = teks_baris[:awal_seksi]

    i_kontak = next(i for i, b in enumerate(kepala) if "@" in b)
    bagian = [x.strip() for x in kepala[i_kontak].split(" | ")]
    email = next((x for x in bagian if "@" in x), None)
    telepon = next((x for x in bagian if re.search(r"\d", x) and x != email), None)
    linkedin = next((x for x in bagian if x != email and x != telepon), None)

    ringkasan = " ".join(kepala[i_kontak + 1 :]).strip() or None

    def blok(nama: str) -> list[tuple[float, str]]:
        if nama not in indeks_seksi:
            return []
        awal = indeks_seksi[nama] + 1
        akhir = min(
            (i for s, i in indeks_seksi.items() if i > indeks_seksi[nama]),
            default=len(baris),
        )
        return baris[awal:akhir]

    pengalaman: list[PengalamanCv] = []
    kini: str | None = None
    poin: list[str] = []

    def tutup_entri() -> None:
        if kini is None:
            return
        rentang = re.search(r"\((\d{4}-\d{2})(?: - (\d{4}-\d{2}|sekarang))?\)$", kini)
        kepala_entri = kini[: rentang.start()].strip() if rentang else kini
        posisi, _, perusahaan = kepala_entri.partition(", ")
        pengalaman.append(
            PengalamanCv(
                posisi=posisi,
                perusahaan=perusahaan or None,
                mulai=rentang.group(1) if rentang else None,
                selesai=rentang.group(2) if rentang and rentang.group(2) != "sekarang" else None,
                deskripsi="\n".join(poin) if poin else None,
            )
        )

    for x0, teks in blok("PENGALAMAN"):
        if teks.startswith("Disusun"):
            break
        if teks.startswith("- ") and abs(x0 - MARGIN) < 2.5:
            poin.append(teks[2:])
        elif abs(x0 - (MARGIN + LEKAT_LANJUTAN)) < 2.5 and poin:
            poin[-1] += " " + teks
        else:
            tutup_entri()
            kini, poin = teks, []
    tutup_entri()

    pendidikan: list[PendidikanCv] = []
    for _, teks in blok("PENDIDIKAN"):
        if teks.startswith("Disusun"):
            break
        tahun = re.search(r"\((\d{4}-\d{2})\)$", teks)
        kepala_pendidikan = teks[: tahun.start()].strip() if tahun else teks
        gelar, _, institusi = kepala_pendidikan.partition(", ")
        pendidikan.append(
            PendidikanCv(
                gelar=gelar,
                institusi=institusi or None,
                tahun=tahun.group(1) if tahun else None,
            )
        )

    keterampilan: list[str] = []
    for _, teks in blok("KETERAMPILAN"):
        if teks.startswith("Disusun"):
            break
        keterampilan.extend(x for x in teks.split(", ") if x)

    return StructuredCV(
        nama=teks_baris[0],
        headline=kepala[1] if i_kontak == 2 else None,
        ringkasan=ringkasan,
        kontak=KontakCv(email=email, telepon=telepon, linkedin=linkedin),
        pengalaman=pengalaman,
        pendidikan=pendidikan,
        keterampilan=keterampilan,
        saran=True,
    )


# ── (a) PDF sah dan terbuka ───────────────────────────────────────────────


def test_pdf_sah_dibuka_pdfplumber() -> None:
    data = render_cv(cv_ramai())
    assert data.startswith(b"%PDF-")
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        assert len(pdf.pages) >= 1
        # Ada teks yang bisa diseleksi — bukan gambar dari hasil scan.
        assert pdf.pages[0].extract_words()


def test_cv_kosong_tetap_pdf_sah() -> None:
    """CV tanpa satu pun field tidak boleh meledak — tetap PDF satu halaman.
    (Ekstraksi menolaknya lewat SOURCE_TOO_SHORT; itu urusan tahap 3.)"""
    data = render_cv(StructuredCV())
    assert data.startswith(b"%PDF-")
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        assert len(pdf.pages) == 1


# ── (b) SATU kolom, dibuktikan dari posisi x ──────────────────────────────


def test_satu_kolom_dari_posisi_x() -> None:
    """Satu kolom dibuktikan dari GEOMETRI, bukan dari klaim:
    1. semua baris dimulai dekat margin kiri — klaster awal-baris kedua
       (milik kolom kanan layout dua kolom A4) hidup di >= 300 pt;
    2. tidak ada celah antar-kata melebihi ambang gutter (40 pt);
    3. detektor dua kolom milik ekstraksi pipeline SENDIRI tidak menandai.
    """
    baris = baris_pdf(render_cv(cv_ramai()))
    assert baris, "PDF kosong — tidak ada yang bisa dibuktikan"
    for kata in baris:
        assert kata[0]["x0"] < 200, f"awal baris {kata[0]['text']!r} di x={kata[0]['x0']:.0f}"
        celah = [kata[i + 1]["x0"] - kata[i]["x1"] for i in range(len(kata) - 1)]
        assert max(celah, default=0) <= AMBANG_GAP_KOLOM
    assert _deteksi_dua_kolom(baris) == (False, None)


def test_satu_kolom_di_halaman_lanjutan() -> None:
    """Ganti halaman tidak boleh menggeser margin — halaman dua tetap satu
    kolom."""
    cv = cv_ramai()
    cv.ringkasan = "Membangun pipeline data andal untuk kebutuhan analitik. " * 80
    data = render_cv(cv)
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        assert len(pdf.pages) >= 2  # memang sampai halaman lanjutan
    baris = baris_pdf(data)
    for kata in baris:
        assert kata[0]["x0"] < 200
    assert _deteksi_dua_kolom(baris) == (False, None)


# ── (c) Round-trip field kunci lewat ekstraksi tahap 3 ────────────────────


def test_round_trip_field_kunci_hadir_di_teks() -> None:
    cv = cv_ramai()
    teks = ekstrak_dokumen(render_cv(cv)).teks
    assert cv.nama in teks
    assert cv.headline in teks
    assert cv.kontak.telepon in teks
    assert cv.kontak.linkedin in teks
    # Tanggal PERSIS YYYY-MM seperti data — bukan direformat jadi 'Jan 2024'.
    for tanggal in ("2022-01", "2024-06", "2020-05", "2021-12", "2021-06"):
        assert tanggal in teks, f"tanggal {tanggal} tidak terbaca utuh"
    for k in cv.keterampilan:
        assert k in teks
    for p in cv.pengalaman:
        assert p.posisi in teks
        assert p.perusahaan in teks
    # Email utuh sebagai SATU token yang bisa ditemukan parser kontak.
    m = re.search(r"[^@\s]+@[^@\s]+\.[^@\s]+", teks)
    assert m and m.group(0) == cv.kontak.email


def test_cv_panjang_multi_halaman_konten_utuh() -> None:
    """Konten yang melebihi satu halaman tidak boleh terpotong diam-diam:
    drawString di luar halaman tidak melempar galat, teksnya HILANG."""
    cv = cv_ramai()
    # 80 pengulangan (~4.300 karakter ≈ 45 baris) benar-benar melampaui
    # kapasitas satu halaman (~52 baris) — 40 pengulangan masih muat dan
    # penjaga ganti halaman tidak pernah teruji.
    cv.ringkasan = "Membangun pipeline data andal untuk kebutuhan analitik. " * 80
    data = render_cv(cv)
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        assert len(pdf.pages) >= 2
    teks = ekstrak_dokumen(data).teks
    assert cv.keterampilan[-1] in teks
    assert "S1 Statistika" in teks
    assert "Disusun oleh Strive Academy" in teks


def test_karakter_tipografis_dinormalisasi_ascii() -> None:
    """AC "ramah parser": karakter dekoratif/tipografis (– — • " " ' ')
    diganti padanan ASCII — mereka memecah kata di parser dan tidak bisa
    digambar font dasar WinAnsi."""
    cv = cv_ramai()
    cv.ringkasan = (
        "Membangun pipeline andal — menurunkan biaya 40 persen • "
        "mengelola gudang data, meningkatkan keandalan dashboards "
        "eksekutif hingga empat kali lipat sejak tahun pertama."
    )
    teks = ekstrak_dokumen(render_cv(cv)).teks
    for ch in ("–", "—", "•", "“", "”", "‘", "’"):
        assert ch not in teks, f"karakter {ch!r} lolos ke PDF"


# ── (d) Skor atas hasil parse ulang ───────────────────────────────────────


def test_skor_parse_ulang_tanpa_penalti_baru() -> None:
    """CV sehat (skor 100) harus tetap 100 SETELAH render → parse ulang:
    render tidak boleh MENAMBAH pelanggaran §13.3 apa pun."""
    cv = cv_ramai()
    hasil_asli = nilai_ats(cv)
    assert hasil_asli.skor == 100, [t.pesan for t in hasil_asli.temuan]

    hasil_parse = nilai_ats(parse_ulang(render_cv(cv)))
    aturan_asli = {t.aturan for t in hasil_asli.temuan}
    aturan_parse = {t.aturan for t in hasil_parse.temuan}
    assert aturan_parse <= aturan_asli, [t.pesan for t in hasil_parse.temuan]
    assert hasil_parse.skor == hasil_asli.skor


def test_penalti_masukan_terbawa_bukan_musnah() -> None:
    """Sisi lain kejujuran round-trip: pelanggaran yang MEMANG ada di
    masukan (telepon kosong) harus tetap terbaca setelah parse ulang —
    render tidak boleh 'menyembuhkan' CV dengan mengarang telepon."""
    cv = cv_ramai()
    cv.kontak = KontakCv(email=cv.kontak.email, telepon=None, linkedin=None)
    hasil_asli = nilai_ats(cv)
    hasil_parse = nilai_ats(parse_ulang(render_cv(cv)))
    assert {t.aturan for t in hasil_asli.temuan} == {"telepon"}
    assert {t.aturan for t in hasil_parse.temuan} == {"telepon"}
    assert hasil_parse.skor == hasil_asli.skor == 95


# ── Determinisme ──────────────────────────────────────────────────────────


def test_render_deterministik_byte_identik() -> None:
    """Dokumen sama → byte PDF sama persis (metadata tanggal dibekukan) —
    semangat yang sama dengan §13.3: keluaran tidak berubah-ubah."""
    assert render_cv(cv_ramai()) == render_cv(cv_ramai())
