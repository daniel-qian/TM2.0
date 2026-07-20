import { create } from 'zustand'
import { localeFromUrlParam, persistLocale, resolveLocale, type Locale } from './index'

// open-loop-0720 · 语言开关的反应式落点。
//
// 为什么落在 shared/i18n 而不是 lite2/：useDict()（v01/v02 共用，src/shared/i18n/useDict.ts）
// 要在开关点下去之后立即重渲染整棵树，不能等刷新——这要求 locale 来自一个可订阅的 store，
// 而不是 useMemo(() => resolveLocale(), [])（挂载时算一次，state 变了也不会重算，见改动前的
// useDict.ts）。只有 v02 的 LiteTopbar 会调 setLocale；v01 没有开关 UI，从不调用它，
// 这个 store 对纯 v01 会话是惰性的——初值仍是 resolveLocale()（URL > localStorage > env >
// 默认），行为与开关上线前一致。
//
// 早读（模块加载时，即 import 时机）避免首帧闪错语言：zustand 的 create() 在 import 阶段就
// 跑初始化函数，比组件的 useState 初始化器还早一步落定，首次 commit 时 DOM 上已经是最终值。
export interface LocaleState {
  locale: Locale
  setLocale: (locale: Locale) => void
}

function initialLocale(): Locale {
  const locale = resolveLocale()
  // 深链同步（kickoff 需求②）：`?lang=` 显式给出时，把这次的选择落 localStorage——下次
  // 不带参数的裸链/刷新仍保持这次的选择。只在「这次确实是 URL 赢的」时才写，否则每次
  // 无参访问都会把 env/默认值错当"用户选择"焊死进 localStorage。
  if (localeFromUrlParam() === locale) persistLocale(locale)
  return locale
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: initialLocale(),
  setLocale: (locale) => {
    persistLocale(locale)
    set({ locale })
  },
}))
