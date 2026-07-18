# Avery Live — dual deployment runbook (境内中文 + 海外英文)

> ## ⚠️ 2026-07-18 纠偏 —— 本文件的拓扑部分已作废
>
> **前后端都已真上线，形态与本 runbook 描述的不同。** 权威描述见
> [ADR-0024](../adr/0024-single-target-deploy-frankfurt-backend-supersedes-dual-deploy.md)
> 与 [vercel-config-notes.md](vercel-config-notes.md)。
>
> | 本文件写的 | 实际 |
> |---|---|
> | 前端双 target（海外 EN + 境内 ZH） | **单个** Vercel 项目 `avery-lite`，**中文默认**，`averylite.dannyqian.com` |
> | 境内 ECS `120.55.97.151` + 宝塔 nginx | **法兰克福** 阿里云轻量 `8.211.28.11` + **Caddy**（systemd），合伙人的机器 |
> | 域名 `avery.ima-read.com` | `avery.dannyqian.com`（后端）/ `averylite.dannyqian.com`（前端） |
> | 服务双 host（境内 MiniMax / 海外 Claude） | **单 host**，brain = `minimax` |
> | 「产出 = 配置 + runbook，NOT 实际部署」 | **已实际部署**，push 到 `main` 即自动构建上生产 |
>
> **§A.4（宝塔 nginx vhost / XFF recipe / ~150M-free 取舍）整段不再适用** —— 那台机器不存在于当前拓扑。
> 仍然有效的部分：**§1 的 env 矩阵**（变量名与语义未变）、`scripts/deploy/smoke_docker.sh`、以及
> pluggable brain/embeddings/retrieval 的思路。正文保留作历史，不逐句改写。
>
> 一条本文件从未提到、但现在是硬依赖的事：**后端 `AVERY_CORS_ORIGINS` 是精确匹配列表**，
> 设置即完全替换默认的 `http://localhost:5173,http://127.0.0.1:5173` —— 漏带 localhost
> 会掐断所有并行线的本地开发。见 issue #14。

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
>
> ---
> **feat-040 update (2026-07-14) — lite-v1 lean-real is now the shipping target.** Since feat-018
> this runbook grew: **persistence** (feat-030 Postgres/Supabase — company data survives restarts),
> **an upload hard-gate** (feat-039 — size/count/type caps + per-IP rate limit + LLM spend budget +
> memory sentinel), **tenant isolation** (feat-038 — unguessable owner_token), and a **policy pivot**
> (feat-033 — `AVERY_ALLOW_PERSON_SCORING`). The real lite-v1 topology is **ONE 境内 ECS box behind
> 宝塔/nginx + a Vercel frontend** (not the symmetric dual-host of feat-018 — that architecture still
> holds, but production today is the single 境内 box). The new env vars are in **§1 (Backend —
> lite-v1 additions)**; the single-box ECS reality — a `--memory` cap + the 宝塔 nginx vhost + the
> critical **XFF recipe** that makes the rate-limiter see the real client IP — is in **§A.4**. The
> local `docker build` + `/health`/`/ingest` smoke is now automated (`scripts/deploy/smoke_docker.sh`,
> §A.1). ⚠️ The **~150M-free box** go/no-go decision is in §A.4 and the feat-040 session-handoff.

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

### Backend — lite-v1 additions (feat-030 persistence + feat-039 hard-gate + feat-033 policy) 🆕

These arrived after feat-018. **Bold = you MUST set it in production** (an unset gate = wide open or
data-losing). All are read DYNAMICALLY by the running service (a host-env change needs only a restart).

