"""Membangun PDF keputusan manajemen: tujuh blocker non-kode Strive Academy."""

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

OUT = "/Users/fatihmaull/Documents/strive-academy/docs/reports/blocker-non-kode.pdf"

INK = colors.HexColor("#14122B")
INK_SOFT = colors.HexColor("#5B5580")
LINE = colors.HexColor("#DCD8EC")
INDIGO = colors.HexColor("#4F3DE8")
RED = colors.HexColor("#C0392B")
AMBER = colors.HexColor("#B7791F")
GREEN = colors.HexColor("#1E7A5E")
BAND = colors.HexColor("#F4F2FD")

ss = getSampleStyleSheet()


def st(name, **kw):
    base = dict(fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=INK)
    base.update(kw)
    return ParagraphStyle(name, parent=ss["Normal"], **base)


S = {
    "h1": st("h1", fontName="Helvetica-Bold", fontSize=21, leading=25, textColor=INK, spaceAfter=2),
    "sub": st("sub", fontSize=10.5, leading=15, textColor=INK_SOFT),
    "h2": st("h2", fontName="Helvetica-Bold", fontSize=13.5, leading=17, textColor=INK,
             spaceBefore=15, spaceAfter=5),
    "h3": st("h3", fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=INK,
             spaceBefore=9, spaceAfter=3),
    "body": st("body", alignment=TA_JUSTIFY, spaceAfter=5),
    "small": st("small", fontSize=8.5, leading=12, textColor=INK_SOFT),
    "cell": st("cell", fontSize=8.5, leading=11.5),
    "cellb": st("cellb", fontName="Helvetica-Bold", fontSize=8.5, leading=11.5),
    "cellhead": st("cellhead", fontName="Helvetica-Bold", fontSize=8.5, leading=11.5,
                   textColor=colors.white),
    "num": st("num", fontName="Helvetica-Bold", fontSize=8.5, leading=11.5, alignment=TA_RIGHT),
    "kicker": st("kicker", fontName="Helvetica-Bold", fontSize=8, leading=11,
                 textColor=INDIGO, spaceAfter=2),
    "quote": st("quote", fontSize=9.5, leading=14, textColor=INK, leftIndent=9,
                borderPadding=0, spaceBefore=3, spaceAfter=6),
}


def P(text, style="body"):
    return Paragraph(text, S[style])


def rule(color=LINE, thickness=0.6, space=5):
    t = Table([[""]], colWidths=[170 * mm], rowHeights=[0.1])
    t.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), thickness, color),
                           ("TOPPADDING", (0, 0), (-1, -1), space),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), space)]))
    return t


def table(data, widths, header=True, zebra=True, align=None):
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    cmds = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -2), 0.35, LINE),
    ]
    if header:
        cmds += [("BACKGROUND", (0, 0), (-1, 0), INK),
                 ("LINEBELOW", (0, 0), (-1, 0), 0, colors.white)]
    if zebra:
        for i in range(1 if header else 0, len(data)):
            if (i - (1 if header else 0)) % 2 == 1:
                cmds.append(("BACKGROUND", (0, i), (-1, i), BAND))
    if align:
        cmds += align
    t.setStyle(TableStyle(cmds))
    return t


def urgency_chip(label, color):
    t = Table([[Paragraph(f'<font color="white"><b>{label}</b></font>', S["cell"])]],
              colWidths=[26 * mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), color),
                           ("TOPPADDING", (0, 0), (-1, -1), 3),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                           ("LEFTPADDING", (0, 0), (-1, -1), 6),
                           ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    return t


# ───────────────────────────────────────────────────────────── data

