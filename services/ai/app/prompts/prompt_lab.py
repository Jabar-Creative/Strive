"""Prompt Prompt Lab — PL-01 (Dev B), PRD §13.4 + §12.3.

Prompt hidup di file terpisah supaya bisa di-review dan di-diff (§13.4.2),
mengecek `app/prompts/ats_cv.py` sebagai polanya. Mengubah isi system prompt
WAJIB menaikkan PROMPT_VERSION — versi ini ikut balasan run supaya sisi Node
bisa menyimpannya ke `ai_jobs.prompt_version` (§13.4.1). Beda dengan ats_cv:
prompt lab TIDAK punya cache, jadi versi tidak membatalkan kunci apa pun —
ia murni jejak audit prompt mana yang menghasilkan keluaran itu.
"""

# Format contoh di PRD §13.4.1: "ats-cv/2026-09-01".
PROMPT_VERSION = "prompt-lab/2026-10-18"

# Kalimat larangan halusinasi dipakai PERSIS dari PRD §13.4.3 (diuji
# harfiah oleh test string) — "sumber" bagi prompt lab adalah bagian
# context yang dikirim pengguna, diperjelas di aturan kedua di bawah.
SYSTEM_PROMPT_PROMPT_LAB = """Kamu asisten Prompt Lab Strive Academy. Pengguna
sedang belajar menyusun prompt terstruktur; tugasmu MENJALANKAN prompt mereka
apa adanya dan mengembalikan keluaran teks polos.

Aturan paling penting (kalimat berikut adalah kontrak §13.4.3 dan tidak boleh diubah):
JANGAN menambahkan pengalaman, gelar, angka, atau capaian yang tidak ada di sumber. Kalau sebuah field tidak ada datanya, kosongkan — jangan mengarang.

Aturan lain:
- "Sumber" pada aturan di atas adalah bagian context pada prompt pengguna:
  fakta yang tidak tertulis di context tidak boleh muncul di keluaran.
- Jalankan task persis seperti ditulis; jangan memperluas atau mempersempit
  permintaan pengguna.
- Hormati format keluaran dan constraints yang diminta pengguna.
- Keluarkan teks polos tanpa blok kode pembungkus dan tanpa komentar meta
  tentang prompt-nya sendiri.
"""


def buat_permintaan_pengguna(
    *,
    role: str,
    context: str,
    task: str,
    format: str,
    constraints: str,
    bahasa: str,
) -> str:
    """Permintaan pengguna: lima bagian berlabel + bahasa. Deterministik.

    Berlabel eksplisit supaya model tidak mencampur bagian (mis. membaca
    constraints sebagai task) — inilah inti pelajaran Prompt Lab (PL-1).
    """
    return (
        f"Peran (role):\n{role}\n\n"
        f"Konteks (context):\n{context}\n\n"
        f"Tugas (task):\n{task}\n\n"
        f"Bentuk keluaran (format):\n{format}\n\n"
        f"Batasan (constraints):\n{constraints}\n\n"
        f"Bahasa keluaran: {bahasa}."
    )
