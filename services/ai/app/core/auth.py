"""Auth service-to-service — AI-01 (AC: panggilan tanpa token → 401).

HANYA Core API yang boleh memanggil layanan ini. Kredensialnya satu token
bersama (`AI_SERVICE_TOKEN`, §19.2) yang dua pihak baca dari environment
masing-masing — Core API mengirimkannya sebagai `Authorization: Bearer …`
(lihat `ai-service.client.ts` di apps/api, isu #132).

Tiga keputusan yang disengaja:

1. `secrets.compare_digest`, bukan `==` — perbandingan tetap konstan-waktu
   walau token panjangnya beda; ini batas kebocoran timing paling murah
   yang bisa dipasang di sini.
2. Token kosong = layanan menolak SEMUA panggilan bisnis (gagal-tertutup).
   "Belum dikonfigurasi" tidak boleh berarti "terbuka untuk siapa saja",
   termasuk untuk pemanggil yang kebetulan juga mengirim Bearer kosong.
3. Skema selain `Bearer` ditolak dengan 401 yang sama — tanpa membedakan
   "skema tak dikenal" dari "token salah", supaya respons tidak menjadi
   alat enumerasi.
"""

import secrets

from fastapi import Request

from app.core.errors import GalatLayanan


def butuh_token_core(request: Request) -> None:
    from app.core.config import get_settings

    token = get_settings().AI_SERVICE_TOKEN
    skema, _, nilai = request.headers.get("authorization", "").partition(" ")

    # Dibandingkan sebagai BYTES, bukan str: secrets.compare_digest untuk
    # str menolak non-ASCII (TypeError → 500), dan header yang dikirim
    # klien bisa memuat byte UTF-8 apa pun — Starlette mendekodenya
    # latin-1. Temuan audit AI-01: "Bearer café" pernah menjawab 500,
    # lengkap dengan traceback di log, untuk penyerang tanpa kredensial.
    sah = (
        token != ""
        and skema.lower() == "bearer"
        and secrets.compare_digest(nilai.strip().encode("utf-8"), token.encode("utf-8"))
    )
    if not sah:
        raise GalatLayanan(401, "UNAUTHENTICATED", "Token layanan tidak sah atau tidak ada")
