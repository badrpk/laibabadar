#!/usr/bin/env bash
set -euo pipefail
APP_PORT="${APP_PORT:-8080}"
RUN_CMD=""
cd "$(dirname "$0")/.."
if [[ -z "${RUN_CMD}" ]]; then
  if [[ -f package.json ]]; then
    command -v npm >/dev/null || { echo "npm not found"; exit 1; }
    npm ci --omit=dev || npm install --omit=dev
    if [[ -f server.js ]]; then RUN_CMD="node server.js";
    elif [[ -f app.js ]]; then RUN_CMD="node app.js";
    else RUN_CMD="node ."; fi
  elif [[ -f requirements.txt ]]; then
    PYBIN="${PYBIN:-python3}"
    $PYBIN -m venv .venv || true
    source .venv/bin/activate
    pip install -U pip
    pip install -r requirements.txt
    if grep -qi flask requirements.txt 2>/dev/null; then
      RUN_CMD=".venv/bin/gunicorn -b 0.0.0.0:${APP_PORT} app:app"
    else
      RUN_CMD="$PYBIN app.py"
    fi
  else
    echo "No package.json or requirements.txt found. Set RUN_CMD env."
    exit 1
  fi
fi
cat > run.sh <<RS
#!/usr/bin/env bash
set -euo pipefail
cd "\$(dirname "\$0")"
export PORT=${APP_PORT}
exec ${RUN_CMD}
RS
chmod +x run.sh
echo "[deploy] run.sh ready -> ${RUN_CMD}"
