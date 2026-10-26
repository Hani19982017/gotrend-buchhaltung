#!/usr/bin/env bash
# Starts a fresh server with an empty data dir and runs the browser test.
set -e
cd "$(dirname "$0")/.."
PORT=${PORT:-3100}
DATA=$(mktemp -d)

PORT=$PORT DATA_DIR=$DATA node server/index.js > "${LOG:-/tmp/gt-e2e-server.log}" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$DATA"' EXIT
for i in $(seq 1 50); do curl -sf "http://localhost:$PORT/api/health" >/dev/null && break; sleep 0.1; done
BASE="http://localhost:$PORT" node test/e2e.mjs
