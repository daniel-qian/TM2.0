import { useLite } from './store'
import { LiteTopbar } from './LiteTopbar'
import { TeamScreen } from './screens/TeamScreen'
import { RoomScreen } from './screens/RoomScreen'
import { DetailOverlay } from './DetailOverlay'

// feat-024（ADR-0022 决策 1）· lite 壳 = 产品本体。v1 三屏：上传空态 · Your team
//（同屏两个状态，TeamScreen）· The room 薄建（RoomScreen）。详情是只读浮层不是 scene。
// 这个壳从不 import src/story/**——边界由 ESLint no-restricted-imports 机器闸看住。
export function LiteApp() {
  const screen = useLite((s) => s.screen)
  const detail = useLite((s) => s.detail)
  return (
    <div className="app-shell lite-shell" data-scene={screen} data-mode="live">
      <LiteTopbar />
      <main className="scene-stage">
        {screen === 'team' ? <TeamScreen /> : <RoomScreen />}
      </main>
      {detail ? <DetailOverlay /> : null}
    </div>
  )
}
