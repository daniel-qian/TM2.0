/// <reference types="vite/client" />

// feat-018 (ADR-0021 §5) — build-time env the dual static builds read via `import.meta.env`.
// All optional: unset -> the overseas-first defaults (story mode / EN / local API base) apply.
// The 境内 ZH build sets VITE_AVERY_MODE=live + VITE_AVERY_LOCALE=zh + VITE_AVERY_API_BASE=<境内 svc>.
interface ImportMetaEnv {
  /** 'story' (default) | 'live'. feat-017 src/live/mode.ts. Deploy builds set 'live'. */
  readonly VITE_AVERY_MODE?: 'story' | 'live'
  /** 'en' (default) | 'zh'. feat-018 src/i18n/index.ts. 境内 build sets 'zh'. `?lang=` overrides. */
  readonly VITE_AVERY_LOCALE?: 'en' | 'zh'
  /** Agent service base URL. feat-017 src/live/transport.ts. Defaults to http://127.0.0.1:8137. */
  readonly VITE_AVERY_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// feat-018 — stamped by vite.config.ts `define` at build time. The resolved dual-deploy target.
declare const __AVERY_BUILD__: {
  readonly mode: 'story' | 'live'
  readonly locale: 'en' | 'zh'
  readonly apiBase: string
}
