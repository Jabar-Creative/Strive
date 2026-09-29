"""`POST /v1/prompt` — penyusunan LLM terstruktur dari prompt lab (AI-03)."""

from fastapi import APIRouter, Depends

from app.core.auth import butuh_token_core
from app.routers._skeleton import JobRequest, belum_diimplementasikan

router = APIRouter(prefix="/v1", tags=["prompt"], dependencies=[Depends(butuh_token_core)])


@router.post("/prompt")
async def jalankan_prompt(_job: JobRequest) -> None:
    raise belum_diimplementasikan("prompt")
