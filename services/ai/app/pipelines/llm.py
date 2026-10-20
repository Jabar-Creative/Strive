"""Klien LLM untuk layanan AI — AI-03 (Dev B), PRD §12.3.

Antarmuka (`LlmKlien`) tipis dan DIINJEKSI: seluruh logika pipeline yang
bisa gagal diuji dengan klien palsu, dan vendor sungguhan (OpenAI/Gemini)
hanya dipegang dua fungsi pembungkus HTTP. Kredensial HANYA dari Settings
(env) — tidak pernah di kode, tidak pernah di log (§12 aturan 2).

Batas yang ditegakkan di sini (§12.3):
- temperature 0,2 untuk penyusunan CV — tugas penataan, bukan kreatif.
- timeout 60 detik.
- output JSON mode.

`teks()` (mulai PL-01) adalah panggilan teks polos untuk pemanggil yang
keluarannya BUKAN JSON (Prompt Lab): batas token dan timeout ditentukan
PEMANGGIL karena tiap domain punya angkanya sendiri — Prompt Lab memakai
800 token / 25 dtk (§13.5 kelas feedback; Node memotong sinkronnya di
30 dtk), penyusunan CV tetap 4096 / 60 dtk.

Kode galat: kegagalan transport/timeout/5xx → 502 `PROVIDER_UNAVAILABLE`
(kode LAMA, sudah hidup di gateway RT-01); kunci belum diisi → 503
`PROVIDER_UNAVAILABLE` gagal-tertutup. Keduanya di luar daftar tertutup
§10.2 — dicatat di isu #197 untuk dipetakan batas klien.
"""

from __future__ import annotations

from typing import Any, Protocol

import httpx
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.errors import GalatLayanan

TEMPERATURE_PENYUSUNAN = 0.2
TIMEOUT_DETIK = 60.0
# Knop biaya terakhir (temuan audit AI-03): tanpa batas keluaran, satu CV
# padat atau instruksi tersembunyi "keluarkan JSON sangat panjang" hanya
# ditahan default model (16 ribu token) × 2 percobaan. 4096 cukup untuk
# StructuredCV dari sumber 15 ribu kata (batas hulu AI-02).
MAKS_TOKEN_KELUARAN = 4096


class PemakaianLlm(BaseModel):
    """Catatan pemakaian satu panggilan — §12.3, disimpan ke ai_jobs Node."""

    model: str
    input_tokens: int
    output_tokens: int


class LlmKlien(Protocol):
    """Kontrak klien: satu panggilan, keluar teks + pemakaian."""

    @property
    def model_nama(self) -> str: ...

    async def json(self, system: str, user: str, temperature: float) -> tuple[str, PemakaianLlm]:
        """Keluar (teks_json, pemakaian). Galat → GalatLayanan §10.1."""
        ...

    async def teks(
        self,
        system: str,
        user: str,
        temperature: float,
        maks_token: int,
        timeout_detik: float,
    ) -> tuple[str, PemakaianLlm]:
        """Keluar (teks_polos, pemakaian) tanpa JSON mode.

        `maks_token` dan `timeout_detik` WAJIB eksplisit: keduanya kenop
        biaya dan batas waktu yang berbeda per domain — memaksa pemanggil
        menyebut angkanya membuat angka itu bisa dikunci test.
        """
        ...


def _galat_transport(penyebab: str) -> GalatLayanan:
    return GalatLayanan(
        502,
        "PROVIDER_UNAVAILABLE",
        f"Kegagalan memanggil LLM: {penyebab}",
    )


