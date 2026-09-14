"""Entry point AI service.

Runtime terpisah dari Core API karena polanya berbeda: lambat, mahal per
panggilan, sering gagal. Tidak boleh berbagi thread pool dengan API
transaksional (docs/PRD.md §8.2).

Satu endpoint di sesi fondasi ini: /health. Router sungguhan menyusul di AI-01.
"""

from datetime import datetime, timezone
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from app.core.config import get_settings

app = FastAPI(
    title="Strive AI Service",
    version="0.0.0",
    description="Ekstraksi dokumen, penyusunan LLM, skor ATS deterministik, render PDF.",
)


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
