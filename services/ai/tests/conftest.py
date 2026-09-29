"""Fixture bersama test AI service.

Token layanan di-inject lewat environment supaya pengujian auth tidak
bergantung pada `.env` developer mana pun — dan `get_settings()` yang
ter-cache dibersihkan tiap test, karena tanpa itu test pertama yang
kebetulan jalan lebih dulu "mengunci" tokennya untuk semua test lain.
"""

from collections.abc import Iterator

import pytest

from app.core.config import get_settings

TOKEN_UJI = "token-uji-service-to-service"


@pytest.fixture
def token_terpasang(monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    monkeypatch.setenv("AI_SERVICE_TOKEN", TOKEN_UJI)
    get_settings.cache_clear()
    yield TOKEN_UJI
    get_settings.cache_clear()
