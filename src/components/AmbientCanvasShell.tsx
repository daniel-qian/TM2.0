import { useCanvas } from '../store/canvasStore'
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
  return (
    <div className="app-shell" data-scene={scene}>
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
      <DemoControls />
    </div>
  )
}
