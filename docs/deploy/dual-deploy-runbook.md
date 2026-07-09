# Avery Live — dual deployment runbook (境内中文 + 海外英文)

> **feat-018 · ADR-0021 §5.** Line A dual端上线: 境内中文给融资团队现场演示 (不卡/不翻墙),
> 海外英文沿用 overseas-first。
>
> **This runbook is CONFIG + STEPS, not an applied deploy.** The AFK build line (this ticket)
> produced the build config, the service image, the env matrix, and the smoke gate — all green
> locally. Nothing here has been deployed; no key is in git.
>
> **Gate policy (先斩后奏, updated 2026-07-06):** deploy + **production promote are automatic** —
> once the project is connected, the agent lets the latest build take the production main domain and
> does **not** roll back or hold prod "pending 审字". The 🧑 marks below are **access walls, not
> review gates**: they need Danny's own credentials/accounts (real API keys, choosing/provisioning a
> host, the Vercel Deployment-Protection panel, domain DNS). The agent does everything up to each
> wall and hands off only that step. See memory `gates-only-on-destructive`.

---

## 0. Topology (what deploys where)

Two independent artifacts, four targets, one env matrix:

| Artifact | Overseas (EN) | 境内 (ZH) |
|---|---|---|
| **Frontend** — static SPA (Vite, `src/`) | Vercel · EN default | 境内 static host / CDN · ZH default |
| **Backend** — agent service (FastAPI, `eval-harness/`) | brain = **claude** | brain = **minimax / deepseek** |

- The frontend is a **pure static bundle** (no SSR, no server) — it only calls the backend over
  HTTP/SSE. LLM keys **never** touch the frontend (ADR-0020 决策 4).
- The backend is **one Docker image** (`eval-harness/Dockerfile`); the two hosts differ **only by
  env** (the pluggable-brain / -embeddings / -retrieval design, feat-015/016).
- **Do NOT disturb** the existing `landing/` Vercel project (a separate Next.js app,
  `avery-landing`, SAML team) or the `tm2` demo. This runbook stands up **new/separate** projects.

---

## 1. The env matrix (single source of truth)

### Frontend (build-time `VITE_*`, inlined into the public bundle — NO secrets)

| Var | Overseas EN | 境内 ZH | Default (unset) | Read by |
|---|---|---|---|---|
| `VITE_AVERY_MODE` | `live` | `live` | `story` | `src/live/mode.ts` |
| `VITE_AVERY_LOCALE` | *(unset → en)* | `zh` | `en` | `src/i18n/index.ts` |
| `VITE_AVERY_API_BASE` | `https://<overseas-service>` | `https://<境内-service>` | `http://127.0.0.1:8137` | `src/live/transport.ts` |

- `?mode=story\|live` and `?lang=en\|zh` in the URL **override** the build default on either target
  (Danny can force the scripted rail or the other language on-site, no rebuild).
- Template: **`.env.example`** (repo root).

### Backend (host env / secret store — keys are REAL secrets, never committed)

| Var | Overseas EN | 境内 ZH | Read by |
|---|---|---|---|
| `AVERY_BRAIN` | `claude` | `minimax` (or `deepseek`) | `service/brain_factory.py` |
| `ANTHROPIC_API_KEY` | 🧑 **HITL** set | — | brain (claude) |
| `MINIMAX_API_KEY` | — | 🧑 **HITL** set | brain (minimax) |
| `DEEPSEEK_API_KEY` | — | 🧑 **HITL** set (if deepseek) | brain (deepseek) |
| `AVERY_RETRIEVAL` | `keyword` (lite) → `vector` (turn-on §D) | same | `avery/ingest/store.py` |
| `AVERY_EMBEDDINGS` | `openai`/`voyage` (when vector) | `bge-m3`/`minimax` (when vector) | `avery/ingest/store.py` |
| `PGVECTOR_URL` | 🧑 **HITL** (when vector) | 🧑 **HITL** (when vector) | vector store |
| `AVERY_INGEST_CONCURRENCY` | `4` (default) | `4` (default) | `avery/ingest/extract.py` (feat-027 parallel ingest) |
| `PORT` | `8137` | `8137` | uvicorn |
| `AVERY_CORS_ORIGINS` | frontend origin(s) — **SET this** | frontend origin(s) — **SET this** | `service/app.py` CORS (always on) |

