# Local rehearsal backend (0808). Env mirrors the T11 receipt's reproducible recipe
# + two prod-parity knobs (scoring switch, upload caps).
# DB is the dedicated local Docker PG database "rehearsal0808" (postgres:dev@5432),
# NOT teammaster / NOT production. _ensure_schema() replays migrations incl. 0015 on boot.
# 0808 Danny verdict: brain = REAL MiniMax for the rehearsal (room/quick-ask answers cost
# pennies per question; key auto-loaded from eval-harness/.env by app.py). Extractor and
# embeddings STAY offline — uploads remain free, retrieval is the keyword degraded path.
$env:AVERY_BRAIN = 'minimax'
$env:AVERY_EXTRACTOR = 'heuristic'
$env:AVERY_EMBEDDINGS = 'keyword'
$env:AVERY_DEMO_SEED_DIR = 'tests/fixtures/demo-seed'
$env:AVERY_PUBLIC_BASE = 'http://127.0.0.1:8250'
$env:AVERY_CORS_ORIGINS = 'http://localhost:5250,http://127.0.0.1:5250'
$env:AVERY_DB_URL = 'postgresql://postgres:dev@127.0.0.1:5432/rehearsal0808'
$env:AVERY_ALLOW_PERSON_SCORING = '1'
$env:AVERY_MAX_UPLOAD_BYTES = '10485760'
$env:AVERY_MAX_FILES = '10'
$env:PYTHONIOENCODING = 'utf-8'
Set-Location (Join-Path $PSScriptRoot '..\..\eval-harness')
python -m uvicorn service.app:app --host 127.0.0.1 --port 8250 --app-dir .
