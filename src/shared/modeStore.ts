import { create } from 'zustand'
import { resolveMode, type AveryMode } from './mode'

// feat-024（ADR-0022 决策 1）：mode 从 liveStore 升到 shared——`?mode=` 的语义从
// "同一棵场景树换数据源"变成"两个壳"（story 壳 = 满血路演资产；lite 壳 = 产品）。
// App.tsx 据此挑壳；两侧 topbar 都经这里切换（切换仍然不整页重载，URL 由调用方写回）。
// story / lite 都只 import shared——这是墙允许的唯一公共地基。

interface ModeState {
  mode: AveryMode
  setMode: (mode: AveryMode) => void
}

export const useMode = create<ModeState>((set) => ({
  mode: resolveMode(),
  setMode: (mode) => set({ mode }),
}))

// 翻 mode 并把 `?mode=` 写进 URL（可分享 / 刷新存活），不整页重载。
// （从 story Topbar 原样上移——两个壳的 topbar 共用同一套切换动作。）
export function applyModeToUrl(mode: AveryMode) {
  if (typeof window === 'undefined' || !window.history) return
  const url = new URL(window.location.href)
  url.searchParams.set('mode', mode)
  window.history.replaceState({}, '', url.toString())
}
