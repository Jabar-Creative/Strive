"""Basis router skeleton AI-01.

Empat router domain (cv, prompt, interview, statement) saat ini menajwab
503 NOT_IMPLEMENTED — sengaja BUKAN 4xx: sisi Node membaca 4xx sebagai
gagal permanen dan langsung menandai `ai_jobs` failed (isu #132), padahal
yang terjadi hanyalah implementasinya belum ditulis (AI-02 ke atas).
503 membuat job dijadwalkan ulang, bukan dikuburkan.

Bentuk permintaan SUDAH divalidasi penuh sekarang: `job_id` uuid dan
`input` objek — supaya ketika implementasi sungguhan datang, kontraknya
sudah terkunci oleh test, bukan oleh kebiasaan penulis pipeline.
"""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.core.errors import GalatLayanan


class JobRequest(BaseModel):
    """Badan permintaan layanan AI — kontrak isu #132."""

    job_id: UUID
    input: dict[str, Any] = Field(default_factory=dict)


def belum_diimplementasikan(domain: Literal["cv", "prompt", "interview", "statement"]) -> GalatLayanan:
    return GalatLayanan(
        503,
        "NOT_IMPLEMENTED",
        f"Router {domain} masih skeleton (AI-01); implementasinya di AI-02 ke atas",
    )
