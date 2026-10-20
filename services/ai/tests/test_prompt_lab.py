"""Test `POST /v1/prompt` — Prompt Lab sisi layanan AI (PL-01).

LLM DIINJEKSI sebagai palsu (pola test_structur.py): vendor sungguhan
tanpa kunci tidak bisa diuji di CI, dan yang bernilai justru keputusannya —
batas token kelas feedback, timeout di bawah potongan 30 dtk Node (PL-2),
dan bentuk balasan DATAR yang dibaca `bacaHasil` di sisi Node.
"""

import asyncio
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.errors import GalatLayanan
from app.main import app
from app.pipelines.llm import PemakaianLlm
from app.pipelines.prompt_lab import (
    MAKS_TOKEN_KELUARAN,
    TEMPERATURE_PROMPT_LAB,
    TIMEOUT_DETIK,
    BagianPrompt,
    jalankan_prompt_lab,
)
from app.prompts.prompt_lab import (
    PROMPT_VERSION,
    SYSTEM_PROMPT_PROMPT_LAB,
    buat_permintaan_pengguna,
)
from app.routers.prompt import pabrik_klien_llm

client = TestClient(app)

JOB_ID = "11111111-1111-4111-8111-111111111111"

# Kalimat ini adalah KONTRAK §13.4.3, bukan gaya penulisan: test string di
# bawah menguncinya harfiah supaya penyuntingan santai tidak mengikisnya.
LARANGAN_HALUSINASI = (
    "JANGAN menambahkan pengalaman, gelar, angka, atau capaian yang tidak ada "
    "di sumber. Kalau sebuah field tidak ada datanya, kosongkan — jangan mengarang."
)

BAGIAN = {
    "role": "Kamu reviewer CV mahasiswa",
    "context": "CV milik mahasiswa tingkat akhir tanpa pengalaman kerja",
    "task": "Buat tiga saran perbaikan bagian pengalaman",
    "format": "Daftar bernomor, maksimal 3 poin",
    "constraints": "Bahasa Indonesia, tanpa istilah asing",
}


class LlmPalsu:
    """Klien teks-palsu; argumen dicatat supaya batas bisa dikunci test."""

    def __init__(self, jawaban: str | Exception = "HASIL-DARI-LLM") -> None:
        self.jawaban = jawaban
        self.panggilan: list[dict[str, Any]] = []

    @property
    def model_nama(self) -> str:
        return "palsu-mini"

    async def teks(
        self, system: str, user: str, temperature: float, maks_token: int, timeout_detik: float
    ) -> tuple[str, PemakaianLlm]:
        self.panggilan.append(
            {
                "system": system,
                "user": user,
                "temperature": temperature,
                "maks_token": maks_token,
                "timeout": timeout_detik,
            }
        )
        if isinstance(self.jawaban, Exception):
            raise self.jawaban
        return self.jawaban, PemakaianLlm(
            model="palsu-mini", input_tokens=120, output_tokens=48
        )


def body(isi: dict[str, Any]) -> dict[str, Any]:
    return {"job_id": JOB_ID, "input": isi}


@pytest.fixture
def llm_palsu() -> LlmPalsu:
    palsu = LlmPalsu()
    # Dependensinya PABRIK klien (konstruksi ditunda lewat validasi badan),
    # jadi override juga pabrik: pabrik palsu mengembalikan klien palsu.
    app.dependency_overrides[pabrik_klien_llm] = lambda: (lambda: palsu)
    yield palsu
    app.dependency_overrides.pop(pabrik_klien_llm, None)


# ── Skema permintaan (PL-1) ───────────────────────────────────────────────


@pytest.mark.parametrize("bagian_hilang", ["role", "context", "task", "format", "constraints"])
def test_bagian_hilang_ditolak(bagian_hilang: str, token_terpasang: str) -> None:
    isi = {k: v for k, v in BAGIAN.items() if k != bagian_hilang}
    hasil = client.post(
        "/v1/prompt", json=body(isi), headers={"Authorization": f"Bearer {token_terpasang}"}
    )
    assert hasil.status_code == 422
    assert hasil.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize("bagian_kosong", ["role", "context", "task", "format", "constraints"])
def test_bagian_kosong_ditolak(bagian_kosong: str, token_terpasang: str) -> None:
    isi = dict(BAGIAN)
    isi[bagian_kosong] = ""
    hasil = client.post(
        "/v1/prompt", json=body(isi), headers={"Authorization": f"Bearer {token_terpasang}"}
    )
    assert hasil.status_code == 422
    assert hasil.json()["error"]["code"] == "VALIDATION_ERROR"


def test_bagian_spasi_ditolak(token_terpasang: str) -> None:
    # "   " lolos min_length apa adanya — kosong setelah strip tetap kosong.
    isi = dict(BAGIAN)
    isi["constraints"] = "   "
    hasil = client.post(
        "/v1/prompt", json=body(isi), headers={"Authorization": f"Bearer {token_terpasang}"}
    )
    assert hasil.status_code == 422


def test_bagian_raksasa_ditolak_sebelum_menyentuh_llm(
    token_terpasang: str, llm_palsu: LlmPalsu
) -> None:
    # Penjaga biaya (§13.5): tanpa batas panjang, satu context 9 MB lolos
    # dari body-limit 10 MB lalu ditagih sebagai input token.
    isi = dict(BAGIAN)
    isi["context"] = "x" * 100_001
    hasil = client.post(
        "/v1/prompt", json=body(isi), headers={"Authorization": f"Bearer {token_terpasang}"}
    )
    assert hasil.status_code == 422
    assert llm_palsu.panggilan == []


