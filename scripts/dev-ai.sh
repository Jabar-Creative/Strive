#!/usr/bin/env bash
# Menjalankan AI service dari root repo.
#
# Venv dibuat sekali lalu dipakai ulang. Penanda `.venv/.installed` ditulis
# HANYA setelah pip selesai, dan memuat hash requirements.txt — supaya venv yang
# setengah jadi (mis. proses dimatikan di tengah install) tidak ikut dipakai,
# dan supaya requirements yang berubah memicu install ulang.
set -euo pipefail
cd "$(dirname "$0")/../services/ai"

STAMP=.venv/.installed
WANT="$(shasum -a 256 requirements.txt | cut -d' ' -f1)"
HAVE="$(cat "$STAMP" 2>/dev/null || true)"

if [ ! -x .venv/bin/python ] || [ "$WANT" != "$HAVE" ]; then
  echo "[ai] menyiapkan .venv (requirements berubah atau venv belum lengkap)..."
  rm -rf .venv
  python3 -m venv .venv
  ./.venv/bin/pip install --quiet --upgrade pip
  ./.venv/bin/pip install --quiet -r requirements.txt
  echo "$WANT" > "$STAMP"
  echo "[ai] .venv siap."
fi

exec ./.venv/bin/python -m uvicorn app.main:app --reload --port "${AI_SERVICE_PORT:-8000}"
