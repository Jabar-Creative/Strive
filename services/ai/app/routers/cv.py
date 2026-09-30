"""`POST /v1/cv` — skor ATS dari dokumen CV (AI-02, AI-04).

Jalur dan kontraknya dikunci konstanta `JALUR_AI` di sisi Node (isu #132);
mengubah nama rute ini sama dengan memutus Core API diam-diam.
"""

from fastapi import APIRouter, Depends

from app.core.auth import butuh_token_core
from app.routers._skeleton import JobRequest, belum_diimplementasikan

router = APIRouter(prefix="/v1", tags=["cv"], dependencies=[Depends(butuh_token_core)])


@router.post("/cv")
async def jalankan_cv(_job: JobRequest) -> None:
    raise belum_diimplementasikan("cv")
