import { useCanvas } from '../store/canvasStore'
import { useMode } from '../../shared/modeStore'
import { Topbar } from './Topbar'
import { HomeScene } from './scenes/HomeScene'
import { DashboardScene } from './scenes/DashboardScene'
import { NexusScene } from './scenes/NexusScene'
import { OnboardingScene } from './scenes/OnboardingScene'
import { ProjectDetailScene } from './scenes/ProjectDetailScene'
import { EmployeeDetailScene } from './scenes/EmployeeDetailScene'
import { CapabilitiesScene } from './scenes/CapabilitiesScene'
import { DemoControls } from './DemoControls'

// P0：按 scene state 条件渲染。scene 间转场动画留到 P1（framer-motion AnimatePresence）。
export function AmbientCanvasShell() {
  const scene = useCanvas((s) => s.scene)
  const mode = useMode((s) => s.mode)
  return (
    <div className="app-shell" data-scene={scene} data-mode={mode}>
      <Topbar />
      <main className="scene-stage">
        {scene === 'onboarding' && <OnboardingScene />}
        {scene === 'home' && <HomeScene />}
        {scene === 'dashboard' && <DashboardScene />}
        {scene === 'nexus' && <NexusScene />}
        {scene === 'project' && <ProjectDetailScene />}
        {scene === 'employee' && <EmployeeDetailScene />}
        {scene === 'capabilities' && <CapabilitiesScene />}
      </main>
      {/* 剧本 rail 只属于 story mode。live = 上你团队试玩，绝不叠脚本浮层（ADR-0020 决策 3）。
          此前无条件渲染 → live/story 混叠（Danny 截图那团乱）；补上 mode 闸。 */}
      {mode === 'story' && <DemoControls />}
    </div>
  )
}