| Var | Production value (境内 ECS) | Default (unset) | Why it matters | Read by |
|---|---|---|---|---|
| **`AVERY_DB_URL`** | 🧑 Supabase pooled conn str | in-memory (data dies on restart) | **Persistence** — unset = every company vanishes on redeploy (the whole feat-030 point). `PGVECTOR_URL` is an accepted alias. | `avery/ingest/registry.py` |
| **`AVERY_ALLOW_PERSON_SCORING`** | **`1`** | off (block) | **Policy pivot (feat-033):** real companies get the UNBLOCKED build. Unset keeps the person-scoring hard-block. Truthy = `1/true/yes/on`; a typo fails CLOSED. | `avery/scoring_policy.py` |
| **`AVERY_RATE_INGEST_PER_MIN`** | **set it** (e.g. `20`) | `0` = **NO rate limit** | **Denial-of-service:** unset = an unbounded upload flood on the ~150M-free box. Pair with the XFF recipe (§A.4) or it buckets by proxy IP. | `service/upload_guard.py` |
| `AVERY_RATE_INGEST_BURST` | e.g. `20` | = per-min (or 1) | Token-bucket burst allowance. | ″ |
| `AVERY_RATE_ADVISE_PER_MIN` / `_BURST` | optional (e.g. `30`) | `0` = off | Same limiter on `/advise`. | ″ |
| **`AVERY_LLM_CALL_BUDGET`** | **set it** (e.g. `2000`) | `0` = **UNLIMITED** | **Denial-of-wallet:** per-process LLM-call ceiling. Exhausted → extraction degrades HONESTLY to heuristic (`extraction_mode=degraded`), never silently burns M3 tokens. | `service/llm_budget.py` |
| **`AVERY_TRUSTED_PROXY_HOPS`** | **`1`** (Avery is one hop behind 宝塔 nginx) | `0` (trust TCP peer only) | Makes the rate-limiter key on the REAL client IP behind nginx. **MUST be paired with the XFF recipe in §A.4** — wrong pairing either buckets everyone as the proxy (too strict) or lets a forged XFF bypass the limiter. See §A.4. | `service/upload_guard.py` |
| `AVERY_MEM_WARN_MB` | e.g. `420` (≈ the `--memory` cap) | unset = sentinel inert | RSS high-water mark → WARN log + `/health` `degraded:true` ("time to upsize the ECS box", Danny Q12). | `service/mem_sentinel.py` |
| `AVERY_MAX_UPLOAD_BYTES` | conservative (e.g. `8388608` = 8 MiB) | 8 MiB | Per-FILE cap → 413. | `avery/ingest/guards.py` |
| `AVERY_MAX_TOTAL_UPLOAD_BYTES` | conservative (e.g. `33554432` = 32 MiB) | 32 MiB | Per-REQUEST total-body cap → 413 BEFORE bytes hit RAM (the OOM guard). Keep well under free RAM. | ″ |
| `AVERY_MAX_FILES` | e.g. `15` | 15 | Per-request file-count cap → 413. | ″ |
| `AVERY_MAX_PDF_PAGES` / `AVERY_MAX_ARCHIVE_UNCOMPRESSED_BYTES` / `AVERY_MAX_ARCHIVE_ENTRIES` | defaults OK (500 / 100 MiB / 4096) | as noted | PDF-page / zip-bomb caps. ⚠️ On a ~150M-free box, **lower `AVERY_MAX_ARCHIVE_UNCOMPRESSED_BYTES`** (100 MiB default > free RAM). | ″ |

> ⚠️ **The feat-039 defaults were sized for a `~540M-free` box; the 2026-07-13 probe says `~150M free`.**
> Re-tighten `AVERY_MAX_TOTAL_UPLOAD_BYTES` and `AVERY_MAX_ARCHIVE_UNCOMPRESSED_BYTES` accordingly, and
> see the §A.4 go/no-go — the box may simply be too small (Danny decision).

> **`/health` now returns** `{status, brain, live, embeddings, extractor, extraction_mode, memory:{rss_mb,
> warn_mb,high,available}, llm_calls_remaining, degraded}`. `degraded:true` = LLM budget exhausted OR
> RSS past the warn mark — an OPERATOR alert signal (scrape it), **not** a liveness failure (the
> container HEALTHCHECK stays green; see the Dockerfile note on why).

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

