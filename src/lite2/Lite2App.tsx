import { useEffect, useMemo } from 'react'
import { useLite } from './store'
import { LiteTopbar } from './LiteTopbar'
import { TeamScreen } from './screens/TeamScreen'
import { RoomScreen } from './screens/RoomScreen'
import { FollowupsScreen } from './screens/FollowupsScreen'
import { NotesScreen } from './screens/NotesScreen'
import { CloserLookScreen } from './screens/CloserLookScreen'
import { PlaybooksScreen } from './screens/PlaybooksScreen'
import { VisionScreen } from './screens/VisionScreen'
import { DetailOverlay } from './DetailOverlay'
import { Lite2Footer } from './Lite2Footer'
import { OnboardWizard } from './OnboardWizard'
import { initNotifications } from './notifyStore'
import { resolveSkin } from './skin'

// feat-035（lite-live-v02 kickoff §架构拍板 1）· lite2 壳 = v02 并排产品本体。
// copy-then-wall：整树从 src/lite/** 复制而来（引擎含在内），lite ↔ lite2 零交叉 import——
// 边界由 ESLint no-restricted-imports 机器闸看住（这个壳也从不 import src/story/**）。
// v1 冻结：src/lite/** 一行不改；这里独立生长六屏骨架 + 皮肤令牌层 + 合规页脚。
//
// 6-tab 骨架（PRD 顺序）：Your team · The room · Follow-ups · A closer look · Playbooks ·
// Where this goes。Follow-ups / A closer look 本波先空态占位（feat-036/037 真派生）。
// feat-047：第 7 tab「Avery's notes」移植自 src/lite，插在 Follow-ups 之后（tab 顺序为本棒
// 默认决定，理由见 progress.md；最终排位交 review 包给 Danny 拍）。
export function Lite2App() {
  const screen = useLite((s) => s.screen)
  // 皮肤只在挂载时读一次 URL（与 useDict 的 locale 解析同口径）——现场切皮走整页刷新
  // （试玩场景足够；运行时热切换留待需要时再做）。
  const skin = useMemo(() => resolveSkin(), [])

  // feat-045：通知事件接线（真事件订阅，模块级 guard 幂等）。首访 onboarding 向导的开合
  // 判定（unseen/in-progress 且本会话未 ×）feat-052 起收在 OnboardWizard 自己手里。
  useEffect(() => {
    initNotifications()
  }, [])

  return (
    <div className="app-shell lite2-shell" data-scene={screen} data-mode="live" data-skin={skin}>
      <LiteTopbar />
      <main className="scene-stage">
        {screen === 'team' ? (
          <TeamScreen />
        ) : screen === 'followups' ? (
          <FollowupsScreen />
        ) : screen === 'notes' ? (
          <NotesScreen />
        ) : screen === 'closerlook' ? (
          <CloserLookScreen />
        ) : screen === 'playbooks' ? (
          <PlaybooksScreen />
        ) : screen === 'vision' ? (
          <VisionScreen />
        ) : (
          <RoomScreen />
        )}
      </main>
      {/* feat-052：两个弹层都常驻挂载，开关在各自组件里（LiteModal 的 open）——父层条件挂载
          会把组件直接摘掉，出场动画没机会跑。 */}
      <DetailOverlay />
      <OnboardWizard />
      <Lite2Footer />
    </div>
  )
}
