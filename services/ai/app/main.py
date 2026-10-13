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

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import get_settings
from app.core.errors import (
    GalatLayanan,
    penangan_galat,
    penangan_http,
    penangan_validasi,
)
from app.routers import cv, interview, prompt, statement

# Batas ukuran body rute bisnis. PDF CV terbesar yang wajar jauh di bawah
# ini; tanpa batas, penyerang TANPA token pun bisa memaksa proses membaca
# dan mem-parse body raksasa sebelum auth sempat menjawab (temuan audit
# AI-01: FastAPI membaca body di handler, setelah dependency). Middleware
# ini membaca Content-Length saja — header, bukan body — jadi 413 keluar
# sebelum satu byte pun dialokasikan.
BATAS_BODY = 10 * 1024 * 1024

app = FastAPI(
    title="Strive AI Service",
    version="0.1.0",
    description="Ekstraksi dokumen, penyusunan LLM, skor ATS deterministik, render PDF.",
    # Peta rute tidak ada konsumennya di luar tim, dan membuka pengintaian
    # gratis di domain publik staging (temuan audit AI-01).
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_exception_handler(GalatLayanan, penangan_galat)
app.add_exception_handler(RequestValidationError, penangan_validasi)
app.add_exception_handler(StarletteHTTPException, penangan_http)


@app.middleware("http")
async def batasi_body(request: Request, call_next):
    # `scope["path"]` = path ASGI mentah. `request.url.path` dipulihkan dari
    # Host header (rentan manipulasi — CVE-2026-48710 BadHost di starlette,
    # temuan audit AI-02): host cacat bisa membuatnya tidak berawalan /v1/
    # dan melewati gerbang ini.
    if request.scope["path"].startswith("/v1/"):
        panjang = request.headers.get("content-length")
        if panjang is not None and panjang.isdigit() and int(panjang) > BATAS_BODY:
            return Response(
                status_code=413,
                content='{"error":{"code":"PAYLOAD_TOO_LARGE","message":"Body melebihi 10 MB"}}',
                media_type="application/json",
            )
    return await call_next(request)


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