**Automated (feat-040):** the whole build + run + `/health` + real-seed `/ingest` + isolation + hard-gate
smoke is one script — run it after any Dockerfile/deps change:

```bash
scripts/deploy/smoke_docker.sh   # build -> run (--memory=512m) -> 9 assertions -> teardown; exit 0 = green
```

It proves, on the REAL image: `/health` returns all fields; `/ingest` of the seed PDF+xlsx is **200**
(python-multipart + the pypdf/openpyxl/python-docx parsers are present — no 500, no 422); feat-038
isolation (wrong/no token → 404, owner token → 200); feat-039 RAM cap (413), disguised type (415),
rate limit (429). Manual equivalents:

```bash
docker build -t avery-agent -f eval-harness/Dockerfile eval-harness

# offline, no key — should return {"status":"ok","brain":"mock","live":false,...}
docker run --rm --memory=512m -p 8137:8137 -e AVERY_BRAIN=mock avery-agent
curl -s localhost:8137/health

# real brain — keys from the host env / an env-file (NEVER committed)
docker run --rm --memory=512m -p 8137:8137 --env-file eval-harness/.env -e AVERY_BRAIN=minimax avery-agent   # 境内
docker run --rm --memory=512m -p 8137:8137 --env-file eval-harness/.env -e AVERY_BRAIN=claude  avery-agent   # 海外
```

> ✅ **feat-040 — smoke is GREEN on the real image** (2026-07-14, Docker 28.5.1, linux). `docker build`
> succeeds; the slimmed image is **~333 MB** (dropped scipy/numpy/pytest — never imported at runtime);
> `/health` 200 with all fields; `/ingest` of the real seed files **200** (this caught + fixed a gap:
> pypdf/openpyxl/python-docx were undeclared, so pre-feat-040 images 422'd every real PDF/xlsx); the
> HEALTHCHECK reaches `healthy` in ~3s. With a real key expect `brain=minimax`/`claude`, `live=true`.

### A.2 境内 host (brain = minimax/deepseek)

1. 🧑 **HITL** — open/provision the 境内 host (the runbook does not pick the provider).
2. Deploy the image; set env: `AVERY_BRAIN=minimax`, `MINIMAX_API_KEY=…` (host secret store), `PORT=8137`.
3. If the frontend is served from a **different** origin, set `AVERY_CORS_ORIGINS=https://<境内-frontend>`
   and enable the CORS middleware (see §C note).
4. Smoke the live service: `curl https://<境内-service>/health` → `brain:"minimax", live:true`.

### A.3 Overseas host (brain = claude)

Same as A.2 with `AVERY_BRAIN=claude` + `ANTHROPIC_API_KEY`. 🧑 **HITL** provision + keys.

---

### A.4 🆕 lite-v1 production reality — the single shared 境内 ECS box (feat-040)

Production today is **one Alibaba Cloud ECS `120.55.97.151` (2C / 3.5G / 79G)** already running
ImaRead's full stack behind **宝塔 (BT-Panel) + nginx 1.24** (all domains on HTTPS, Let's Encrypt).
Avery's container shares this box. Two hard constraints drive everything below: **~150M free RAM, no
swap** and **nginx sits in front** (so the app never sees the client IP directly).

#### (a) 🚦 Memory — the go/no-go BEFORE you deploy 🧑

