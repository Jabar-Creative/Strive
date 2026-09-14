"""Test /health — satu-satunya test di sesi fondasi.

Ada bukan karena /health penting, tapi untuk membuktikan pytest terpasang dan
bentuk test yang diharapkan sudah jelas sebelum AI-01 dimulai.
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_mengembalikan_ok() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "ai"


def test_health_timestamp_iso8601() -> None:
    # docs/PRD.md §10.1: tanggal SELALU ISO 8601.
    from datetime import datetime

    body = client.get("/health").json()
    datetime.fromisoformat(body["timestamp"].replace("Z", "+00:00"))
