"""`POST /v1/statement` — review personal statement, Mastery Track (MT-03)."""

from fastapi import APIRouter, Depends

from app.core.auth import butuh_token_core
from app.routers._skeleton import JobRequest, belum_diimplementasikan

router = APIRouter(
    prefix="/v1", tags=["statement"], dependencies=[Depends(butuh_token_core)]
)


@router.post("/statement")
async def jalankan_statement(_job: JobRequest) -> None:
    raise belum_diimplementasikan("statement")
