import { useMode } from './shared/modeStore'
import { resolveVersion } from './shared/version'
import { AmbientCanvasShell } from './story/components/AmbientCanvasShell'
import { LiteApp } from './lite/LiteApp'
import { Lite2App } from './lite2/Lite2App'

// feat-024（ADR-0022 决策 1）：`?mode=` 的语义 = 两个壳。story 壳 = 满血路演资产
//（rail 回放机器原样，冻结）；lite 壳 = 产品（3 屏 + 薄详情浮层，零 fixtures）。
// feat-035（lite-live-v02 kickoff §架构拍板 2）：live 壳内再分一层版本开关——
// `?v=` 缺省 '1' → LiteApp（v01，冻结，一个字节不变）；`?v=2` → Lite2App（v02 并排新壳）。
// 本文件是唯一的合成根——story / lite / lite2 三者互不 import（ESLint no-restricted-imports 机器闸）。
export function App() {
  const mode = useMode((s) => s.mode)
  if (mode !== 'live') return <AmbientCanvasShell />
  return resolveVersion() === '2' ? <Lite2App /> : <LiteApp />
}
