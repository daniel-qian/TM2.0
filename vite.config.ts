import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Minimal ambient decl so this config typechecks without pulling in @types/node (not a project dep).
// Vite runs this file under Node, where `process.cwd()` exists; we only need its type here.
declare const process: { cwd(): string }

// feat-018 (ADR-0021 §5) — dual static build. The app is still a pure static SPA (ADR-0001/0002:
// no backend / no SSR in the frontend; the agent service is a SEPARATE Python deploy). This config
// just makes the ONE bundle self-describe which target it was built for, so:
//   * the dual-target build smoke (scripts/build-targets.mjs) can assert each build unambiguously
//     without grepping minified app strings, and
//   * Danny can eyeball `window.__AVERY_BUILD__` in devtools on the deployed site.
// Build-time behavior itself is unchanged — mode/locale/api-base are still read from VITE_* by
// src/live/mode.ts, src/i18n/index.ts, src/live/transport.ts. This only STAMPS the resolved values.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const build = {
    mode: env.VITE_AVERY_MODE || 'story',      // default story (safe) — deploy targets set 'live'
    locale: env.VITE_AVERY_LOCALE || 'en',     // default en (overseas-first) — 境内 sets 'zh'
    apiBase: env.VITE_AVERY_API_BASE || '(local default 127.0.0.1:8137)',
  }
  return {
    plugins: [react()],
    define: {
      // JSON-stringified so it lands as a literal object in the bundle; greppable + inspectable.
      __AVERY_BUILD__: JSON.stringify(build),
    },
  }
})
