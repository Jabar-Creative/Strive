"""Cache hasil LLM — PRD §12.3 + §9.4.

Kunci: `ai:cache:{sha256(sumber + parameter + prompt_version)}`, TTL 7 hari.

Soal aturan keras 7 (Redis adalah turunan): cache ini memang TIDAK bisa
dibangun ulang dari Postgres — isinya hasil komputasi pihak luar, dan
kehilangannya berarti BIAYA (panggilan LLM diulang), bukan kehilangan
kebenaran. Itu sebabnya ia cache dalam arti yang paling murni, dan
penurunan kuncinya dibuat murni supaya dua panggilan dengan isi sama di
sisi mana pun pasti berbagi entri yang sama.

`ambil`/`simpan` tipis dan TIDAK diuji pytest lokal (job `ai service · test`
tidak punya Redis); kebenarannya adalah kontrak redis itu sendiri. Saat
pipeline LLM sungguhan berdiri (AI-02+), jalur ini diuji lewat staging.
"""

import hashlib
import json
from typing import Any

from redis.asyncio import Redis

TTL_DETIK = 7 * 24 * 3600


def kunci_cache(sumber: str, parameter: dict[str, Any], prompt_version: str) -> str:
    """SHA-256 atas bentuk kanonik — urutan kunci dict tidak boleh mengubah kunci."""
    muatan = json.dumps(
        {"sumber": sumber, "parameter": parameter, "prompt_version": prompt_version},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return "ai:cache:" + hashlib.sha256(muatan.encode("utf-8")).hexdigest()


def buat_redis() -> Redis:
    """Satu klien per pemanggil; REDIS_URL dari Settings (§19.2)."""
    from app.core.config import get_settings

    return Redis.from_url(get_settings().REDIS_URL, decode_responses=True)


async def ambil(redis: Redis, kunci: str) -> str | None:
    return await redis.get(kunci)


async def simpan(redis: Redis, kunci: str, nilai: str) -> None:
    await redis.set(kunci, nilai, ex=TTL_DETIK)
