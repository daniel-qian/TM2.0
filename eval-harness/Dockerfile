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
#   docker run --rm -p 8137:8137 -e AVERY_BRAIN=mock avery-agent          # offline, no key
#   docker run --rm -p 8137:8137 --env-file eval-harness/.env -e AVERY_BRAIN=minimax avery-agent

FROM python:3.11-slim AS base

# Faster, quieter, no .pyc clutter; unbuffered logs for container log capture.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8137 \
    AVERY_BRAIN=mock

WORKDIR /app

# Install deps first (layer cache): only re-runs when requirements.txt changes.
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# App code: the engine (avery/), the service (service/), and the skills/memory the loop reads.
# cases/, runs/, tests/ are NOT needed at runtime and are omitted to keep the image lean.
COPY avery/   ./avery/
COPY service/ ./service/
COPY skills/  ./skills/
COPY memory/  ./memory/

# Drop root.
RUN useradd --create-home --uid 10001 avery && chown -R avery:avery /app
USER avery

EXPOSE 8137

# Liveness: /health returns the configured brain without revealing any key.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os,urllib.request,sys; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8137\")}/health'); sys.exit(0)" || exit 1

# Shell form so $PORT expands. One worker keeps the in-memory context REGISTRY (sampler = ephemeral,
# process-local, ADR-0021 §6) coherent — a multi-worker/persistent registry is a post-lite change.
CMD python -m uvicorn service.app:app --host 0.0.0.0 --port ${PORT}
