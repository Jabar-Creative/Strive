"""Pipeline pemrosesan.

    extract.py    PDF/DOCX -> teks mentah (pdfplumber dengan layout)
    llm.py        teks -> JSON terstruktur, JSON mode + skema Pydantic
    ats_score.py  JSON -> skor 0-100 + temuan. DETERMINISTIK, TANPA LLM.
    render.py     JSON -> PDF satu kolom, tanpa tabel/ikon/header

Batas yang menentukan kualitas fitur CV (docs/PRD.md §7 E8):
LLM MENULIS, KODE MENILAI. Kalau penilaian diserahkan ke LLM, dokumen yang
sama mendapat skor berbeda tiap dijalankan — dan pengguna akan menyadarinya.
"""
