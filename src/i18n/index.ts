// feat-017 · i18n resolver (mirrors landing/app/i18n/index.ts).
//
// EN is the locked default (overseas-first). ZH via `?lang=zh`. zh.ts is M3-generated.

import { en, type Dict } from './en'
import { zh } from './zh'

export type Locale = 'en' | 'zh'
export type { Dict }

export const locales: Locale[] = ['en', 'zh']
export const defaultLocale: Locale = 'en'

const DICTS: Record<Locale, Dict> = { en, zh }

export function resolveLocale(search?: string): Locale {
  const qs =
    search ??
    (typeof window !== 'undefined' && window.location ? window.location.search : '')
  try {
    const raw = new URLSearchParams(qs).get('lang')
    return raw === 'zh' ? 'zh' : 'en'
  } catch {
    return 'en'
  }
}

export function getDict(locale: Locale): Dict {
  return DICTS[locale]
}
