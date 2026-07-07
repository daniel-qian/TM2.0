import { useMode } from './shared/modeStore'
import { AmbientCanvasShell } from './story/components/AmbientCanvasShell'
import { LiteApp } from './lite/LiteApp'

// feat-024（ADR-0022 决策 1）：`?mode=` 的语义 = 两个壳。story 壳 = 满血路演资产
//（rail 回放机器原样，冻结）；lite 壳 = 产品（3 屏 + 薄详情浮层，零 fixtures）。
// 本文件是唯一的合成根——story 与 lite 互不 import（ESLint no-restricted-imports 机器闸）。
export function App() {
  const mode = useMode((s) => s.mode)
  return mode === 'live' ? <LiteApp /> : <AmbientCanvasShell />
}
