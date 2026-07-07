// feat-017 · i18n resolver (mirrors landing/app/i18n/index.ts).
//
// EN is the locked default (overseas-first). ZH via `?lang=zh`. zh.ts is M3-generated.
//
// feat-018 (ADR-0021 §5, dual deploy): the 境内 ZH static build must default to Chinese with NO
// query param. Resolution priority MIRRORS mode.ts: URL `?lang=` > build-time env
// `VITE_AVERY_LOCALE` > default EN. So the overseas (Vercel) build stays EN-default and the 境内
// build sets `VITE_AVERY_LOCALE=zh` to flip the default; `?lang=` still overrides live on either
// target (Danny can force EN on the 境内 host or ZH overseas without a rebuild).

import { en, type Dict } from './en'
import { zh } from './zh'

export type Locale = 'en' | 'zh'
export type { Dict }

export const locales: Locale[] = ['en', 'zh']
export const defaultLocale: Locale = 'en'

const DICTS: Record<Locale, Dict> = { en, zh }

function normalizeLocale(raw: string | null | undefined): Locale | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  return v === 'zh' || v === 'en' ? (v as Locale) : null
}

export function resolveLocale(search?: string): Locale {
  // 1) URL query (on-site override — wins even over the build default)
  const qs =
    search ??
    (typeof window !== 'undefined' && window.location ? window.location.search : '')
  try {
    const fromUrl = normalizeLocale(new URLSearchParams(qs).get('lang'))
    if (fromUrl) return fromUrl
  } catch {
    // malformed search string — fall through to env/default
  }

  // 2) build-time env (境内 ZH build flips this to 'zh'; overseas leaves it unset -> EN)
  const fromEnv = normalizeLocale(
    typeof import.meta !== 'undefined' ? import.meta.env?.VITE_AVERY_LOCALE : undefined,
  )
  if (fromEnv) return fromEnv

  // 3) safe default — overseas-first
  return defaultLocale
}

export function getDict(locale: Locale): Dict {
  return DICTS[locale]
}
