import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// feat-024：global.css 按墙拆分（shared 原子 / story 专属 / lite 增量）。合成根按原文件
// 顺序 import——shared/story 各 chunk 的串联与拆分前的 global.css 逐字节一致（cascade 零漂移），
// lite.css 是唯一新增、排最后。别重排这串 import。
import './shared/styles/00-base.css'
import './story/styles/10-dashboard-nexus.css'
import './shared/styles/20-report-card.css'
import './story/styles/30-scenes-rail.css'
import './shared/styles/40-nexus-empty.css'
import './story/styles/50-followup-chip.css'
import './shared/styles/55-ask-composer.css'
import './story/styles/58-threads-errands.css'
// feat-034 阶段 A：Ask（Quick ask）卡样式——纯新增 selector（.quick-ask-*），插在 58 后
// 不触碰既有 chunk 的相对顺序（cascade 对既有 selector 零漂移）。
import './story/styles/59-quick-ask.css'
import './shared/styles/60-terminal.css'
import './shared/styles/70-home-cards.css'
import './lite/styles/lite.css'
import { App } from './App'
import { useLite } from './lite/store'

// feat-018 — expose the build-stamped dual-deploy target (see vite.config.ts). Lets Danny confirm
// which target a deployed bundle is (mode/locale/api base) from devtools, and keeps the stamp in
// the bundle for the build-targets smoke to assert. No behavior; purely a diagnostic marker.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __AVERY_BUILD__?: unknown }).__AVERY_BUILD__ = __AVERY_BUILD__
}

// feat-032 — DEV-ONLY test seam: expose the lite store so an AFK/browser DOM check can inject a
// deterministic stub transport (setTransport) and drive the file-space view without a real backend
// or LLM. Mirrors the __AVERY_BUILD__ diagnostic; `import.meta.env.DEV` is statically false in a
// production build, so Vite dead-code-eliminates this entire block — it never ships.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __AVERY_LITE__?: unknown }).__AVERY_LITE__ = useLite
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
