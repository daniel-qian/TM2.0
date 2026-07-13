import { applyModeToUrl, useMode } from '../shared/modeStore'
import { useDict } from '../shared/i18n/useDict'
import { useLite, type LiteScreen } from './store'
import type { AveryMode } from '../shared/mode'

// lite 壳的顶栏：两屏 tab + mode 开关。复用 story 顶栏的 CSS chrome
//（.prototype-topbar 容器 pointer-events:none——可点子元素 .scene-tabs/.mode-switch
// 各自 auto 回来，4e90966 的坑已由既有规则盖住）。
export function LiteTopbar() {
  const screen = useLite((s) => s.screen)
  const goScreen = useLite((s) => s.goScreen)
  const mode = useMode((s) => s.mode)
  const setMode = useMode((s) => s.setMode)
  const { t } = useDict()

  const tabs: { label: string; screen: LiteScreen }[] = [
    { label: t.lite.tabTeam, screen: 'team' },
    { label: t.lite.tabRoom, screen: 'room' },
    { label: t.lite.tabNotes, screen: 'notes' },
    { label: t.lite.tabPlaybooks, screen: 'playbooks' },
    { label: t.lite.tabVision, screen: 'vision' },
  ]

  const switchMode = (next: AveryMode) => {
    setMode(next)
    applyModeToUrl(next)
  }

  return (
    <header className="prototype-topbar" aria-label="Avery controls">
      <nav className="scene-tabs" aria-label="Screen">
        {tabs.map((tab) => (
          <button
            key={tab.screen}
            type="button"
            className={`scene-tab${screen === tab.screen ? ' is-active' : ''}`}
            onClick={() => goScreen(tab.screen)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
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
