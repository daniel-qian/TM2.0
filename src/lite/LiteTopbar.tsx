import { applyModeToUrl, useMode } from '../shared/modeStore'
import { useDict } from '../shared/i18n/useDict'
import { useLite, type LiteScreen } from './store'
import { showModeSwitch, type AveryMode } from '../shared/mode'

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
      {/* feat-034 polish：Story/Live 开关默认不渲染（?modeSwitch=1 显示，shared/mode.ts
          小工具——lite 只 import shared，墙不破）。缺席时整块不出 DOM，布局无空洞。 */}
      {showModeSwitch() ? (
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
      ) : null}
    </header>
  )
}
