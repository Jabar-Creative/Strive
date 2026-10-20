"""`POST /v1/prompt` — menjalankan prompt terstruktur Prompt Lab (PL-01, Dev B).

Jalur dikunci konstanta `JALUR_AI` di sisi Node (isu #132); mengubah nama rute
ini sama dengan memutus Core API diam-diam.

Dua keputusan yang menempel di rute ini:

- TIDAK ADA CACHE — tiap run dihitung kuota PL-4 dan dipotong koin PL-3 oleh
  Node, jadi menjawab dari cache berarti memberi hasil tanpa memotong. Alasan
  lengkap ada di docstring `app/pipelines/prompt_lab.py`.
- Balasan DATAR (bukan `usage` bersarang): `bacaHasil` di
  `ai-service.client.ts` membaca keenam kolom di level atas.

`job_id` diterima sebagai bagian amplop tapi tidak dipakai di sini: penulisan
`ai_jobs` hanya boleh terjadi di sisi Node (aturan 8), layanan ini hanya
menjalankan pekerjaannya.
"""

from collections.abc import Callable
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.auth import butuh_token_core
from app.pipelines.llm import LlmKlien, buat_klien_dari_settings
from app.pipelines.prompt_lab import BagianPrompt, HasilPromptLab, jalankan_prompt_lab

router = APIRouter(prefix="/v1", tags=["prompt"], dependencies=[Depends(butuh_token_core)])


class PromptRunRequest(BaseModel):
    """Amplop permintaan — bentuk sama dengan rute AI lain (isu #132)."""

    job_id: UUID
    input: BagianPrompt


def pabrik_klien_llm() -> Callable[[], LlmKlien]:
    # Pabrik, bukan klien jadi: konstruksi KlienOpenAI melempar 503 saat kunci
    # kosong, dan dependensi FastAPI diselesaikan SEBELUM validasi badan —
    # membangun klien di sini membuat 503 vendor mendahului 422 salah-bentuk,
    # padahal test_auth.py sudah menjanjikan validasi jalan lebih dulu.
    return buat_klien_dari_settings


@router.post("/prompt", response_model=HasilPromptLab)
async def jalankan_prompt(
    job: PromptRunRequest, pabrik: Callable[[], LlmKlien] = Depends(pabrik_klien_llm)
) -> HasilPromptLab:
    return await jalankan_prompt_lab(job.input, pabrik())
