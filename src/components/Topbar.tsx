import { useCanvas, type Scene } from '../store/canvasStore'
import { useLive } from '../store/liveStore'
import { useDict } from '../i18n/useDict'
import type { AveryMode } from '../live/mode'

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

// feat-017：翻 mode 并把 `?mode=` 写进 URL（可分享 / 刷新存活），不整页重载。
function applyModeToUrl(mode: AveryMode) {
  if (typeof window === 'undefined' || !window.history) return
  const url = new URL(window.location.href)
  url.searchParams.set('mode', mode)
  window.history.replaceState({}, '', url.toString())
}

export function Topbar() {
  const scene = useCanvas((s) => s.scene)
  const goScene = useCanvas((s) => s.goScene)
  const mode = useLive((s) => s.mode)
  const setMode = useLive((s) => s.setMode)
  const { t } = useDict()

  const switchMode = (next: AveryMode) => {
    setMode(next)
    applyModeToUrl(next)
  }

  return (
    <header className="prototype-topbar" aria-label="Prototype controls">
      <nav className="scene-tabs" aria-label="Scene">
        {TABS.map((tab) => (
          <button
            key={tab.scene}
            type="button"
            className={`scene-tab${scene === tab.scene ? ' is-active' : ''}`}
            onClick={() => goScene(tab.scene)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {/* mode 开关（ADR-0020 决策 3）：story = 路演/视频剧场；live = 上你团队试玩 */}
      <div className="mode-switch" role="group" aria-label="Data mode">
        <button
          type="button"
          className={`mode-switch-btn${mode === 'story' ? ' is-active' : ''}`}
          aria-pressed={mode === 'story'}
          title={t.mode.storyHint}
          onClick={() => switchMode('story')}
        >
          {t.mode.storyLabel}
        </button>
        <button
          type="button"
          className={`mode-switch-btn${mode === 'live' ? ' is-active' : ''}`}
          aria-pressed={mode === 'live'}
          title={t.mode.liveHint}
          onClick={() => switchMode('live')}
        >
          {t.mode.liveLabel}
        </button>
      </div>
    </header>
  )
}
