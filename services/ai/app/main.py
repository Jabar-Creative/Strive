"""Entry point AI service.

Runtime terpisah dari Core API karena polanya berbeda: lambat, mahal per
panggilan, sering gagal. Tidak boleh berbagi thread pool dengan API
transaksional (docs/PRD.md §8.2).

`/health` publik (healthcheck platform tidak membawa kredensial, §8.4);
SELURUH rute bisnis di bawah /v1/* dilindungi token service-to-service
(AI-01): hanya Core API yang boleh memanggil (aturan keras 8).
"""

from datetime import datetime, timezone
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.errors import GalatLayanan, penangan_galat
from app.routers import cv, interview, prompt, statement

app = FastAPI(
    title="Strive AI Service",
    version="0.1.0",
    description="Ekstraksi dokumen, penyusunan LLM, skor ATS deterministik, render PDF.",
)

app.add_exception_handler(GalatLayanan, penangan_galat)

for r in (cv.router, prompt.router, interview.router, statement.router):
    app.include_router(r)


class HealthResponse(BaseModel):
    """Cocok dengan `healthResponseSchema` di packages/contracts."""

    status: Literal["ok"]
    service: Literal["ai"]
    mode: Literal["api"]
    timestamp: str


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    # Sengaja TIDAK menyentuh konfigurasi rahasia apa pun — /health tidak boleh
    # jadi jalan membocorkan keadaan kredensial.
    get_settings()
    return HealthResponse(
        status="ok",
        service="ai",
        mode="api",
        timestamp=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    )
