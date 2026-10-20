"""Galat layanan AI dengan bentuk respons seragam.

Bentuknya mengikuti docs/PRD.md §10.1 (`{ error: { code, message } }`)
supaya sisi Node mencabang pada `code`, bukan mem-parsing pesan — meski
layanan ini Python, kontrak galatnya satu untuk seluruh sistem.

Termasuk galat FRAMEWORK: 422 validasi, 404 rute, dan 405 method bawaan
FastAPI memakai `{"detail": …}`. Repo ini sudah punya jebakan terdokumentari
tentang "satu API, dua bentuk galat"; kedua handler di bawah menutupnya di
sini sebelum ada pemanggil yang sempat mengandalkan bentuk yang salah.
"""

from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

_JENIS_DASAR = (str, int, float, bool, type(None))


def _sanitasi_ctx(daftar_galat: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Validator kustom pydantic menyimpan objek ValueError ASLI di ctx; kalau
    # diteruskan mentah ke JSONResponse, json.dumps melempar TypeError dan
    # 422 yang sah berubah 500 (ditemukan lewat validator BagianPrompt, PL-01).
    # Stringify menjaga pesan validator tetap terbaca tanpa membawa objeknya.
    for galat in daftar_galat:
        ctx = galat.get("ctx")
        if isinstance(ctx, dict):
            galat["ctx"] = {
                kunci: nilai if isinstance(nilai, _JENIS_DASAR) else str(nilai)
                for kunci, nilai in ctx.items()
            }
    return daftar_galat


class GalatLayanan(Exception):
    """Galat yang dibawa ke pengguna apa adanya dengan bentuk §10.1."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


async def penangan_galat(request: Request, exc: GalatLayanan) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status,
        content={"error": {"code": exc.code, "message": exc.message}},
    )


async def penangan_validasi(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Bentuk permintaan tidak sesuai kontrak (isu #132)",
                "details": {"errors": _sanitasi_ctx(exc.errors()[:10])},
            }
        },
    )


async def penangan_http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": code, "message": str(exc.detail)}},
    )
