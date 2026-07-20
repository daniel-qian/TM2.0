import { useMemo } from 'react'
import { getDict, type Dict, type Locale } from './index'
import { useLocaleStore } from './localeStore'

// feat-017：极简 i18n hook。locale 曾经只由 `?lang=zh` 一次解析（无运行时切换 UI——与 landing
// 同口径，EN 默认；ZH 供境内部署 feat-018）。
// open-loop-0720：v02 加了语言开关（LiteTopbar），locale 因此改从 localeStore 订阅——点开关后
// 这里会跟着重渲染，不必刷新。v01 没有开关 UI，从不触发这个 store 的变化，行为不受影响。
// 返回整本字典 + 当前 locale。
export function useDict(): { t: Dict; locale: Locale } {
  const locale = useLocaleStore((s) => s.locale)
  const t = useMemo<Dict>(() => getDict(locale), [locale])
  return { t, locale }
}
