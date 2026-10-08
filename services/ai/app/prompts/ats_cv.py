"""Prompt penyusunan CV — AI-03 (Dev B), PRD §13.4 + §12.3.

Prompt hidup di file terpisah supaya bisa di-review dan di-diff (§13.4.2).
Mengubah isinya WAJIB menaikkan PROMPT_VERSION — kunci cache AI-01 memuat
versi ini, jadi menaikkan versi otomatis membatalkan cache lama (§13.4.1).
"""

# Format contoh di PRD §13.4.1: "ats-cv/2026-09-01".
PROMPT_VERSION = "ats-cv/2026-10-08"

# Kalimat larangan halusinasi ditulis EKSPLISIT — kalimatnya dipakai persis
# dari PRD §13.4.3 (diuji dengan 5 dokumen kontrol, lihat test_structur.py).
SYSTEM_PROMPT_ATS_CV = """Kamu penyusun CV untuk mahasiswa Indonesia. Tugasmu
menata ulang isi CV lama menjadi JSON terstruktur; KAMU TIDAK MENULIS CV BARU.

Aturan paling penting:
JANGAN menambahkan pengalaman, gelar, angka, atau capaian yang tidak ada di
sumber. Kalau sebuah field tidak ada datanya, kosongkan — jangan mengarang.

Aturan lain:
- Bahasa keluaran mengikuti parameter bahasa yang diberikan.
- Ringkasan hanya merangkum sumber; dilarang memasukkan angka yang tidak
  tertulis di sumber.
- Tanggal ditulis YYYY-MM kalau bentuknya bisa dipastikan; kalau tidak,
  salin apa adanya dari sumber.
- Output HANYA JSON yang menuruti skema yang diminta, tanpa teks lain.
"""

# Skema JSON yang diminta — kunci bahasa Indonesia, sama dengan ProfilCv
# AI-02: satu bentuk untuk dua arah (profil → teks, teks → struktur).
SKEMA_OUTPUT = """{
  "nama": "string atau null",
  "headline": "string atau null",
  "ringkasan": "string atau null",
  "kontak": {"email": "string atau null", "telepon": "string atau null", "linkedin": "string atau null"},
  "pengalaman": [{"posisi": "string", "perusahaan": "string atau null", "mulai": "YYYY-MM atau null", "selesai": "YYYY-MM atau null", "deskripsi": "string atau null"}],
  "pendidikan": [{"gelar": "string", "institusi": "string atau null", "tahun": "string atau null"}],
  "keterampilan": ["string"],
  "saran": true
}"""


def buat_permintaan_pengguna(
    teks_sumber: str, target_role: str = "", bahasa: str = "id"
) -> str:
    """Permintaan pengguna: sumber + skema + parameter. Deterministik.

    `target_role` dan `bahasa` adalah PARAMETER kunci cache (CV-5): dua
    penyusunan dengan peran sasaran berbeda adalah dua hasil berbeda.
    """
    peran = f"Sasaran pencarian kerja: {target_role}.\n" if target_role else ""
    return (
        f"{peran}"
        f"Bahasa keluaran: {bahasa}.\n\n"
        f"Skema JSON yang diminta:\n{SKEMA_OUTPUT}\n\n"
        f"Sumber (teks mentah hasil ekstraksi):\n{teks_sumber}"
    )


# Instruksi perbaikan untuk percobaan ulang JSON tidak valid — §12.3:
# "retry sekali dengan instruksi perbaikan, lalu gagal".
INSTRUKSI_PERBAIKAN = (
    "Keluaranmu sebelumnya bukan JSON yang valid atau tidak menuruti skema. "
    "Ulangi dan keluarkan HANYA JSON yang menuruti skema, tanpa kalimat "
    "pembuka, penutup, atau blok kode."
)
