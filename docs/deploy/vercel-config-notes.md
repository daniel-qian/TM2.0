# `vercel.json` — why it says what it says

> **feat-068.** These notes used to live inside `vercel.json` as `"//"` keys. Vercel's config
> validator now rejects unknown properties outright — creating the project in the dashboard failed
> with `Invalid request: should NOT have additional property "//"`. **Never put a `//` key back in
> `vercel.json`.** Comments go here.

## What this config is for

The **`avery-lite` Vercel project** (`prj_3Z7tnkjQIaAh9GyIr6d3zP9CwSAN`, team `KK's projects`) —
the graduated Avery Live SPA, built from the **repo root** as a Vite static bundle.

Two other Vercel projects point at this same repo. Do not confuse them:

| Project | Root Directory | What it is |
|---|---|---|
| `avery-lite` | `.` | **This one.** The product SPA. Domain `averylite.dannyqian.com`. |
| `avery` | `landing/` | The Next.js marketing site. **Never point `avery-lite` at `landing/`.** |
| `tm2` | `.` | The old repo-root demo. **Git connection deliberately severed (feat-068)** so pushes to `main` no longer rebuild it — its production is intentionally pinned to `tm2-osj7dqiwv` pending 审字. |

## Field by field

**`framework: null`** — Vite is detected fine, but pinning to `null` keeps Vercel from injecting
framework defaults that would fight `buildCommand` / `outputDirectory`.

**`installCommand: "npm ci"`** — reproducible from the lockfile. Note this installs
devDependencies, which the build genuinely needs (`vite`, `typescript`, `@vitejs/plugin-react` are
all devDeps). Do **not** "optimise" this to `--omit=dev`; the build would break.

**`build.env`** — every value here is public. Vite inlines `VITE_*` into the client bundle at build
time, so nothing secret may ever appear here. LLM keys and the database URL live server-side in the
agent service (ADR-0020 决策 4) and never touch the frontend.

- `VITE_AVERY_MODE=live` — ships the graduated product as the default surface. `?mode=story` still
  flips to the scripted rail on-site for 路演/video, no rebuild.
- `VITE_AVERY_LOCALE=zh` — **Chinese by default.** Decided 2026-07-18: the first real recipients are
  the 三亚 cohort (see `.issues/v02-partner-align-0718/decisions.md:41`). `?lang=en` still overrides
  per page load. This reverses the feat-018 "overseas-first, EN default" assumption.
- `VITE_AVERY_API_BASE=https://avery.dannyqian.com` — **deliberately committed here rather than set
  in the dashboard.** A dashboard-only value is invisible to code review and silently absent on any
  build that forgets it; the failure mode is a bundle that calls the visitor's own laptop and reads
  as "the backend is down". Belt and braces: `vite.config.ts` now *refuses to build* a `live` target
  whose API base is missing or localhost.
- `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` — `playwright` (not `playwright-core`) is a devDep whose
  postinstall fetches three browser binaries. Mirrored in the repo-root `.npmrc` so local `npm ci`
  behaves the same.

**`rewrites`** — SPA fallback: every path serves `index.html`. Required today because the app
resolves `?mode` / `?lang` / `?v` at runtime, and required *harder* once feat-051 lands real
`react-router` deep links.

## Gate policy

Per `AGENTS.md` (先斩后奏) production promote is **automatic**: the latest build on `main` takes
`averylite.dannyqian.com`. No rollback hold, no 待审字. Pushing to `main` is the release action.

## The cross-line dependency nobody can see from here

The backend enforces an **exact-match CORS allowlist** (`AVERY_CORS_ORIGINS`, comma-separated,
`eval-harness/service/app.py:75-88`). A new frontend origin that is not in that list is blocked by
the browser before the request is ever sent. Current value on the Frankfurt box:

```
https://averylite.dannyqian.com,https://avery-lite.vercel.app,http://localhost:5173,http://127.0.0.1:5173
```

⚠️ There is **no wildcard support** — `allow_origins` is an exact list. Vercel *preview*
deployments get random hostnames and will therefore fail CORS. If preview-URL testing against the
live backend becomes necessary, that needs `allow_origin_regex` on the backend, which is a backend
change and must be broadcast, not done unilaterally.
