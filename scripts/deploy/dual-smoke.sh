#!/usr/bin/env bash
# feat-018 (ADR-0021 §5) — the DUAL smoke gate. One command that proves BOTH deploy sides hold,
# offline where possible, WITHOUT deploying anything (no Vercel, no 境内 host, no promote, no keys
# required). This is the AFK green gate for the dual-deploy config.
#
#   scripts/deploy/dual-smoke.sh              # frontend targets + backend offline (mock)
#   AVERY_BRAIN=minimax scripts/deploy/dual-smoke.sh   # + a REAL brain contract smoke (境内)
#   AVERY_BRAIN=claude  scripts/deploy/dual-smoke.sh   # + a REAL brain contract smoke (海外)
#   AVERY_BRAIN=openai  scripts/deploy/dual-smoke.sh   # + a REAL brain contract smoke (🇪🇺 #96)
#
# What it asserts:
#   FRONTEND  — all three static targets build + carry the right stamp (mode/locale/api base):
#               story-default (today's demo preserved) · overseas-en · domestic-zh.
#   BACKEND   — the feat-015 contract battery (red line / cite gate / 8-field / SSE order) on the
#               deterministic MockBrain (no key), PLUS the feat-018 ingestion HTTP surface
#               (/ingest → /team → /advise-with-context, red line clean) via TestClient, PLUS —
#               when AVERY_BRAIN names a keyed real provider — one REAL-API contract smoke.
#
# Exit non-zero on the first failure so CI / a pre-promote check can depend on it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
FAIL=0
step() { printf '\n\033[1m=== %s ===\033[0m\n' "$1"; }

# ── FRONTEND: dual-target build smoke ─────────────────────────────────────────────────────────────
step "FRONTEND — dual-target build (story-default · overseas-en · domestic-zh)"
if node scripts/deploy/build-targets.mjs; then
  echo "frontend: 3/3 targets build + stamp OK"
else
  echo "frontend: BUILD SMOKE FAILED"; FAIL=1
fi

# ── BACKEND: offline contract battery + ingestion HTTP surface ─────────────────────────────────────
step "BACKEND — feat-015 contract battery + feat-018 ingest HTTP (offline, MockBrain)"
pushd eval-harness >/dev/null
if python -m pytest tests/test_service_contract.py tests/test_service_http.py tests/test_ingest.py -q; then
  echo "backend battery: OK"
else
  echo "backend battery: FAILED"; FAIL=1
fi

# feat-018 ingestion HTTP surface end-to-end (upload → team → advise-with-context), red line asserted.
# (cwd is eval-harness/ here so service/avery import; the smoke script takes an absolute path.)
step "BACKEND — ingestion HTTP surface end-to-end (/ingest → /team → /advise, red line clean)"
if AVERY_BRAIN=mock python "$ROOT/scripts/deploy/ingest_http_smoke.py"; then
  echo "ingest HTTP surface: OK"
else
  echo "ingest HTTP surface: FAILED"; FAIL=1
fi

# ── BACKEND: optional REAL-brain contract smoke (per host) ─────────────────────────────────────────
BRAIN="${AVERY_BRAIN:-mock}"
if [ "$BRAIN" != "mock" ]; then
  step "BACKEND — REAL-brain contract smoke (AVERY_BRAIN=$BRAIN)"
  # Contract-only (8 fields / red line / cite gate), never verbatim copy. Skips cleanly w/o a key.
  # `-m smoke` is REQUIRED since pytest.ini went offline-by-default (arch-0802): the explicit CLI
  # -m overrides the addopts deselect; without it this path-selected file collects 0 tests (exit 5).
  if AVERY_BRAIN="$BRAIN" python -m pytest tests/test_service_smoke.py -q -rs -m smoke; then
    echo "real-brain smoke: OK (or SKIPPED-need-keys)"
  else
    echo "real-brain smoke: FAILED"; FAIL=1
  fi
else
  step "BACKEND — REAL-brain smoke SKIPPED (AVERY_BRAIN=mock; set minimax|deepseek|claude|openai to run)"
fi
popd >/dev/null

step "DUAL SMOKE RESULT"
if [ "$FAIL" -eq 0 ]; then
  echo "PASS — both deploy sides hold (frontend targets + backend contract)."
else
  echo "FAIL — see the failed step(s) above."
fi
exit "$FAIL"
