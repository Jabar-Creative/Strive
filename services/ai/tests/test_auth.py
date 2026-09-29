"""AC AI-01: hanya Core API yang bisa memanggil layanan AI.

Panggilan tanpa token → 401. Token salah → 401. /health tetap terbuka
karena healthcheck platform (Railway) tidak membawa kredensial dan tidak
boleh membawa (PRD §8.4).
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

# Empat jalur persis konstanta JALUR_AI di apps/api (isu #132).
JALUR = ["/v1/cv", "/v1/prompt", "/v1/interview", "/v1/statement"]

BODY = {"job_id": "11111111-1111-4111-8111-111111111111", "input": {}}


@pytest.mark.parametrize("jalur", JALUR)
def test_tanpa_token_401(jalur: str) -> None:
    assert client.post(jalur, json=BODY).status_code == 401


@pytest.mark.parametrize("jalur", JALUR)
def test_token_salahl_401(jalur: str) -> None:
    hasil = client.post(jalur, json=BODY, headers={"Authorization": "Bearer salah"})
    assert hasil.status_code == 401
    # Bentuk galat mengikuti §10.1 supaya sisi Node mencabang pada code.
    assert hasil.json()["error"]["code"] == "UNAUTHENTICATED"


@pytest.mark.parametrize("jalur", JALUR)
def test_skema_bukan_bearer_401(jalur: str) -> None:
    hasil = client.post(jalur, json=BODY, headers={"Authorization": "Basic apa"})
    assert hasil.status_code == 401


@pytest.mark.parametrize("jalur", JALUR)
def test_token_benar_bukan_401(jalur: str, token_terpasang: str) -> None:
    hasil = client.post(
        jalur, json=BODY, headers={"Authorization": f"Bearer {token_terpasang}"}
    )
    # Skeleton belum mengimplementasikan pekerjaan (AI-02+): 503 sementara,
    # BUKAN 4xx — 4xx dibaca Node sebagai gagal permanen (isu #132) dan
    # akan menandai job failed padahal hanya belum ada implementasinya.
    assert hasil.status_code == 503
    assert hasil.json()["error"]["code"] == "NOT_IMPLEMENTED"


def test_token_kosong_gagal_tertutup(monkeypatch: pytest.MonkeyPatch) -> None:
    # Layanan tanpa token terkonfigurasi menolak SEMUA panggilan bisnis,
    # termasuk yang membawa Bearer kosong — jangan pernah "kebetulan cocok".
    from app.core.config import get_settings

    monkeypatch.setenv("AI_SERVICE_TOKEN", "")
    get_settings.cache_clear()
    hasil = client.post("/v1/cv", json=BODY, headers={"Authorization": "Bearer "})
    assert hasil.status_code == 401
    get_settings.cache_clear()


def test_health_terbuka_tanpa_token() -> None:
    assert client.get("/health").status_code == 200


@pytest.mark.parametrize("jalur", JALUR)
def test_body_wajib_job_dan_input(jalur: str, token_terpasang: str) -> None:
    # Validasi bentuk permintaan jalan SEBELUM 503: job_id yang bukan uuid
    # dan input yang bukan objek ditolak 422 (permanen di sisi Node).
    salah: dict[str, Any] = {"job_id": "bukan-uuid", "input": {}}
    assert (
        client.post(
            jalur, json=salah, headers={"Authorization": f"Bearer {token_terpasang}"}
        ).status_code
        == 422
    )