- `AVERY_INGEST_CONCURRENCY` (feat-027): how many documents extract in parallel per `/ingest` upload
  (bounded thread pool). Default `4`; set `1` to force the old sequential path. The cap is the
  rate-limit guardrail — a bursty fan-out tripped M3 429s.

- Template: **`eval-harness/service/.env.example`**. The real `eval-harness/.env` is **gitignored**;
  keys rotate there per `eval-harness/.env.example` note. In production, inject via the host's
  secret store, not a file.
- **mock** brain (`AVERY_BRAIN=mock`) needs no key — the offline default and CI gate.

---

## 2. Pre-flight — the dual smoke gate (run before ANY deploy)

One command proves **both** sides hold, offline, deploying nothing:

```bash
# frontend targets + backend contract (offline, MockBrain, no key)
scripts/deploy/dual-smoke.sh

# same + a REAL brain contract smoke for the host you're about to ship
AVERY_BRAIN=minimax scripts/deploy/dual-smoke.sh   # before 境内
AVERY_BRAIN=claude  scripts/deploy/dual-smoke.sh   # before 海外  (needs ANTHROPIC_API_KEY)
```

Asserts: all 3 frontend targets build + carry the right stamp; the feat-015 contract battery + the
feat-018 ingestion HTTP surface (upload → team → advise, **red line clean**); and — when
`AVERY_BRAIN` names a keyed provider — one real-API contract smoke. **Green here is the DoD gate.**

Frontend-only build check (isolated out-dirs, keeps nothing untracked):

```bash
node scripts/deploy/build-targets.mjs          # all targets
node scripts/deploy/build-targets.mjs --keep    # keep dirs to inspect the bundle stamp
```

Each built bundle self-describes its target — open devtools on a deployed page and read
`window.__AVERY_BUILD__` → `{mode, locale, apiBase}` to confirm which target is live.

---

## A. Backend — agent service (do this FIRST; the frontend needs its URL)

The frontend's `VITE_AVERY_API_BASE` must point at the deployed service, so stand the service up
first (or reserve its URL) on **each** host.

### A.1 Build + run the image (local verification)

```bash
docker build -t avery-agent -f eval-harness/Dockerfile eval-harness

# offline, no key — should return {"status":"ok","brain":"mock","live":false}
docker run --rm -p 8137:8137 -e AVERY_BRAIN=mock avery-agent
curl -s localhost:8137/health

# real brain — keys from the host env / an env-file (NEVER committed)
docker run --rm -p 8137:8137 --env-file eval-harness/.env -e AVERY_BRAIN=minimax avery-agent   # 境内
docker run --rm -p 8137:8137 --env-file eval-harness/.env -e AVERY_BRAIN=claude  avery-agent   # 海外
```

> 🧑 **HITL — container build + run smoke.** The AFK line verified the app under the same
> Python/uvicorn (169 pytest + the ingest HTTP smoke) and validated the Dockerfile's COPY sources +
> CMD import target, but **the `docker build` + container `/health` smoke needs Docker Desktop
> running** (it was down on the build machine). Run the three commands above once to confirm the
> image; expect `/health` `brain=minimax`/`claude`, `live=true` with a key.

### A.2 境内 host (brain = minimax/deepseek)

1. 🧑 **HITL** — open/provision the 境内 host (the runbook does not pick the provider).
2. Deploy the image; set env: `AVERY_BRAIN=minimax`, `MINIMAX_API_KEY=…` (host secret store), `PORT=8137`.
3. If the frontend is served from a **different** origin, set `AVERY_CORS_ORIGINS=https://<境内-frontend>`
   and enable the CORS middleware (see §C note).
