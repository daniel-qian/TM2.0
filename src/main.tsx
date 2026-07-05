import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import { App } from './App'

// feat-018 — expose the build-stamped dual-deploy target (see vite.config.ts). Lets Danny confirm
// which target a deployed bundle is (mode/locale/api base) from devtools, and keeps the stamp in
// the bundle for the build-targets smoke to assert. No behavior; purely a diagnostic marker.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __AVERY_BUILD__?: unknown }).__AVERY_BUILD__ = __AVERY_BUILD__
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
