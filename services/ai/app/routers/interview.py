"""`POST /v1/interview` — umpan balik wawancara terpandu, Mastery Track (MT-02)."""

from fastapi import APIRouter, Depends

from app.core.auth import butuh_token_core
from app.routers._skeleton import JobRequest, belum_diimplementasikan

router = APIRouter(
    prefix="/v1", tags=["interview"], dependencies=[Depends(butuh_token_core)]
)


@router.post("/interview")
async def jalankan_interview(_job: JobRequest) -> None:
    raise belum_diimplementasikan("interview")