4. Smoke the live service: `curl https://<境内-service>/health` → `brain:"minimax", live:true`.

### A.3 Overseas host (brain = claude)

Same as A.2 with `AVERY_BRAIN=claude` + `ANTHROPIC_API_KEY`. 🧑 **HITL** provision + keys.

---

## B. Frontend — static SPA (build per target, then hand the dist to the host)

The build is deterministic and offline; **only the upload/promote is HITL.**

### B.1 Overseas EN → Vercel

- Config: **`vercel.json`** (repo root) — static build (`npm run build` → `dist/`), SPA rewrites,
  `VITE_AVERY_MODE=live`. It is a **separate project** from `landing/`.
- 🧑 **HITL** — in the Vercel project (Danny): set **Root Directory = repo root** (NOT `landing/`),
  and set `VITE_AVERY_API_BASE=https://<overseas-service>` (from §A.3) in project env.
- 🧑 **HITL (access)** — connect the project (needs Danny's Vercel account). **Once connected,
  promote is automatic:** the latest build takes the production main domain — do NOT roll back or
  gate it on review.

Local equivalent of the Vercel build (to eyeball the exact artifact):

```bash
VITE_AVERY_MODE=live VITE_AVERY_API_BASE=https://<overseas-service> npm run build   # -> dist/
npm run preview   # serve dist/ locally; confirm EN default + window.__AVERY_BUILD__
```

### B.2 境内 ZH → 境内 static host / CDN

境内 has **no Vercel**; produce a static `dist/` and ship it to the 境内 host.

```bash
VITE_AVERY_MODE=live VITE_AVERY_LOCALE=zh VITE_AVERY_API_BASE=https://<境内-service> npm run build
# dist/ is a self-contained static site: index.html + assets/. ZH is the default (no ?lang needed).
```

- 🧑 **HITL** — provision the 境内 static host / CDN and upload `dist/` (the runbook does not push
  to a host).
- 🧑 **HITL** — configure the host's **SPA fallback** so every path serves `index.html` (mirrors the
  Vercel rewrite in `vercel.json`); otherwise deep links 404.
- Confirm on the deployed page: Chinese renders by default; `?lang=en` flips to English;
  `window.__AVERY_BUILD__` shows `{mode:"live", locale:"zh", apiBase:"…cn"}`.

---

## C. Wiring notes

- **API base per target** is the load-bearing wire: the 境内 frontend must call the 境内 service
  (fast, no 翻墙), the overseas frontend the overseas service. Set `VITE_AVERY_API_BASE` accordingly
  at **build** time (§B) — it is baked into the bundle.
- **CORS**: the service **enables CORS by default** — `service/app.py` adds FastAPI `CORSMiddleware`
  **unconditionally** (not a follow-up), reading the allowed origins from `AVERY_CORS_ORIGINS`
  (comma-separated; default `http://localhost:5173,http://127.0.0.1:5173` for local dev). So if a
  target's frontend origin ≠ its service origin, the **deploy action is to SET `AVERY_CORS_ORIGINS`**
  to the production frontend origin(s) in the host env — no code change. Leaving it unset falls back
  to the localhost dev origins, which will **block** a deployed browser frontend.
- **TLS / mixed content** ⚠️: a Vercel (HTTPS) frontend calling an **HTTP** backend is
  mixed-content, which browsers **hard-block** (the request never leaves the page). The deployed
  backend must therefore be **HTTPS** (TLS termination / a reverse proxy in front of uvicorn — e.g.
  the ECS load balancer or an nginx/Caddy sidecar) **or** served same-origin with the frontend.
  `VITE_AVERY_API_BASE` (§1) must then be an `https://` URL. This applies to `/advise` **and** the
  SSE stream and `/ingest` uploads alike.
