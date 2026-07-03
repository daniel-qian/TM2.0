import { useCanvas, type Scene } from '../store/canvasStore'

// 导航 scene tab。Capabilities 既经 Nexus 钻入（rail B4 / PM agent 卡按钮），
// 也给个 free-click tab（litmus：每个 beat 自由点击可达）。detail 仍走钻入。
// feat-014（ADR-0017）：'Your team' 指向卡片式今日主页；Team map 不再是 tab，
// 只经主页入口进入（dana 守线：别让地图找用户）。
const TABS: { label: string; scene: Scene }[] = [
  { label: 'Onboarding', scene: 'onboarding' },
  { label: 'Your team', scene: 'home' },
  { label: 'The room', scene: 'nexus' },
  { label: 'Playbooks', scene: 'capabilities' },
]

export function Topbar() {
  const scene = useCanvas((s) => s.scene)
  const goScene = useCanvas((s) => s.goScene)
  return (
    <header className="prototype-topbar" aria-label="Prototype controls">
      <nav className="scene-tabs" aria-label="Scene">
        {TABS.map((t) => (
          <button
            key={t.scene}
            type="button"
            className={`scene-tab${scene === t.scene ? ' is-active' : ''}`}
            onClick={() => goScene(t.scene)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </header>
  )
}