> ⚠️ **This box has ~150M free. A single-worker FastAPI + psycopg + the SDKs idles around ~150–250 MB
> RSS** (the smoke measured `rss_mb≈52` on `mock`/keyless; a real brain + psycopg + a live extraction
> is materially more). Sharing the box with ImaRead, an OOM would take **ImaRead down too** (no swap).
> **Danny must pick one before deploy:**
> 1. **Free up RAM / reclaim** on the box (stop something, add swap) then run Avery under a tight cap.
> 2. **Upsize the ECS** (Q12 said "don't pre-upsize" — the sentinel bubbles up when it's time; this is that time if (1) isn't enough).
> 3. **Separate small instance** for Avery (cleanest isolation from ImaRead).
> 4. **Keyless/mock-brain lightweight** first pass (heuristic extraction, lowest RSS) to validate the box, then add a key.
>
> The memory sentinel (`AVERY_MEM_WARN_MB`) + `/health` `degraded` give early warning, **but a cap set
> too high still OOMs the neighbour first.** Set `--memory` conservatively and watch `docker stats`.

Run the container with a **hard memory cap** so Avery can never starve ImaRead — the kernel OOM-kills
*Avery* (bounded blast radius) instead of the whole box:

```bash
docker run -d --name avery-agent --restart unless-stopped \
  --memory=512m --memory-swap=512m \        # HARD cap; tune to what the box can spare (see go/no-go)
  -p 127.0.0.1:8137:8137 \                   # bind LOOPBACK only — nginx is the only public door
  -e AVERY_BRAIN=minimax -e MINIMAX_API_KEY=…      \  # 🧑 host secret store
  -e AVERY_DB_URL=…supabase pooled…                \  # 🧑 persistence
  -e AVERY_ALLOW_PERSON_SCORING=1                  \  # policy pivot (real companies)
  -e AVERY_RATE_INGEST_PER_MIN=20 -e AVERY_RATE_INGEST_BURST=20 \
  -e AVERY_LLM_CALL_BUDGET=2000                    \
  -e AVERY_TRUSTED_PROXY_HOPS=1                     \  # one hop behind nginx (see (c))
  -e AVERY_MEM_WARN_MB=420                          \  # ≈ the --memory cap
  -e AVERY_MAX_TOTAL_UPLOAD_BYTES=33554432 -e AVERY_MAX_UPLOAD_BYTES=8388608 \
  -e AVERY_CORS_ORIGINS=https://<avery-frontend-origin> \
  avery-agent
```

`--memory-swap` = `--memory` disables container swap (there is none anyway). `unless-stopped` survives
a box reboot. **OOMKilled shows in `docker inspect` / `docker events`** — pair it with the
`AVERY_MEM_WARN_MB` bubble-up so an approaching cap is visible *before* the kill.

#### (b) 宝塔 nginx vhost — reverse proxy + TLS + subdomain 🧑

Add a **new** site in 宝塔 for Avery's subdomain (**do NOT edit any ImaRead / ima-read.com vhost**).
Suggested subdomain: **`avery.ima-read.com`** (or an independent filed domain — Danny decides; 备案 is
account-level). Steps: DNS `A avery.ima-read.com → 120.55.97.151` (阿里云 云解析) → 宝塔 → Add Site →
apply Let's Encrypt for the subdomain → then set the reverse-proxy `location` block:

```nginx
server {
    server_name avery.ima-read.com;
    # ... 宝塔-managed listen 443 ssl + Let's Encrypt cert lines ...

    # HTTPS is mandatory: the Vercel (HTTPS) frontend calling an HTTP backend is mixed-content and
    # browsers HARD-BLOCK it. nginx terminates TLS; Avery stays on loopback :8137.
    client_max_body_size 40m;              # must be >= AVERY_MAX_TOTAL_UPLOAD_BYTES or nginx 413s first

    location / {
        proxy_pass http://127.0.0.1:8137;
        proxy_http_version 1.1;

        # ── XFF: hand Avery the REAL client IP so its per-IP rate-limiter buckets correctly. ──
        # Use the REPLACE recipe (NOT nginx's default $proxy_add_x_forwarded_for APPEND) so the header
        # is EXACTLY one hop = the real client, and pair it with AVERY_TRUSTED_PROXY_HOPS=1.
        proxy_set_header X-Forwarded-For $remote_addr;   # REPLACE, one hop
        proxy_set_header X-Real-IP       $remote_addr;
        proxy_set_header Host            $host;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE (/advise streams token-by-token): don't buffer or the stream stalls.
        proxy_buffering off;
        proxy_read_timeout 600s;
    }
}
```

