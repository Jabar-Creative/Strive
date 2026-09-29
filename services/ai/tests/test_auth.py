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


def test_bearer_non_ascii_401_bukan_500(token_terpasang: str) -> None:
    # Regresi temuan audit AI-01: header non-ASCII ("Bearer café") pernah
    # memicu TypeError dari compare_digest(str, str) dan menjawab 500
    # lengkap dengan traceback di log — untuk penyerang tanpa kredensial.
    # httpx menolak mengirim header non-ASCII, jadi dependency dipanggil
    # dengan Request ASGI mentah — byte UTF-8 di header, persis yang
    # diterima aplikasi dari socket sungguhan (Starlette mendekode latin-1).
    from starlette.requests import Request

    from app.core.auth import butuh_token_core
    from app.core.errors import GalatLayanan

    request = Request(
        scope={
            "type": "http",
            "method": "POST",
            "headers": [(b"authorization", "Bearer café".encode("utf-8"))],
        }
    )
    try:
        butuh_token_core(request)
    except GalatLayanan as galat:
        assert galat.status == 401
    except TypeError:  # pragma: no cover — justru yang dijaga test ini
        pytest.fail("compare_digest masih membandingkan str non-ASCII")


def test_health_terbuka_tanpa_token() -> None:
    assert client.get("/health").status_code == 200


def test_galat_framework_pakai_bentuk_101() -> None:
    # Regresi audit AI-01: 404/405/422 bawaan FastAPI berbentuk {"detail"},
    # melanggar §10.1 yang layanan ini sendiri deklarasikan.
    assert client.get("/v1/tidak-ada").json()["error"]["code"] == "NOT_FOUND"


def test_docs_dimatikan() -> None:
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


@pytest.mark.parametrize("jalur", JALUR)
def test_body_wajib_job_dan_input(jalur: str, token_terpasang: str) -> None:
    # Validasi bentuk permintaan jalan SEBELUM 503: job_id yang bukan uuid
    # dan input yang bukan objek ditolak 422 (permanen di sisi Node).
    salah: dict[str, Any] = {"job_id": "bukan-uuid", "input": {}}
    hasil = client.post(
        jalur, json=salah, headers={"Authorization": f"Bearer {token_terpasang}"}
    )
    assert hasil.status_code == 422
    assert hasil.json()["error"]["code"] == "VALIDATION_ERROR"


def test_body_melebihi_batas_413() -> None:
    # Content-Length dibaca dari header — 413 keluar TANPA membaca body,
    # sebelum auth maupun parse JSON (temuan audit AI-01).
    hasil = client.post(
        "/v1/cv",
        content=b"x",
        headers={"Content-Length": str(11 * 1024 * 1024)},
    )
    assert hasil.status_code == 413
    assert hasil.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"