BLOCKERS = [
    {
        "n": 1,
        "nama": "Domain + akun cloud",
        "chip": ("SEKARANG", RED),
        "blokir": "F-05 · Minggu 1",
        "status": "Sudah menghambat. F-05 ditandai blocked di papan status hari ini.",
        "kenapa": (
            "Ini satu-satunya item Minggu 1 yang sudah berhenti. Gate Minggu 1 berbunyi "
            "\"staging hidup dan menerima deploy dari main\" — gate itu tidak bisa lolos tanpa "
            "tempat untuk men-deploy. Pekerjaan teknisnya sudah siap: build Docker untuk web, "
            "api, dan AI service sudah terbukti jalan."
        ),
        "keputusan": (
            "Pilih penyedia cloud dan daftarkan domainnya. Penyedia belum ditentukan di PRD §12, "
            "jadi tim developer tidak boleh memilih sendiri — itu menambah ketergantungan vendor "
            "tanpa keputusan."
        ),
        "biaya": "Estimasi Rp 300–800 ribu/bulan untuk staging kecil, plus domain ~Rp 200 ribu/tahun.",
        "pemilik": "Manajemen teknis / operasional",
    },
    {
        "n": 2,
        "nama": "Pemilik konten (±90 kartu belajar)",
        "chip": ("SEKARANG", RED),
        "blokir": "L-04 · gate Minggu 3",
        "status": "Belum ada nama. Nol kartu selesai.",
        "kenapa": (
            "Ini risiko terbesar di seluruh rencana, dan sifatnya bukan teknis. Dua developer bisa "
            "menyelesaikan seluruh rantai teknis tepat waktu dan tetap tidak punya apa pun untuk "
            "didemokan, karena kartu belajarnya kosong. Kalau kedua developer yang menulis konten, "
            "hilang 5–8 hari dari 72,5 dev-hari yang ada — sementara rencananya sudah kelebihan beban."
        ),
        "keputusan": (
            "Tunjuk satu orang di luar tim developer sebagai pemilik konten, dengan target ±90 kartu "
            "untuk satu track selesai sebelum akhir Minggu 3. Kalau tidak ada orangnya, turunkan "
            "target ke 40 kartu dan terima itu sebagai batas beta — keputusan itu lebih murah "
            "diambil sekarang daripada di Minggu 3."
        ),
        "biaya": "Waktu 1 orang non-developer, ±2 minggu paruh waktu.",
        "pemilik": "Manajemen produk / konten",
    },
    {
        "n": 3,
        "nama": "API key LLM + batas biaya di dashboard vendor",
        "chip": ("MINGGU 3", AMBER),
        "blokir": "AI-03 · Minggu 5",
        "status": "Belum ada akun.",
        "kenapa": (
            "Dua hal sekaligus. Pertama, tanpa API key, pipeline CV dan Mastery Track tidak bisa "
            "diuji sama sekali. Kedua — dan ini yang lebih mahal — batas biaya harus dipasang di "
            "dashboard vendor sejak hari pertama, bukan setelah tagihan pertama datang. Satu bug "
            "loop bisa menghabiskan anggaran sebulan dalam semalam."
        ),
        "keputusan": (
            "Buka akun OpenAI (atau Google Gemini), tetapkan batas biaya bulanan, dan sepakati "
            "ambang alert harian. Target biaya di PRD: di bawah Rp 500 per pengguna aktif per bulan."
        ),
        "biaya": "Prabayar; usulkan plafon awal USD 50–100/bulan untuk beta.",
        "pemilik": "Manajemen keuangan + teknis",
    },
    {
        "n": 4,
        "nama": "Akun sandbox Midtrans",
        "chip": ("MINGGU 3", AMBER),
        "blokir": "P-02 · Minggu 5",
        "status": "Belum didaftarkan.",
        "kenapa": (
            "Verifikasi merchant bisa memakan berhari-hari sampai berminggu-minggu, dan itu di luar "
            "kendali tim. Kalau baru didaftarkan di Minggu 5, seluruh alur pembayaran mundur. "
            "Sandbox cukup untuk beta; go-live pembayaran sudah direncanakan sebagai item pasca-beta."
        ),
        "keputusan": (
            "Daftarkan akun Midtrans sekarang dan mulai proses verifikasi merchant, meski fiturnya "
            "baru dipakai empat minggu lagi."
        ),
        "biaya": "Sandbox gratis. Live: fee ~2,9% per transaksi (sudah masuk perhitungan margin).",
        "pemilik": "Manajemen keuangan / legal",
    },
    {
        "n": 5,
        "nama": "Akun Copyleaks + harga kontrak aktual",
        "chip": ("MINGGU 4", AMBER),
        "blokir": "K-03 · Minggu 7 · dan verifikasi margin",
        "status": "Belum ada akun. Harga kontrak belum diketahui.",
        "kenapa": (
            "Harga ke pengguna sudah dikunci: 2.400 koin (Rp 60.000) per scan. Yang belum diketahui "
            "adalah biaya vendor sebenarnya — angka Rp 24.000 di PRD masih ilustrasi dengan asumsi "
            "Rp 2.000 per 1.000 kata. Artinya margin 57% yang jadi dasar seluruh model bisnis belum "
            "terverifikasi. Aturan PRD tegas: kalau biaya vendor lebih tinggi dari asumsi, naikkan "
            "harga scan, jangan tipiskan margin."
        ),
        "keputusan": (
            "Buka akun Copyleaks, minta penawaran kontrak, lalu hitung ulang margin dengan formula "
            "PRD §6.4. Kalau margin di bawah target, harga scan perlu ditinjau ulang — dan itu "
            "mengubah PRD §5 Q7 yang sudah terkunci, jadi lebih murah diketahui sekarang."
        ),
        "biaya": "Per-halaman, tergantung kontrak. Inilah angka yang sedang dicari.",
        "pemilik": "Manajemen keuangan + produk",
    },
    {
        "n": 6,
        "nama": "Lisensi Retool + Resend",
        "chip": ("MINGGU 3", AMBER),
        "blokir": "N-01 · Minggu 4 · SA-04 · Minggu 8",
        "status": "Belum berlangganan.",
        "kenapa": (
            "Keduanya adalah komponen yang sengaja dibeli, bukan dibangun. Retool menggantikan panel "
            "admin React (hemat 2 hari), Resend menggantikan layanan email sendiri (hemat 0,5 hari). "
            "Tanpa lisensinya, 2,5 hari itu kembali jadi pekerjaan developer — di rencana yang sudah "
            "kelebihan 4,5 hari."
        ),
        "keputusan": (
            "Berlangganan keduanya. Resend dibutuhkan lebih dulu (Minggu 4), Retool bisa menyusul "
            "(Minggu 8)."
        ),
        "biaya": "Resend mulai gratis untuk volume beta. Retool ~USD 10–15/pengguna/bulan.",
        "pemilik": "Manajemen operasional",
    },
    {
        "n": 7,
        "nama": "Konsultasi hukum status Strive Coins",
        "chip": ("SEBELUM RILIS", INDIGO),
        "blokir": "Pembukaan top-up ke publik",
        "status": "Belum dikonsultasikan.",
        "kenapa": (
            "Koin dirancang non-transferable, non-refundable, dan tidak kedaluwarsa — supaya "
            "statusnya voucher sekali pakai, bukan alat pembayaran. Rancangan itu perlu dikonfirmasi "
            "penasihat hukum SEBELUM top-up dibuka ke publik, bukan sesudah. Ini tidak memblokir "
            "pengembangan; yang diblokir adalah penjualan."
        ),
        "keputusan": (
            "Jadwalkan konsultasi dengan penasihat hukum yang memahami regulasi uang elektronik dan "
            "voucher di Indonesia. Bawa PRD §5 Q2 sebagai bahan."
        ),
        "biaya": "Sekali konsultasi. Jauh lebih murah daripada menghentikan penjualan setelah rilis.",
        "pemilik": "Manajemen / legal",
    },
]


