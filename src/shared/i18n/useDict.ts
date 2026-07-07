import { useMemo } from 'react'
import { getDict, resolveLocale, type Dict, type Locale } from './index'

// feat-017：极简 i18n hook。locale 由 `?lang=zh` 一次解析（无运行时切换 UI——与 landing 同口径，
// EN 默认；ZH 供境内部署 feat-018）。返回整本字典 + 当前 locale。
export function useDict(): { t: Dict; locale: Locale } {
  const locale = useMemo<Locale>(() => resolveLocale(), [])
  const t = useMemo<Dict>(() => getDict(locale), [locale])
  return { t, locale }
}
