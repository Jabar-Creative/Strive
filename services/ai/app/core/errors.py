"""Galat layanan AI dengan bentuk respons seragam.

Bentuknya mengikuti docs/PRD.md §10.1 (`{ error: { code, message } }`)
supaya sisi Node mencabang pada `code`, bukan mem-parsing pesan — meski
layanan ini Python, kontrak galatnya satu untuk seluruh sistem.
"""

from fastapi import Request
from fastapi.responses import JSONResponse


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