# ───────────────────────────────────────────────────────────── halaman

def on_page(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(INK_SOFT)
    canvas.drawString(20 * mm, 12 * mm, "Strive Academy - Blocker non-kode - 15 September 2026")
    canvas.drawRightString(190 * mm, 12 * mm, f"Halaman {doc.page}")
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.4)
    canvas.line(20 * mm, 15 * mm, 190 * mm, 15 * mm)
    canvas.restoreState()


story = []

# ── Sampul ──────────────────────────────────────────────────────────
story.append(Spacer(1, 4 * mm))
story.append(P("DOKUMEN KEPUTUSAN MANAJEMEN", "kicker"))
story.append(P("Tujuh hal yang menghambat Strive Academy,<br/>dan tidak satu pun bisa diselesaikan developer", "h1"))
story.append(Spacer(1, 3 * mm))
story.append(P(
    "Proyek Strive Academy berjalan dengan dua developer selama delapan minggu. Seluruh pekerjaan "
    "teknisnya sudah dipetakan menjadi 73 item yang terjadwal. Dokumen ini bukan tentang pekerjaan itu.",
    "sub"))
story.append(Spacer(1, 2 * mm))
story.append(P(
    "Dokumen ini tentang tujuh kebutuhan yang <b>memblokir pekerjaan itu</b> dan <b>berada di luar "
    "kendali tim developer</b>: akun vendor, lisensi, pemilik konten, dan satu konsultasi hukum. "
    "Semuanya butuh keputusan dan tanda tangan manajemen. Sampai itu terjadi, item yang "
    "bergantung padanya akan berhenti — bukan melambat, berhenti.",
    "sub"))
