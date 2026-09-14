"""Konfigurasi AI service.

Hanya membaca variabel yang BENAR-BENAR dipakai service ini, sesuai
docs/PRD.md §19.2. Kredensial datang HANYA dari environment variable —
tidak pernah di kode, tidak pernah di log (docs/PRD.md §12 aturan 2).
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    # ── Core ────────────────────────────────────────────────────────────
    NODE_ENV: Literal["development", "production"] = "development"
    APP_URL: str = "http://localhost:3000"
    API_URL: str = "http://localhost:3001"

    # Cache hasil LLM: SHA-256(sumber + parameter + prompt_version), TTL 7 hari
    # (docs/PRD.md §12.3, §9.4 kunci `ai:cache:{sha256}`).
    REDIS_URL: str = "redis://localhost:6379"

    # ── LLM ─────────────────────────────────────────────────────────────
    LLM_PROVIDER: Literal["openai", "gemini"] = "openai"
    OPENAI_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    LLM_MODEL: str = "gpt-4o"

    # ── Auth service-to-service ─────────────────────────────────────────
    # HANYA Core API yang boleh memanggil service ini (item AI-01).
    AI_SERVICE_URL: str = "http://localhost:8000"
    AI_SERVICE_TOKEN: str = ""

    # ── Storage ─────────────────────────────────────────────────────────
    S3_ENDPOINT: str = "http://localhost:9000"
    S3_BUCKET_DOCUMENTS: str = "strive-documents"
    S3_BUCKET_ASSETS: str = "strive-assets"
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""

    # ── Observability ───────────────────────────────────────────────────
    SENTRY_DSN: str = ""
    LOG_LEVEL: str = "info"

    # ── Feature flag ────────────────────────────────────────────────────
    FEATURE_MASTERY_ENABLED: bool = True


@lru_cache
def get_settings() -> Settings:
    """Dibaca sekali per proses."""
    return Settings()
