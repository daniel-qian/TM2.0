import { lazy, Suspense } from 'react'
import { useMode } from './shared/modeStore'
import { resolveVersion } from './shared/version'

// UIUX 棒 2026-07-20 · 性能：三个壳按需拆包（React.lazy）。此前 App.tsx 静态 import 三棵
// 组件树，产物是 1,005 kB 单 chunk（gzip 307 kB）——v02 的真客户为一段永远不会渲染的
// story 路演资产（cases.ts 全套脚本）和 v01 逃生门买单。拆开后入口只含 react/共享层 +
// 当前壳的那一块，别的壳首次切换时才拉。
// ⚠ 两个注意点（改这里前先读）：
//   1) main.tsx 为测试缝仍然**静态** import 两个 lite store（__liteStore/__lite2Store 必须
//      无条件挂载，门靠它们活着）——store 层（zustand+transport）留在入口 chunk 是有意的，
//      拆的是组件树。别把 main.tsx 那两行也改成动态，那会把门全弄崩。
//   2) Suspense fallback 刻意是 null：壳 chunk 在 CDN 上是一次亚百毫秒的取回，闪一个
//      spinner 比空一帧更打扰（ADR-0015 的安静原则）。别放 loading 文案。
const AmbientCanvasShell = lazy(() =>
  import('./story/components/AmbientCanvasShell').then((m) => ({ default: m.AmbientCanvasShell })),
)
const LiteApp = lazy(() => import('./lite/LiteApp').then((m) => ({ default: m.LiteApp })))
const Lite2App = lazy(() => import('./lite2/Lite2App').then((m) => ({ default: m.Lite2App })))

// feat-024（ADR-0022 决策 1）：`?mode=` 的语义 = 两个壳。story 壳 = 满血路演资产
//（rail 回放机器原样，冻结）；lite 壳 = 产品（3 屏 + 薄详情浮层，零 fixtures）。
// feat-035（lite-live-v02 kickoff §架构拍板 2）：live 壳内再分一层版本开关。
// 🔴 2026-07-19 Danny 拍板 ①：`?v=` 缺省已翻成 '2' → Lite2App（v02，裸链默认，客户真正
// 打开的那一版）；`?v=1` → LiteApp（v01，冻结产品壳，出事时唯一的逃生门，不许删）。
// 缺省值为什么是写死的字面量而不是构建期 env，见 src/shared/version.ts 文件头。
// 本文件是唯一的合成根——story / lite / lite2 三者互不 import（ESLint no-restricted-imports 机器闸）。
export function App() {
  const mode = useMode((s) => s.mode)
  const shell =
    mode !== 'live' ? <AmbientCanvasShell /> : resolveVersion() === '2' ? <Lite2App /> : <LiteApp />
  return <Suspense fallback={null}>{shell}</Suspense>
}