story.append(Spacer(1, 6 * mm))
story.append(rule(INDIGO, 1.2))

story.append(P("Ringkasan untuk yang tidak sempat membaca semuanya", "h2"))
story.append(P(
    "<b>Dua dari tujuh sudah menghambat hari ini.</b> Yang lain punya tenggat yang bisa dihitung mundur. "
    "Rencana proyek ini terisi 107% (72,5 dev-hari pekerjaan terhadap 68 dev-hari kapasitas), "
    "artinya <b>tidak ada cadangan waktu sama sekali</b> untuk menunggu.",
    "body"))

ringkas = [[
    Paragraph("#", S["cellhead"]), Paragraph("Kebutuhan", S["cellhead"]),
    Paragraph("Memblokir", S["cellhead"]), Paragraph("Kapan dibutuhkan", S["cellhead"]),
    Paragraph("Pemilik yang diusulkan", S["cellhead"]),
]]
for b in BLOCKERS:
    ringkas.append([
        Paragraph(str(b["n"]), S["num"]),
        Paragraph(f"<b>{b['nama']}</b>", S["cell"]),
        Paragraph(b["blokir"], S["cell"]),
        Paragraph(f'<font color="#{b["chip"][1].hexval()[2:]}"><b>{b["chip"][0]}</b></font>', S["cell"]),
        Paragraph(b["pemilik"], S["cell"]),
    ])
story.append(Spacer(1, 2 * mm))
story.append(table(ringkas, [8 * mm, 46 * mm, 34 * mm, 28 * mm, 40 * mm]))

keadaan = [[
    Paragraph("Ukuran", S["cellhead"]), Paragraph("Angka", S["cellhead"]),
    Paragraph("Artinya", S["cellhead"]),
]]
for row in [
    ("Total pekerjaan", "73 item - 72,5 dev-hari", "Seluruh fitur pada kedalaman v0.1"),
    ("Kapasitas tersedia", "68 dev-hari", "2 developer x 8 minggu, dipotong 15% overhead"),
    ("Tingkat keterisian", "107%", "Kelebihan 4,5 hari. Tidak ada cadangan."),
    ("Selesai sejauh ini", "2 item - 1,0 dev-hari", "F-02 dan F-10, keduanya Minggu 1"),
    ("Menunggu review", "2 item - 2,5 dev-hari", "F-01 dan F-03"),
    ("Terblokir", "1 item - 1,5 dev-hari", "F-05, menunggu akun cloud (nomor 1)"),
]:
    keadaan.append([Paragraph(row[0], S["cellb"]), Paragraph(row[1], S["cell"]),
                    Paragraph(row[2], S["cell"])])

# Dijaga utuh: tabel ini terbelah dua halaman menyisakan satu baris yatim.
story.append(KeepTogether([
    Spacer(1, 5 * mm),
    P("Keadaan proyek hari ini", "h3"),
    table(keadaan, [40 * mm, 45 * mm, 71 * mm]),
    Spacer(1, 4 * mm),
    P(
        "<b>Satu kabar baik:</b> delapan keputusan produk yang sebelumnya ada di daftar ini sudah "
        "diselesaikan dan dikunci pada 14 September 2026. Nilai koin, kredit freeze, dan pembentukan "
        "squad kini final, dan pekerjaan skema database yang bergantung padanya sudah berjalan.",
        "body"),
]))

# ── Detail ──────────────────────────────────────────────────────────
story.append(P("Rincian tujuh kebutuhan", "h2"))
story.append(P(
    "Setiap kebutuhan ditulis dengan format yang sama: apa yang diblokir, kenapa mendesak, "
    "keputusan apa yang dibutuhkan, dan perkiraan biayanya.",
    "body"))
story.append(Spacer(1, 2 * mm))

