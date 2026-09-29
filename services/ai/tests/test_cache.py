"""Kunci cache LLM — PRD §12.3: SHA-256(sumber + parameter + prompt_version),
prefiks `ai:cache:`, TTL 7 hari (§9.4 menamai kunci yang sama).

Bagian yang diuji adalah PENURUNAN KUNCInya (murni):redis-nya sendiri
adalah pembungkus tipis yang dibuktikan CI staging, bukan pytest lokal —
job `ai service · test` tidak punya Redis.
"""

from app.core.cache import TTL_DETIK, kunci_cache


def test_kunci_berprefiks_dan_panjang_sha256() -> None:
    k = kunci_cache("sumber-cv", {"model": "gpt-4o"}, "ats-cv/2026-09-01")
    assert k.startswith("ai:cache:")
    assert len(k) == len("ai:cache:") + 64  # hex sha-256


def test_kunci_stabil_untuk_masukan_sama() -> None:
    a = kunci_cache("sumber", {"x": 1}, "v1")
    b = kunci_cache("sumber", {"x": 1}, "v1")
    assert a == b


def test_masukan_berbeda_kunci_berbeda() -> None:
    dasar = kunci_cache("sumber", {"x": 1}, "v1")
    assert kunci_cache("sumber-lain", {"x": 1}, "v1") != dasar
    assert kunci_cache("sumber", {"x": 2}, "v1") != dasar
    assert kunci_cache("sumber", {"x": 1}, "v2") != dasar


def test_dict_urutan_kunci_berbeda_kunci_sama() -> None:
    # JSON dari dua dict dengan isi sama tapi urutan serialization beda
    # harus jatuh ke kunci sama — kuncinya dinormalisasi, bukan str(dict).
    a = kunci_cache("s", {"a": 1, "b": 2}, "v")
    b = kunci_cache("s", {"b": 2, "a": 1}, "v")
    assert a == b


def test_ttl_tujuh_hari() -> None:
    assert TTL_DETIK == 7 * 24 * 3600