def test_bahasa_opsional_lolos_validasi(token_terpasang: str, llm_palsu: LlmPalsu) -> None:
    hasil = client.post(
        "/v1/prompt", json=body(BAGIAN), headers={"Authorization": f"Bearer {token_terpasang}"}
    )
    assert hasil.status_code == 200


# ── Prompt berversi (§13.4) ───────────────────────────────────────────────


def test_prompt_version_berformat_domain_tanggal() -> None:
    assert PROMPT_VERSION.startswith("prompt-lab/2")


def test_system_prompt_memuat_larangan_halusinasi_verbatim() -> None:
    assert LARANGAN_HALUSINASI in SYSTEM_PROMPT_PROMPT_LAB


def test_permintaan_memuat_lima_bagian_dan_bahasa() -> None:
    teks = buat_permintaan_pengguna(
        role=BAGIAN["role"],
        context=BAGIAN["context"],
        task=BAGIAN["task"],
        format=BAGIAN["format"],
        constraints=BAGIAN["constraints"],
        bahasa="en",
    )
    for bagian in BAGIAN.values():
        assert bagian in teks
    assert "en" in teks


# ── Pipeline ──────────────────────────────────────────────────────────────


def test_llm_palsu_mengembalikan_output() -> None:
    bagian = BagianPrompt(**BAGIAN)
    hasil = asyncio.run(jalankan_prompt_lab(bagian, LlmPalsu("JAWABAN")))
    assert hasil.output == "JAWABAN"
    assert hasil.prompt_version == PROMPT_VERSION
    assert hasil.model == "palsu-mini"
    assert hasil.input_tokens == 120
    assert hasil.output_tokens == 48


def test_batas_dikunci_kelas_feedback_25_detik() -> None:
    # §13.5 (800 token, kelas feedback) + PL-2 (Node memotong di 30 dtk):
    # layanan wajib menolak lebih dulu, bukan membiarkan klien menggantung.
    palsu = LlmPalsu()
    asyncio.run(jalankan_prompt_lab(BagianPrompt(**BAGIAN), palsu))
    assert palsu.panggilan[0]["temperature"] == TEMPERATURE_PROMPT_LAB == 0.3
    assert palsu.panggilan[0]["maks_token"] == MAKS_TOKEN_KELUARAN == 800
    assert palsu.panggilan[0]["timeout"] == TIMEOUT_DETIK <= 25.0


def test_bahasa_default_id() -> None:
    palsu = LlmPalsu()
    asyncio.run(jalankan_prompt_lab(BagianPrompt(**BAGIAN), palsu))
    assert "Bahasa keluaran: id" in palsu.panggilan[0]["user"]


def test_output_kosong_gagal_dengan_kode() -> None:
    with pytest.raises(GalatLayanan) as info:
        asyncio.run(jalankan_prompt_lab(BagianPrompt(**BAGIAN), LlmPalsu("   ")))
    assert info.value.code == "LLM_OUTPUT_INVALID"
    assert info.value.status == 422


def test_kegagalan_llm_menjalar_tanpa_ditelen() -> None:
    galat = GalatLayanan(502, "PROVIDER_UNAVAILABLE", "vendor timeout")
    with pytest.raises(GalatLayanan) as info:
        asyncio.run(jalankan_prompt_lab(BagianPrompt(**BAGIAN), LlmPalsu(galat)))
    assert info.value.code == "PROVIDER_UNAVAILABLE"


# ── Rute HTTP ─────────────────────────────────────────────────────────────


def test_run_berhasil_balasan_datar_untuk_node(token_terpasang: str, llm_palsu: LlmPalsu) -> None:
    # Kontrak pembaca Node (`bacaHasil` di ai-service.client.ts): output,
    # model, prompt_version, input_tokens, output_tokens, cost_usd — DATAR.
    # `usage` bersarang akan membuat SETIAP run dibaca gagal oleh Node.
    hasil = client.post(
        "/v1/prompt", json=body(BAGIAN), headers={"Authorization": f"Bearer {token_terpasang}"}
    )
    assert hasil.status_code == 200
    isi = hasil.json()
    assert set(isi) == {
        "output",
        "model",
        "prompt_version",
        "input_tokens",
        "output_tokens",
        "cost_usd",
    }
    assert isi["output"] == "HASIL-DARI-LLM"
    assert isi["prompt_version"] == PROMPT_VERSION
    assert isinstance(isi["cost_usd"], (int, float))


def test_kegagalan_llm_bentuk_101(token_terpasang: str) -> None:
    palsu = LlmPalsu(GalatLayanan(502, "PROVIDER_UNAVAILABLE", "vendor timeout"))
    app.dependency_overrides[pabrik_klien_llm] = lambda: (lambda: palsu)
    try:
        hasil = client.post(
            "/v1/prompt",
            json=body(BAGIAN),
            headers={"Authorization": f"Bearer {token_terpasang}"},
        )
    finally:
        app.dependency_overrides.pop(pabrik_klien_llm, None)
    assert hasil.status_code == 502
    assert hasil.json()["error"]["code"] == "PROVIDER_UNAVAILABLE"


def test_tanpa_token_401() -> None:
    # Rute ini tetap di balik token service-to-service setelah punya
    # implementasi nyata — 401 keluar SEBELUM klien LLM dibangun.
    hasil = client.post("/v1/prompt", json=body(BAGIAN))
    assert hasil.status_code == 401
    assert hasil.json()["error"]["code"] == "UNAUTHENTICATED"
