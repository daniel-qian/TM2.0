# Avery agent service (feat-015)

FastAPI + SSE wrapper around the **existing** advisor engine (`avery/loop.py` think→tool→observe,
`avery/redline.py` red line, `avery/brain.py` pluggable brain). This is the **LiveAgentSource
backend** for the graduated demo (ADR-0020) and Line A's backend. The engine is **not rewritten**
here — this package only adds a live-input path, SSE streaming, and an API-level contract gate.

## Run it

```bash
cd eval-harness
pip install -r requirements.txt

# mock brain — deterministic, no key, AFK-safe (default)
python -m uvicorn service.app:app --host 127.0.0.1 --port 8137

# live brain — keys read from eval-harness/.env, server-side only
AVERY_BRAIN=minimax python -m uvicorn service.app:app --port 8137   # MiniMax-M3 (境内)
AVERY_BRAIN=claude  python -m uvicorn service.app:app --port 8137   # claude-opus-4-8 (海外)
AVERY_BRAIN=deepseek python -m uvicorn service.app:app --port 8137
```

`AVERY_BRAIN` selects the brain; keys never leave the server. Frontend sees only SSE events.

## Endpoints

| method | path             | body                                                        | returns |
|--------|------------------|-------------------------------------------------------------|---------|
| GET    | `/health`        | —                                                           | `{status, service, brain, live}` |
| POST   | `/advise`        | `{situation, title?, company_context_id?, stream?}`         | SSE stream (default) or buffered JSON (`stream:false`) |
| GET    | `/advise/sample` | —                                                           | SSE stream over a built-in sample situation |

### `POST /advise` — live input

Replaces the read-only case fixture with a manager's **typed** situation. The free text is shaped
into a temporary case file the loop's `read_case` reads (engine unchanged), then discarded after
the run (sampler = ephemeral, nothing persists). `company_context_id` is a **feat-016 stub**
(ingested company RAG handle) — accepted and threaded through, not yet resolved.

**SSE events** (`event:` = type, `data:` = JSON):

- `started`  — `{agent, scaffold, case_id, prompt}`
- `think`    — model reasoning surface between tool calls
- `tool`     — `{name, input}` a tool call being made
- `observe`  — `{name, observation, is_error}` the tool result
- `nudge`    — a gate pushed the model back (`chain` or `redline`)
- `manifest` — terminal: the **8-field contract payload** + gate/red-line status + full transcript
- `error`    — unrecoverable (e.g. brain/network); stream ends cleanly

The terminal `manifest.advice` is the canonical **8-field `AgentOutput`** (partner
`advice_output_schema`), matching `src/data/fixtures.ts`:

```
summary · detected_signals · diagnosis_hypotheses · evidence · recommended_actions ·
confidence · escalation · metrics_to_track   (+ conversation_script)
```

## The contract, enforced through the API

`service/contract.py` projects the engine's native artifact (read/move/framing + cites) onto the
8-field shape **and re-runs the red-line validator over the assembled payload**. So the moat holds
on what the API returns, not only inside the loop:

- **red line** — any person-score/rank/label/diagnosis anywhere in the projected copy fails the
  contract (`manifest.redline_passed=false`, `contract_ok=false`).
- **cite-before-number** — the loop's tool-side cite gate is preserved; `detected_signals` /
  `evidence` are built from resolved cites, and the same validator flags uncited numbers.
- **8-field schema** — `manifest.schema_ok` is false if any required field is missing/empty or the
  `confidence.level` / `escalation.level` enums are invalid.

`service/contract.py::REQUIRED_FIELDS` is asserted equal to the frontend `AgentOutput` type by the
tests, so the two can't silently drift.

## Tests (AFK gates)

```bash
python -m pytest tests/test_service_contract.py tests/test_service_http.py -q   # gate 1: battery
AVERY_BRAIN=minimax python -m pytest tests/test_service_smoke.py -q -rs -m smoke  # gate 2: real smoke (-m smoke overrides the offline-by-default addopts)
```

- `test_service_contract.py` — red-line hard-fail / cite gate / 8-field schema / SSE ordering /
  live-input / parity with `run_loop`, all on MockBrain (deterministic).
- `test_service_http.py` — the same over the real FastAPI surface via `TestClient`.
- `test_service_smoke.py` — one real-API call asserting **only** the contract holds (not verbatim
  copy). **Skips** `SKIPPED-need-keys` when no key is configured.
