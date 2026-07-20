// feat-017 · i18n resolver (mirrors landing/app/i18n/index.ts).
//
// EN is the locked default (overseas-first). ZH via `?lang=zh`. zh.ts is M3-generated.
//
// feat-018 (ADR-0021 §5, dual deploy): the 境内 ZH static build must default to Chinese with NO
// query param. Resolution priority MIRRORS mode.ts: URL `?lang=` > build-time env
// `VITE_AVERY_LOCALE` > default EN. So the overseas (Vercel) build stays EN-default and the 境内
// build sets `VITE_AVERY_LOCALE=zh` to flip the default; `?lang=` still overrides live on either
// target (Danny can force EN on the 境内 host or ZH overseas without a rebuild).
//
// open-loop-0720（v02 语言开关）：链条里插了一级 localStorage —— URL `?lang=` > localStorage
// （开关记住的选择）> 构建期 env > 默认 EN。v01（src/lite）没有开关 UI，从不写这个
// localStorage key，所以这一级对纯 v01 会话是惰性的（同源共享 localStorage 意味着真实浏览器
// 里若先在 v02 切过语言，v01 也会跟着走——这是预期的"同一个产品"行为，不是回归）。
// 反应式消费见 localeStore.ts（useDict 订阅它才能做到"点开关立即生效，不必刷新"）。

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

function localeFromUrl(search?: string): Locale | null {
  const qs =
    search ??
    (typeof window !== 'undefined' && window.location ? window.location.search : '')
  try {
    return normalizeLocale(new URLSearchParams(qs).get('lang'))
  } catch {
    return null // malformed search string
  }
}

// 语言开关的 localStorage 落点。key 带 `lite2:` 前缀——与 store.ts/onboardStore.ts 等既有
// v02 key 同一命名族（只有 v02 的开关写它）。
export const LOCALE_STORAGE_KEY = 'lite2:lang:v1'

function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY))
  } catch {
    return null // private mode / storage disabled — fall through the chain
  }
}

export function persistLocale(locale: Locale): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // storage full/disabled — the switch still works in-memory, it just won't survive a refresh
  }
}

// 供 localeStore.ts 在挂载时判断"这次的值是不是 URL 给的"，从而把深链参数同步进
// localStorage（kickoff 需求②）。resolveLocale 本身保持纯函数——它被 transport.ts/
// teamData.ts 当成普通工具函数在非 React 路径上直接调用，不该有写盘副作用。
export function localeFromUrlParam(search?: string): Locale | null {
  return localeFromUrl(search)
}

export function resolveLocale(search?: string): Locale {
  // 1) URL query（现场覆盖——赢过 localStorage 和构建期默认）
  const fromUrl = localeFromUrl(search)
  if (fromUrl) return fromUrl

  // 2) localStorage（语言开关记住的选择）
  const fromStorage = readStoredLocale()
  if (fromStorage) return fromStorage

  // 3) build-time env (境内 ZH build flips this to 'zh'; overseas leaves it unset -> EN)
  const fromEnv = normalizeLocale(
    typeof import.meta !== 'undefined' ? import.meta.env?.VITE_AVERY_LOCALE : undefined,
  )
  if (fromEnv) return fromEnv

  // 4) safe default — overseas-first
  return defaultLocale
}

export function getDict(locale: Locale): Dict {
  return DICTS[locale]
}
