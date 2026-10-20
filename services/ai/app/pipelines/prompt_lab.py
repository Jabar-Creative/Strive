"""Pipeline Prompt Lab: lima bagian → keluaran LLM teks polos — PL-01 (Dev B).

TIGA keputusan yang menempel di file ini, semuanya sadar:

1. TIDAK ADA CACHE — dan itu bukan kelalaian. Tiap run Prompt Lab adalah run
   BARU yang dikenai kuota PL-4 (10 run AI/hari, gabungan) dan dipotong 20
   koin oleh Node (PL-3). Cache jawaban akan membuat run kedua dengan isi
   sama tidak terhitung kuota dan tidak dipotong — kebalikan kontrak
   berbayarnya. Bandingkan `structur.py` yang justru cache-first (AI-01)
   karena penyusunan CV deterministik terhadap sumber.

2. Batas kelas feedback (§13.5): `MAKS_TOKEN_KELUARAN` 800 dan temperature
   rendah 0,3 — tugasnya mengeksekusi struktur, bukan berimprovisasi.

3. `TIMEOUT_DETIK` 25, di bawah potongan 30 detik Node (PL-2): layanan harus
   menolak lebih dulu dengan galat §10.1 yang bisa dibaca Node. Kalau tidak,
   yang terjadi adalah klien menggantung sampai dipotong Node tanpa pesan —
   persis kegagalan yang dilarang AC-PL-2.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.core.errors import GalatLayanan
from app.pipelines.llm import LlmKlien
from app.prompts.prompt_lab import (
    PROMPT_VERSION,
    SYSTEM_PROMPT_PROMPT_LAB,
    buat_permintaan_pengguna,
)

TEMPERATURE_PROMPT_LAB = 0.3
MAKS_TOKEN_KELUARAN = 800
TIMEOUT_DETIK = 25.0

# Batas panjang per bagian: penjaga biaya di sisi skema (§13.5), bukan doa di
# sisi vendor. Tanpa ini, satu context 9 MB lolos dari body-limit 10 MB lalu
# ditagih sebagai input token sebelum hard limit vendor sempat bekerja.
MAKS_KARAKTER_BAGIAN = 10_000

# Tidak ada sumber harga per-token di environment layanan ini (§19.2), jadi
# biaya dalam USD memang belum bisa dihitung di sini. Dikirim 0.0 — bukan
# angka karangan — supaya kolom tetap sah bagi pembaca Node (`bacaHasil`
# menuntut number); akuntansi biaya sungguhan menyusul bersama harga vendor.
COST_USD_BELUM_DIHITUNG = 0.0

_BAGIAN_WAJIB = ("role", "context", "task", "format", "constraints")


class BagianPrompt(BaseModel):
    """Lima bagian wajib PL-1 + bahasa opsional (default `id`)."""

    role: str = Field(max_length=MAKS_KARAKTER_BAGIAN)
    context: str = Field(max_length=MAKS_KARAKTER_BAGIAN)
    task: str = Field(max_length=MAKS_KARAKTER_BAGIAN)
    format: str = Field(max_length=MAKS_KARAKTER_BAGIAN)
    constraints: str = Field(max_length=MAKS_KARAKTER_BAGIAN)
    bahasa: str = Field(default="id", min_length=1, max_length=8)

    @field_validator(*_BAGIAN_WAJIB)
    @classmethod
    def _tolak_kosong(cls, nilai: str, info) -> str:  # type: ignore[no-untyped-def]
        # min_length=1 saja meloloskan spasi; bagian yang kosong SETELAH
        # strip tetap tidak bernilai bagi prompt.
        if not nilai.strip():
            raise ValueError(f"bagian '{info.field_name}' tidak boleh kosong")
        return nilai


class HasilPromptLab(BaseModel):
    """Balasan run — DATAR, bukan `usage` bersarang.

    Kontraknya pembaca Node: `bacaHasil` di `ai-service.client.ts` membaca
    keenam kolom ini di level atas; bentuk lain membuat setiap run dianggap
    gagal oleh Node meski LLM-nya sukses.
    """

    output: str
    model: str
    prompt_version: str
    input_tokens: int
    output_tokens: int
    cost_usd: float


async def jalankan_prompt_lab(bagian: BagianPrompt, llm: LlmKlien) -> HasilPromptLab:
    """Satu panggilan LLM, tanpa percobaan ulang: keluarannya teks polos,
    bukan JSON — tidak ada skema untuk "salah bentuk" yang bisa diperbaiki
    dengan instruksi ulang seperti pada `structur.py`."""
    teks, pakai = await llm.teks(
        SYSTEM_PROMPT_PROMPT_LAB,
        buat_permintaan_pengguna(
            role=bagian.role,
            context=bagian.context,
            task=bagian.task,
            format=bagian.format,
            constraints=bagian.constraints,
            bahasa=bagian.bahasa,
        ),
        TEMPERATURE_PROMPT_LAB,
        MAKS_TOKEN_KELUARAN,
        TIMEOUT_DETIK,
    )
    if not teks.strip():
        # Run berbayar tidak boleh menagih 20 koin untuk string kosong.
        raise GalatLayanan(
            422,
            "LLM_OUTPUT_INVALID",
            "Model tidak menghasilkan keluaran untuk run prompt lab",
        )
    return HasilPromptLab(
        output=teks,
        model=pakai.model,
        prompt_version=PROMPT_VERSION,
        input_tokens=pakai.input_tokens,
        output_tokens=pakai.output_tokens,
        cost_usd=COST_USD_BELUM_DIHITUNG,
    )