#### (c) ⚠️ The XFF ↔ `AVERY_TRUSTED_PROXY_HOPS` pairing (get this exactly right)

feat-039 closed a rate-limit-bypass hole: a forged `X-Forwarded-For` used to mint a fresh limiter
bucket per request. The fix trusts the **TCP peer** by default and only reads XFF when you opt in with
`AVERY_TRUSTED_PROXY_HOPS`. **The recipe above and the env MUST agree:**

| nginx recipe | `AVERY_TRUSTED_PROXY_HOPS` | Result |
|---|---|---|
| **`proxy_set_header X-Forwarded-For $remote_addr;` (REPLACE — recommended)** | **`1`** | ✅ Avery keys on the real client IP. |
| default `$proxy_add_x_forwarded_for` (APPEND) | `1` | ❌ **BYPASS** — a forged left value wins; real IP is on the right. Use hops = real proxy depth, or switch to REPLACE. |
| any | `0` (default) | Safe but STRICT — everyone buckets as the nginx IP (one shared bucket). Fine as a fail-safe, bad UX under load. |

`HOPS=N` means "the Nth hop **from the right** is the real client" (matches werkzeug ProxyFix `x_for`).
With the REPLACE recipe there is exactly one hop, so **`HOPS=1`**. If you keep nginx's default APPEND,
set `HOPS` to the true number of trusted proxies in front of Avery (here 1) — but REPLACE is simpler
and less error-prone. Getting this wrong is either a silent bypass or an over-strict shared bucket.

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

## E. Access model — real companies self-serve (lead-gen) 🧑 **HITL (Vercel panel)**

> 🆕 **feat-040 / lite-v1 demo-first (per PRD §Solution):** the model is NOT an on-site roadshow over a
> curated fake dataset. The financing team **hands the link to real companies**, who open it themselves
> and **upload their OWN real files** — each company gets its own persistent, isolated workspace
> (feat-030/038). So the surface must be reachable **without a login/SSO wall** (no account system in
> v1 — isolation is the unguessable owner_token) AND must **hold real data safely**: persistence set
> (`AVERY_DB_URL`), isolation on (owner_token, feat-038), the data-handling note shown, and the upload
> hard-gate + spend budget live so one company's big upload can't OOM the box or burn the M3 budget for
> everyone. There is no "demo dataset" to curate — the company's own documents ARE the demo.

- The public surface must let a company **just open the URL and use it** — prefer a host **without
  SAML/SSO gating** (no 翻墙, no login wall).
- If the overseas EN (Vercel) deployment sits behind the `landing/` team's **SAML / Deployment
  Protection**, 🧑 **HITL** — in the Vercel **Deployment Protection** panel (Danny), grant the
  financing team access via a **Protection Bypass** / shared preview link / added team members.
  **Do NOT lock the project to SAML-only** such that the financing team can't view it (kickoff
  warning: "landing 项目团队有 SAML,注意别锁死").
- The runbook **documents** this; toggling the panel is Danny's action.

---

## F. Access-wall checklist (Danny — steps that need your credentials/accounts, not your review)

> Promote itself is **automatic** (先斩后奏) — the items below are the credential/account walls only.

### F.1 🆕 lite-v1 single-box ECS deploy (the shipping path — feat-040)

