#!/usr/bin/env bash
# feat-040 — local REAL-IMAGE smoke for the Avery agent-service container.
#
# Proves the deploy artifact actually works before it ever touches the shared production ECS box:
#   build -> run under a --memory cap -> /health (200, all fields) -> /ingest the REAL seed files
#   (200 => python-multipart present, no 500) -> tenant isolation (feat-038: wrong/no token = 404)
#   -> RAM guard (feat-039 total-body 413) -> disguised type (415) -> rate limit (429).
#
# Offline + hermetic: AVERY_BRAIN=mock, in-memory registry (no DB, no key). Host port 18137 so it
# never collides with a dev server on :8137. Run from the repo root:  scripts/deploy/smoke_docker.sh
set -uo pipefail

IMG=avery-agent:feat040
NAME=avery-smoke-040
HOSTPORT=18137
BASE="http://127.0.0.1:${HOSTPORT}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SEED="${REPO}/eval-harness/tests/fixtures/seed"
TMP="$(mktemp -d)"
FAILS=0
pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; FAILS=$((FAILS+1)); }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "== [1/9] build =="
docker build -q -t "$IMG" -f "${REPO}/eval-harness/Dockerfile" "${REPO}/eval-harness" >/dev/null || { echo "build FAILED"; exit 1; }
echo "  built $IMG ($(docker images "$IMG" --format '{{.Size}}'))"

echo "== [2/9] run (--memory=512m, curated hard-gate env) =="
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --memory=512m -p ${HOSTPORT}:8137 \
  -e AVERY_BRAIN=mock \
  -e AVERY_MEM_WARN_MB=2048 \
  -e AVERY_LLM_CALL_BUDGET=5 \
  -e AVERY_MAX_TOTAL_UPLOAD_BYTES=200000 \
  -e AVERY_MAX_UPLOAD_BYTES=100000 \
  -e AVERY_RATE_INGEST_PER_MIN=1 \
  -e AVERY_RATE_INGEST_BURST=3 \
  -e AVERY_TRUSTED_PROXY_HOPS=0 \
  "$IMG" >/dev/null || { echo "run FAILED"; exit 1; }

echo "== [3/9] wait for /health =="
ready=0
for i in $(seq 1 40); do
  if curl -fsS "${BASE}/health" >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] && pass "service up" || { fail "service never came up"; docker logs "$NAME"; exit 1; }

echo "== [4/9] /health contract =="
H="$(curl -s "${BASE}/health")"
echo "  $H"
echo "$H" | grep -q '"status": *"ok"'              && pass "status=ok"            || fail "status"
echo "$H" | grep -q '"brain": *"mock"'             && pass "brain=mock"          || fail "brain"
echo "$H" | grep -q '"extraction_mode": *"heuristic"' && pass "extraction_mode=heuristic" || fail "extraction_mode"
echo "$H" | grep -q '"available": *true'           && pass "memory.available=true (psutil in image)" || fail "memory.available"
echo "$H" | grep -q '"warn_mb": *2048'             && pass "memory.warn_mb=2048" || fail "warn_mb"
echo "$H" | grep -q '"llm_calls_remaining": *5'    && pass "llm_calls_remaining=5" || fail "llm_calls_remaining"
echo "$H" | grep -q '"degraded": *false'           && pass "degraded=false"      || fail "degraded"

echo "== [5/9] /ingest happy path (real seed files) =="
IJSON="${TMP}/ingest.json"
CODE="$(curl -s -o "$IJSON" -w '%{http_code}' -X POST "${BASE}/ingest" \
  -F "files=@${SEED}/LogiPulse-Roadmap.pdf" \
  -F "files=@${SEED}/PrismDesign_TeamProfile_EN.xlsx")"
if [ "$CODE" = 200 ]; then pass "/ingest 200 (python-multipart OK, no 500)"; else fail "/ingest got $CODE"; cat "$IJSON"; fi
CTX="$(grep -o '"context_id": *"[^"]*"' "$IJSON" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
TOK="$(grep -o '"owner_token": *"[^"]*"' "$IJSON" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
[ -n "$CTX" ] && pass "context_id=${CTX:0:12}..." || fail "no context_id"
[ -n "$TOK" ] && pass "owner_token minted (${#TOK} chars)" || fail "no owner_token"

echo "== [6/9] tenant isolation (feat-038) =="
C_NONE="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/team/${CTX}")"
C_WRONG="$(curl -s -o /dev/null -w '%{http_code}' -H "X-Avery-Token: not-the-token" "${BASE}/team/${CTX}")"
C_OK="$(curl -s -o /dev/null -w '%{http_code}' -H "X-Avery-Token: ${TOK}" "${BASE}/team/${CTX}")"
[ "$C_NONE"  = 404 ] && pass "no token  -> 404" || fail "no-token got $C_NONE"
[ "$C_WRONG" = 404 ] && pass "wrong tok -> 404 (no existence oracle)" || fail "wrong-token got $C_WRONG"
[ "$C_OK"    = 200 ] && pass "owner tok -> 200" || fail "owner-token got $C_OK"

echo "== [7/9] RAM guard: total-body cap (feat-039) =="
head -c 250000 /dev/zero | tr '\0' 'A' > "${TMP}/big.txt"
C_BIG="$(curl -s -o "${TMP}/big.out" -w '%{http_code}' -X POST "${BASE}/ingest" -F "files=@${TMP}/big.txt")"
[ "$C_BIG" = 413 ] && pass "250KB upload -> 413 (cap 200000)" || fail "oversize got $C_BIG"

echo "== [8/9] disguised type (feat-039) =="
printf '%%PDF-1.7 fake pdf bytes renamed as text' > "${TMP}/evil.txt"
C_DIS="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/ingest" -F "files=@${TMP}/evil.txt")"
[ "$C_DIS" = 415 ] && pass "disguised .txt (PDF magic) -> 415" || fail "disguised got $C_DIS"

echo "== [9/9] rate limit 429 (feat-039 token bucket) =="
# burst=3 already consumed by happy+413+415 above; rapid probes should now trip 429.
got429=0
for i in 1 2 3; do
  printf 'ping %s' "$i" > "${TMP}/p.txt"
  C="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/ingest" -F "files=@${TMP}/p.txt")"
  echo "    probe $i -> $C"
  [ "$C" = 429 ] && got429=1
done
[ "$got429" = 1 ] && pass "rapid /ingest -> 429 (per-IP limiter)" || fail "no 429 seen"

echo "== container health + memory cap =="
docker inspect --format 'Health={{.State.Health.Status}}  MemLimit={{.HostConfig.Memory}}' "$NAME"
echo "== rate-limit log line =="
docker logs "$NAME" 2>&1 | grep -i "rate limit" | tail -2 || true

echo
if [ "$FAILS" = 0 ]; then echo "SMOKE: ALL GREEN"; else echo "SMOKE: ${FAILS} FAILURE(S)"; fi
exit "$FAILS"
