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
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const build = {
    mode: env.VITE_AVERY_MODE || 'story',      // default story (safe) — deploy targets set 'live'
    locale: env.VITE_AVERY_LOCALE || 'en',     // default en (overseas-first) — 境内 sets 'zh'
    apiBase: env.VITE_AVERY_API_BASE || '(local default 127.0.0.1:8137)',
  }

  // feat-068 — 部署闸：Vite 在**构建期**把 VITE_* 内联进静态包，所以一个漏配 VITE_AVERY_API_BASE
  // 的 live 构建会**静默成功**，然后把 http://127.0.0.1:8137 烤死在公开 bundle 里 —— 访客的浏览器
  // 去连他自己那台电脑，且 https 页面发 http 请求还会被当混合内容拦掉。线上表现是「后端挂了」，
  // 只有开 devtools 读 window.__AVERY_BUILD__ 才看得出真因。这个类别的错必须在构建时炸，不能等
  // 到真客户打开才发现。只拦 `vite build` 的 live 目标：`vite dev` 和 story 构建照旧走本机默认。
  if (command === 'build' && build.mode === 'live') {
    const base = env.VITE_AVERY_API_BASE
    const localish = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(:|\/|$)/i
    if (!base || localish.test(base)) {
      throw new Error(
        `[avery] refusing to build a live target without a real API base.\n` +
          `  VITE_AVERY_MODE=live but VITE_AVERY_API_BASE=${base ? `"${base}"` : '(unset)'}.\n` +
          `  A bundle built this way calls the VISITOR's own machine and looks like a backend outage.\n` +
          `  Set it to the deployed agent-service origin (production: https://avery.dannyqian.com).`,
      )
    }
  }

  return {
    plugins: [react()],
    define: {
      // JSON-stringified so it lands as a literal object in the bundle; greppable + inspectable.
      __AVERY_BUILD__: JSON.stringify(build),
    },
  }
})
