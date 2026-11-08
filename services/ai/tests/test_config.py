"""Penjaga setelan khusus layanan AI."""

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_llm_base_url_non_bawaan_ditolak_di_production() -> None:
    """Audit AI-07 C1: salah set LLM_BASE_URL di produksi berarti kunci API
    dikirim sebagai Bearer ke titik akhir yang salah — gagal-tertutup saat
    boot, bukan bocor diam-diam lalu ketahuan dari tagihan vendor."""
    with pytest.raises(ValidationError):
        Settings(NODE_ENV="production", LLM_BASE_URL="http://127.0.0.1:59998/v1")


def test_llm_base_url_bawaan_sah_di_production() -> None:
    s = Settings(NODE_ENV="production")
    assert s.LLM_BASE_URL == "https://api.openai.com/v1"


def test_llm_base_url_non_bawaan_sah_di_development() -> None:
    s = Settings(NODE_ENV="development", LLM_BASE_URL="http://127.0.0.1:59998/v1")
    assert s.LLM_BASE_URL == "http://127.0.0.1:59998/v1"