for b in BLOCKERS:
    blok = []
    hdr = Table(
        [[Paragraph(f'<font color="white"><b>{b["n"]}</b></font>', S["cellhead"]),
          Paragraph(f'<font color="white"><b>{b["nama"]}</b></font>', S["cellhead"]),
          urgency_chip(b["chip"][0], b["chip"][1])]],
        colWidths=[9 * mm, 127 * mm, 28 * mm])
    hdr.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (1, 0), INK),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    blok.append(hdr)

    meta = [[
        Paragraph("<b>Memblokir</b>", S["cell"]), Paragraph(b["blokir"], S["cell"]),
        Paragraph("<b>Status</b>", S["cell"]), Paragraph(b["status"], S["cell"]),
    ]]
    m = Table(meta, colWidths=[20 * mm, 45 * mm, 17 * mm, 82 * mm])
    m.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BAND),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    blok.append(m)
    blok.append(Spacer(1, 2.5 * mm))
    blok.append(P("Kenapa mendesak", "h3"))
    blok.append(P(b["kenapa"], "body"))
    blok.append(P("Keputusan yang dibutuhkan", "h3"))
    blok.append(P(b["keputusan"], "body"))
    blok.append(P(f'<b>Perkiraan biaya.</b> {b["biaya"]}', "small"))
    blok.append(Spacer(1, 6 * mm))
    story.append(KeepTogether(blok))

story.append(PageBreak())

# ── Konsekuensi & lembar keputusan ──────────────────────────────────
story.append(P("Kalau tidak diputuskan", "h2"))
story.append(P(
    "Rencana ini tidak punya cadangan. Setiap kebutuhan yang tertunda tidak menggeser satu item, "
    "tapi menggeser seluruh rantai di belakangnya. Tabel di bawah menunjukkan apa yang terjadi "
    "kalau masing-masing dibiarkan.",
    "body"))

konsekuensi = [[
    Paragraph("Kalau ini tertunda", S["cellhead"]),
    Paragraph("Yang terjadi", S["cellhead"]),
    Paragraph("Bisa dipulihkan?", S["cellhead"]),
]]
for row in [
    ("Domain + akun cloud",
     "Gate Minggu 1 tidak lolos. Tidak ada tempat memverifikasi apa pun sampai rilis, dan setiap bug integrasi baru ketahuan di laptop developer.",
     "Ya, begitu akun ada"),
    ("Pemilik konten",
     "Minggu 3 tiba tanpa kartu belajar. Demo tidak bisa dilakukan meski seluruh kode selesai. Kalau developer yang menulis, 5-8 dev-hari hilang dari rencana yang sudah kelebihan beban.",
     "Sebagian - waktu yang hilang tidak kembali"),
    ("API key LLM",
     "Seluruh fitur AI (CV, Prompt Lab, Mastery Track) tidak bisa diuji. Tanpa batas biaya terpasang, risiko tagihan tak terduga nyata.",
     "Ya"),
    ("Akun Midtrans",
     "Alur pembayaran mundur dari Minggu 5. Verifikasi merchant di luar kendali tim, jadi lamanya tidak bisa diperkirakan.",
     "Tergantung vendor"),
    ("Akun + harga Copyleaks",
     "Fitur yang paling menghasilkan uang tidak bisa diselesaikan. Lebih dari itu: margin 57% yang jadi dasar model bisnis tetap belum terverifikasi.",
     "Ya, tapi harga mungkin perlu ditinjau"),
    ("Lisensi Retool + Resend",
     "2,5 dev-hari kembali jadi pekerjaan developer, di rencana yang sudah kelebihan 4,5 hari.",
     "Ya"),
    ("Konsultasi hukum",
     "Top-up tidak boleh dibuka ke publik. Produk bisa rilis, tapi tidak bisa menghasilkan uang.",
     "Ya, tapi menunda pendapatan"),
]:
    konsekuensi.append([Paragraph(f"<b>{row[0]}</b>", S["cell"]),
                        Paragraph(row[1], S["cell"]),
                        Paragraph(row[2], S["cell"])])
story.append(Spacer(1, 2 * mm))
story.append(table(konsekuensi, [34 * mm, 90 * mm, 32 * mm]))

