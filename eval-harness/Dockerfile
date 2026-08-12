# feat-018 (ADR-0021 §5) — the Avery agent service, ONE image for BOTH deploy hosts.
#
# The host is identical; only env differs (the pluggable-brain design, feat-015):
#   境内 (domestic): AVERY_BRAIN=minimax|deepseek  + MINIMAX_API_KEY / DEEPSEEK_API_KEY
#   海外 (overseas): AVERY_BRAIN=claude            + ANTHROPIC_API_KEY
# Embeddings + retrieval are likewise pluggable by env (feat-016) — see service/.env.example and
# docs/deploy/dual-deploy-runbook.md for the full matrix. NO keys are baked into the image: they are
# injected at run time by the host's secret store (Danny's HITL — never commit a key).
#
# Build context = eval-harness/ (this dir). The frontend is a SEPARATE static build (vercel.json /
# runbook §B); it is NOT in this image.
#
#   docker build -t avery-agent -f eval-harness/Dockerfile eval-harness
#   # memory-tight prod ECS -> cap the container (feat-040; see docs/deploy/dual-deploy-runbook.md §A.4):
#   docker run --rm --memory=512m -p 8137:8137 -e AVERY_BRAIN=mock avery-agent          # offline, no key
#   docker run --rm --memory=512m -p 8137:8137 --env-file eval-harness/.env -e AVERY_BRAIN=minimax avery-agent

FROM python:3.11-slim AS base

# #89 · the git commit this image was built from, surfaced verbatim on /health as "commit".
# Passed by the server build: docker build --build-arg AVERY_COMMIT=$(git rev-parse HEAD) …
# Default "unknown" keeps local/gate builds honest (they never claim a commit they didn't pin).
ARG AVERY_COMMIT=unknown

# Faster, quieter, no .pyc clutter; unbuffered logs for container log capture.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8137 \
    AVERY_COMMIT=${AVERY_COMMIT} \
    AVERY_BRAIN=mock

WORKDIR /app

# Install deps first (layer cache): only re-runs when the runtime requirements change.
# feat-040 image slim (production ECS is disk-/memory-tight): the image ships requirements-SERVICE.txt
# — the RUNTIME SUBSET of requirements.txt that DROPS scipy/numpy/pytest (Cohen's kappa + the test
# runner, never imported by the running service). No C toolchain is needed: every wheel here is a
# manylinux binary (psycopg[binary]/psutil bundled), so python:3.11-slim needs no build-essential.
COPY requirements-service.txt ./
RUN pip install --upgrade pip && pip install -r requirements-service.txt

# App code: the engine (avery/), the service (service/), and the skills/memory the loop reads.
# cases/, runs/, tests/ are NOT needed at runtime and are omitted to keep the image lean.
COPY avery/   ./avery/
COPY service/ ./service/
COPY skills/  ./skills/
COPY memory/  ./memory/

# 2026-07-17: db/ IS a runtime dependency — omitting it silently disabled schema bootstrap.
# PgRegistry._ensure_schema() replays every db/migrations/*.sql on first use (pg_registry.py:
# _MIGRATIONS_DIR = <app root>/db/migrations). Without this COPY that path does not exist in the
# image, and Path.glob() on a missing directory returns [] WITHOUT raising — so _ensure_schema()
# silently replayed nothing, marked itself ready, and the service only worked because the schema
# had been provisioned out-of-band by hand. A fresh deploy against a fresh database would have
# died on UndefinedTable. ~32KB; keeps prod self-provisioning (and new migrations auto-apply).
COPY db/      ./db/

# Drop root.
RUN useradd --create-home --uid 10001 avery && chown -R avery:avery /app
USER avery

EXPOSE 8137

# LIVENESS ONLY: is the process up and serving valid JSON? A 2xx /health with status:"ok" passes.
# Deliberately DECOUPLED from the /health `degraded` flag (feat-039): `degraded` fires when the LLM
# spend budget is exhausted (a NORMAL honest fallback to the heuristic — the service is still fully
# serving) or when RSS crosses AVERY_MEM_WARN_MB (Danny Q12's "time to upsize the ECS box" bubble-up,
# NOT a "restart me" signal). Failing liveness on `degraded` would evict a healthy container and, on
# the single shared 宝塔/docker-run ECS box (no orchestrator auto-heal), a restart loop would thrash a
# memory-tight machine and interrupt in-flight extraction. Operators alert on `degraded:true` by
# SCRAPING the /health JSON, not via this healthcheck. (feat-040 — see runbook §A.4.)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os,sys,json,urllib.request; r=urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8137\")}/health', timeout=4); sys.exit(0 if json.load(r).get('status')=='ok' else 1)" || exit 1

# Exec-form `sh -c` so (a) $PORT still expands and (b) `exec` REPLACES the shell — uvicorn becomes
# PID 1 and receives SIGTERM directly, so `docker stop` shuts it down gracefully (releasing Postgres
# connections) instead of the 10s-then-SIGKILL a bare shell-form CMD would cause on this box.
# ONE worker is deliberate: the feat-039 guards are all PROCESS-GLOBAL in-memory state — the per-IP
# rate-limit token buckets, the LLM-call spend counter, and the memory sentinel — so a second worker
# would fragment every one of them (two half-strength limiters, a double budget). Persistence now
# lives in Postgres (feat-030), not the process, so one worker no longer trades away durability;
# horizontal scaling with a shared limiter store is a post-lite change.
CMD ["sh", "-c", "exec python -m uvicorn service.app:app --host 0.0.0.0 --port ${PORT}"]