class KlienOpenAI:
    """POST /v1/chat/completions dengan response_format json_object.

    Tanpa SDK resmi (nol dependensi baru — httpx sudah ada); jalur ini
    diuji di staging saat kunci terisi, bukan di CI tanpa kunci.
    """

    def __init__(self, api_key: str, model: str, base_url: str = "https://api.openai.com/v1") -> None:
        if not api_key:
            # Gagal-tertutup: tanpa kunci, PANGGILAN TIDAK PERNAH dikirim —
            # lebih baik 503 yang jujur daripada 401 dari vendor.
            raise GalatLayanan(
                503,
                "PROVIDER_UNAVAILABLE",
                "OPENAI_API_KEY belum dikonfigurasi",
            )
        self._api_key = api_key
        self._model = model
        self._base_url = base_url

    @property
    def model_nama(self) -> str:
        return self._model

    async def json(self, system: str, user: str, temperature: float) -> tuple[str, PemakaianLlm]:
        return await self._panggil_chat(
            system,
            user,
            temperature,
            maks_token=MAKS_TOKEN_KELUARAN,
            timeout_detik=TIMEOUT_DETIK,
            response_format={"type": "json_object"},
        )

    async def teks(
        self,
        system: str,
        user: str,
        temperature: float,
        maks_token: int,
        timeout_detik: float,
    ) -> tuple[str, PemakaianLlm]:
        return await self._panggil_chat(
            system,
            user,
            temperature,
            maks_token=maks_token,
            timeout_detik=timeout_detik,
            # None = kunci response_format TIDAK dikirim sama sekali:
            # JSON mode akan memaksa model membungkus teks polos dalam
            # kutip JSON — rusak untuk pemanggil teks (Prompt Lab).
            response_format=None,
        )

    async def _panggil_chat(
        self,
        system: str,
        user: str,
        temperature: float,
        maks_token: int,
        timeout_detik: float,
        response_format: dict[str, str] | None,
    ) -> tuple[str, PemakaianLlm]:
        muatan: dict[str, Any] = {
            "model": self._model,
            "temperature": temperature,
            "max_completion_tokens": maks_token,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if response_format is not None:
            muatan["response_format"] = response_format
        try:
            async with httpx.AsyncClient(timeout=timeout_detik) as klien:
                respons = await klien.post(
                    f"{self._base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    json=muatan,
                )
        except httpx.HTTPError as ex:
            raise _galat_transport(f"jaringan ({type(ex).__name__})") from ex

        if respons.status_code >= 500:
            raise _galat_transport(f"HTTP {respons.status_code} dari vendor")
        if respons.status_code >= 400:
            # 4xx = permintaan kita salah (kunci, kuota, model); jangan
            # diulang diam-diam — pesannya membawa kode vendor tanpa isi
            # dokumen pengguna.
            raise GalatLayanan(
                502,
                "PROVIDER_UNAVAILABLE",
                f"LLM menolak permintaan (HTTP {respons.status_code})",
            )

        try:
            # Body non-JSON dari vendor (200 tapi rusak) juga harus jatuh ke
            # 502 §10.1, bukan ValueError 500 (temuan audit AI-03).
            isi = respons.json()
            teks = isi["choices"][0]["message"]["content"] or ""
            pakai = isi.get("usage") or {}
            pemakaian = PemakaianLlm(
                model=self._model,
                input_tokens=int(pakai.get("prompt_tokens", 0)),
                output_tokens=int(pakai.get("completion_tokens", 0)),
            )
        except (KeyError, IndexError, TypeError, ValueError) as ex:
            raise _galat_transport(f"bentuk respons tidak dikenali ({type(ex).__name__})") from ex
        return teks, pemakaian


def buat_klien_dari_settings() -> LlmKlien:
    """Klien sesuai LLM_PROVIDER (§19.2). Gemini menyusul — saat ini
    provider selain openai gagal-tertutup sampai implementasinya ada,
    bukan diam-diam memanggil OpenAI dengan kunci kosong."""
    s = get_settings()
    if s.LLM_PROVIDER == "openai":
        return KlienOpenAI(api_key=s.OPENAI_API_KEY, model=s.LLM_MODEL)
    raise GalatLayanan(
        503,
        "PROVIDER_UNAVAILABLE",
        f"LLM_PROVIDER '{s.LLM_PROVIDER}' belum didukung",
    )