- [x] `docker build` + container `/health` + real-seed `/ingest` + isolation + hard-gate smoke — **GREEN** on Docker 28.5.1 (`scripts/deploy/smoke_docker.sh`, feat-040).
- [ ] **🚦 GO/NO-GO — the ~150M-free box (§A.4a):** decide free-RAM / upsize / separate instance / keyless-first BEFORE deploy. An OOM takes ImaRead down too (no swap).
- [ ] **Supabase**: create/choose the project; put the **pooled connection string** in the box's secret store as `AVERY_DB_URL` (never git).
- [ ] Real brain key in the box's secret store (`MINIMAX_API_KEY`, brain=minimax) — **never git**.
- [ ] Set the **required** production env (unset = wide open): `AVERY_RATE_INGEST_PER_MIN`, `AVERY_LLM_CALL_BUDGET`, `AVERY_TRUSTED_PROXY_HOPS=1`, `AVERY_ALLOW_PERSON_SCORING=1`, `AVERY_CORS_ORIGINS`, `AVERY_MEM_WARN_MB` (§1 lite-v1 table).
- [ ] `docker run` with a **hard `--memory` cap**, bound to `127.0.0.1:8137` (§A.4a). `--restart unless-stopped`.
- [ ] **宝塔 nginx**: add a **NEW** vhost for the Avery subdomain (do NOT touch ImaRead vhosts) — reverse-proxy → `127.0.0.1:8137`, TLS (Let's Encrypt), the **REPLACE XFF recipe**, `client_max_body_size` ≥ total-upload cap (§A.4b).
- [ ] **DNS** (阿里云 云解析): `A avery.ima-read.com → 120.55.97.151` (or an independent filed domain — your 备案 decision).
- [ ] **Verify the XFF↔HOPS pairing** (§A.4c): REPLACE recipe ⇔ `HOPS=1`. Wrong pairing = silent bypass or over-strict shared bucket.
- [ ] Smoke the live service: `curl https://avery.<domain>/health` → `brain:"minimax", live:true, degraded:false`.

### F.2 Frontend (Vercel) + originally-planned dual host

- [ ] Vercel: separate project, **Root Directory = repo root** (not `landing/`), set `VITE_AVERY_API_BASE=https://avery.<domain>` (+ `VITE_AVERY_MODE=live`, `VITE_AVERY_LOCALE=zh` for the ZH build).
- [ ] Connect the Vercel project (needs your account) — **promote is then automatic, no per-deploy sign-off.**
- [ ] **Deployment-protection** panel: grant real-company/financing access without locking them out (§E).
- [ ] (feat-018 dual-host, if/when overseas EN is stood up) 海外 host + `ANTHROPIC_API_KEY` — same image, env-switched.
- [ ] (Optional) vector RAG turn-on: pick embeddings, stand up pgvector, set the three env vars (§D).
- [ ] `git push origin` — the 对外 wall, left to you (never auto-pushed).

---

## G. Files this runbook references

| Path | What |
|---|---|
| `.env.example` (root) | frontend build-time env template |
| `vercel.json` (root) | overseas EN Vercel config (separate from `landing/`) |
| `vite.config.ts` | stamps `window.__AVERY_BUILD__` per target |
| `src/i18n/index.ts` | `VITE_AVERY_LOCALE` build-default (境内 ZH) |
| `eval-harness/Dockerfile` · `.dockerignore` | agent-service image (dual host, env-switched) |
| `eval-harness/requirements-service.txt` 🆕 | RUNTIME dep subset the image ships (drops scipy/numpy/pytest; adds the parsers) |
| `eval-harness/service/.env.example` | backend deploy env matrix template |
| `eval-harness/service/ingest_api.py` | ingestion HTTP surface (`/ingest`, `/team/{id}`) |
| `scripts/deploy/build-targets.mjs` | dual-target frontend build smoke |
| `scripts/deploy/ingest_http_smoke.py` | ingestion HTTP surface smoke |
| `scripts/deploy/smoke_docker.sh` 🆕 | feat-040 local REAL-IMAGE smoke (build + /health + /ingest + isolation + hard-gate) |
| `scripts/deploy/dual-smoke.sh` | the one dual gate (frontend + backend) |