- **Ingestion HTTP surface** (`POST /ingest`, `GET /team/{id}`) ships **in the image** (feat-018
  wired it over feat-016's `ingest_paths` + registry). The live upload flow ("上传→当场看团队长出")
  works end-to-end on the deployed service — proven by `scripts/deploy/ingest_http_smoke.py`.

---

## D. Vector RAG turn-on (optional, post-lite quality) 🧑 **HITL decision**

Lite ships on the **keyword** retriever (offline, deterministic — the AFK gate). To turn on real
vector RAG:

1. 🧑 **HITL** — Danny picks the embeddings family per host (境内 BGE-M3/MiniMax · 海外 OpenAI/Voyage)
   and stands up **pgvector** (self-hosted on each host — avoids 境内-unstable managed services,
   ADR-0021 §取舍).
2. Set `AVERY_RETRIEVAL=vector`, `AVERY_EMBEDDINGS=<family>`, `PGVECTOR_URL=…` (host secret store).
3. **Small follow-up (not yet wired):** `avery/ingest/pipeline.py` currently selects the store in
   code (`build_store(prefer_vector=…)`); the env-read for these three vars is the pairing change
   when the real embedder is turned on. The matrix + code seam (`Embedder`, `VectorStore`,
   `persistence="pgvector"`) are in place; the switch is a localized edit, not a rebuild of the core.

---

## E. Deployment protection — financing-team access 🧑 **HITL (Vercel panel)**

The financing team must reach the 境内 ZH demo **without being locked out**.

- 境内 static host is the **primary demo surface** for the on-site roadshow — prefer serving it from
  a host **without SAML/SSO gating** so the financing team just opens the URL (no 翻墙, no login wall).
- If the overseas EN (Vercel) deployment sits behind the `landing/` team's **SAML / Deployment
  Protection**, 🧑 **HITL** — in the Vercel **Deployment Protection** panel (Danny), grant the
  financing team access via a **Protection Bypass** / shared preview link / added team members.
  **Do NOT lock the project to SAML-only** such that the financing team can't view it (kickoff
  warning: "landing 项目团队有 SAML,注意别锁死").
- The runbook **documents** this; toggling the panel is Danny's action.

---

## F. Access-wall checklist (Danny — steps that need your credentials/accounts, not your review)

> Promote itself is **automatic** (先斩后奏) — the items below are the credential/account walls only.

- [ ] Provision 境内 host + 海外 host for the agent service.
- [ ] Set real brain keys in each host's secret store (`MINIMAX_API_KEY` / `ANTHROPIC_API_KEY`) — **never git**.
- [ ] `docker build` + container `/health` smoke on a machine with Docker running.
- [ ] Vercel: separate project, **Root Directory = repo root** (not `landing/`), set `VITE_AVERY_API_BASE`.
- [ ] Upload `dist/` (ZH build) to the 境内 static host + configure SPA fallback.
- [ ] **Domain / DNS** for each target (needs your registrar/host access).
- [ ] Connect each Vercel/host project (needs your account) — **promote is then automatic, no per-deploy sign-off.**
- [ ] **Deployment-protection** panel: grant financing-team access without locking them out.
- [ ] (Optional) vector RAG turn-on: pick embeddings, stand up pgvector, set the three env vars.

---

## G. Files this runbook references

| Path | What |
|---|---|
| `.env.example` (root) | frontend build-time env template |
| `vercel.json` (root) | overseas EN Vercel config (separate from `landing/`) |
| `vite.config.ts` | stamps `window.__AVERY_BUILD__` per target |
| `src/i18n/index.ts` | `VITE_AVERY_LOCALE` build-default (境内 ZH) |
| `eval-harness/Dockerfile` · `.dockerignore` | agent-service image (dual host, env-switched) |
| `eval-harness/service/.env.example` | backend deploy env matrix template |
| `eval-harness/service/ingest_api.py` | ingestion HTTP surface (`/ingest`, `/team/{id}`) |
| `scripts/deploy/build-targets.mjs` | dual-target frontend build smoke |
| `scripts/deploy/ingest_http_smoke.py` | ingestion HTTP surface smoke |
| `scripts/deploy/dual-smoke.sh` | the one dual gate (frontend + backend) |
