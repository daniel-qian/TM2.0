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
import { selectWizardOpen, useOnboard } from './onboardStore'
import { resolveLook } from './look'

// feat-035（lite-live-v02 kickoff §架构拍板 1）· lite2 壳 = v02 并排产品本体。
// copy-then-wall：整树从 src/lite/** 复制而来（引擎含在内），lite ↔ lite2 零交叉 import——
// 边界由 ESLint no-restricted-imports 机器闸看住（这个壳也从不 import src/story/**）。
// v1 冻结：src/lite/** 一行不改；这里独立生长六屏骨架 + 观感（Look）令牌层 + 合规页脚。
//
// 6-tab 骨架（PRD 顺序）：Your team · The room · Follow-ups · A closer look · Playbooks ·
// Where this goes。Follow-ups / A closer look 本波先空态占位（feat-036/037 真派生）。
// feat-047：第 7 tab「Avery's notes」移植自 src/lite，插在 Follow-ups 之后（tab 顺序为本棒
// 默认决定，理由见 progress.md；最终排位交 review 包给 Danny 拍）。
export function Lite2App() {
  const screen = useLite((s) => s.screen)
  const detail = useLite((s) => s.detail)
  // feat-068：观感（Look，原 skin——`Skin` 现专指 ADR-0021 的行业视觉主题）只在挂载时读一次
  // URL（与 useDict 的 locale 解析同口径）——现场切换走整页刷新（试玩场景足够；运行时热切换
  // 留待需要时再做）。
  const look = useMemo(() => resolveLook(), [])

  // feat-045：通知事件接线（真事件订阅，模块级 guard 幂等）+ 首访 onboarding 向导
  // （覆盖层；unseen/in-progress 且本会话未 × 时挂载——localStorage 记状态与进度）。
  useEffect(() => {
    initNotifications()
  }, [])
  const wizardOpen = useOnboard(selectWizardOpen)

  return (
    <div className="app-shell lite2-shell" data-scene={screen} data-mode="live" data-look={look}>
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
      {detail ? <DetailOverlay /> : null}
      {wizardOpen ? <OnboardWizard /> : null}
      <Lite2Footer />
    </div>
  )
}