story.append(Spacer(1, 6 * mm))
story.append(P("Satu rekomendasi yang tidak diminta, tapi perlu disebut", "h2"))
story.append(P(
    "Rencana delapan minggu ini terisi 107% <b>sebelum</b> memperhitungkan satu pun keterlambatan "
    "di atas. Analisis jadwal proyek menyebut tiga pilihan: tetap delapan minggu dengan dua "
    "developer, <b>menambah satu minggu</b>, atau menambah developer ketiga.",
    "body"))
story.append(P(
    "Pilihan menambah satu minggu adalah yang paling murah dan satu-satunya yang tidak "
    "mengorbankan apa pun: seluruh fitur tetap hadir pada kedalaman yang sama, dan minggu "
    "kesembilan dipakai murni untuk pengerasan dengan cadangan empat hari. Menambah developer "
    "ketiga di tengah proyek pendek jarang secepat yang diharapkan, karena onboarding memakan "
    "waktu dua orang yang sudah kelebihan beban.",
    "body"))
story.append(P(
    "Keputusan ini tidak mendesak hari ini. Tapi titik keputusannya sudah ditetapkan di akhir "
    "Minggu 5, dan akan jauh lebih mudah diambil kalau tujuh kebutuhan di dokumen ini sudah "
    "selesai sebelum itu.",
    "body"))

story.append(PageBreak())

story.append(P("Lembar keputusan", "h2"))
story.append(P(
    "Halaman ini bisa dicetak dan dibawa ke rapat. Setiap baris butuh satu nama dan satu tanggal. "
    "Kolom terakhir sengaja dibiarkan kosong.",
    "body"))
story.append(Spacer(1, 3 * mm))

lembar = [[
    Paragraph("#", S["cellhead"]), Paragraph("Kebutuhan", S["cellhead"]),
    Paragraph("Disetujui?", S["cellhead"]), Paragraph("Penanggung jawab", S["cellhead"]),
    Paragraph("Target selesai", S["cellhead"]),
]]
for b in BLOCKERS:
    lembar.append([
        Paragraph(str(b["n"]), S["num"]),
        Paragraph(f"<b>{b['nama']}</b><br/><font size=7.5 color='#5B5580'>Memblokir {b['blokir']}</font>", S["cell"]),
        Paragraph("Ya / Tidak", S["cell"]),
        Paragraph("", S["cell"]),
        Paragraph("", S["cell"]),
    ])
story.append(table(lembar, [8 * mm, 66 * mm, 20 * mm, 40 * mm, 26 * mm], zebra=False,
                   align=[("GRID", (0, 0), (-1, -1), 0.35, LINE),
                          ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.white]),
                          ("TOPPADDING", (0, 1), (-1, -1), 9),
                          ("BOTTOMPADDING", (0, 1), (-1, -1), 9)]))

story.append(Spacer(1, 8 * mm))
story.append(rule(LINE))
story.append(P(
    "<b>Sumber.</b> Angka dan tenggat di dokumen ini diambil dari dokumen perencanaan proyek: "
    "DELIVERY-PLAN.md bagian 10 (kebutuhan sebelum hari pertama), BACKLOG.md (papan status, "
    "diperiksa 15 September 2026), dan PRD.md bagian 5, 6, dan 12 (keputusan produk, ekonomi koin, "
    "integrasi vendor). Status papan terverifikasi langsung terhadap isi repositori, bukan disalin "
    "dari klaim.",
    "small"))
story.append(Spacer(1, 2 * mm))
story.append(P(
    "<b>Yang TIDAK ada di dokumen ini.</b> Seluruh pekerjaan teknis, estimasi, dan penjadwalan item "
    "sudah tercakup di dokumen perencanaan dan tidak butuh keputusan manajemen. Dokumen ini hanya "
    "memuat hal-hal yang tim developer tidak bisa selesaikan sendiri.",
    "small"))

doc = BaseDocTemplate(OUT, pagesize=A4,
                      leftMargin=20 * mm, rightMargin=20 * mm,
                      topMargin=18 * mm, bottomMargin=20 * mm,
                      title="Strive Academy - Tujuh blocker non-kode",
                      author="Tim Strive Academy",
                      subject="Dokumen keputusan manajemen")
frame = Frame(doc.leftMargin, doc.bottomMargin,
              doc.width, doc.height, id="normal")
doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=on_page)])
doc.build(story)
print(f"PDF ditulis: {OUT}")
