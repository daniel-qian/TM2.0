import { applyModeToUrl, useMode } from '../shared/modeStore'
import { useDict } from '../shared/i18n/useDict'
import { useLite, type LiteScreen } from './store'
import { useCurrentScreen } from './routes'
import { showModeSwitch, type AveryMode } from '../shared/mode'
import { LiteBell } from './LiteBell'
import { AuthPanel } from './auth/AuthPanel'

// feat-035 · lite2 壳的顶栏：6 tab + mode 开关。复用 story 顶栏的 CSS chrome
//（.prototype-topbar 容器 pointer-events:none——可点子元素 .scene-tabs/.mode-switch
// 各自 auto 回来，4e90966 的坑已由既有规则盖住）。
// feat-045：加通知铃铛（LiteBell）——放在 .scene-tabs nav 之外（v2Boots 门相位按
// `.scene-tabs .scene-tab` 数 6 个 tab，铃铛不得混进去）；.lite-bell 在 lite2.css 里
// 自己 pointer-events:auto 回来（同 .scene-tabs/.mode-switch 的规矩）。
export function LiteTopbar() {
  // feat-051：高亮哪个 tab 由 URL 说了算（深链 `/team/:personId` 归到「你的团队」）。
  const screen = useCurrentScreen()
  const goScreen = useLite((s) => s.goScreen)
  const mode = useMode((s) => s.mode)
  const setMode = useMode((s) => s.setMode)
  const { t } = useDict()

  // PRD 顺序（6 tab）+ feat-047 第 7 tab：Your team · The room · Follow-ups · Avery's notes ·
  // A closer look · Playbooks · Where this goes。笔记面移植自 src/lite，放在 Follow-ups 之后
  // （本棒的 tab 顺序决定，理由见 progress.md）。
  const tabs: { label: string; screen: LiteScreen }[] = [
    { label: t.lite2.tabTeam, screen: 'team' },
    // feat-055（PRD G9）：第 8 个 tab「项目」。放在「你的团队」之后而不是队尾——它和团队屏
    // 是同一份上传长出来的两半（人 / 项目），排到「Where this goes」后面等于把主数据屏
    // 塞进未来叙事之后。⚠️ 门相位 v2Boots 硬编码了 7 个 tab 的标签数组，本条与 feat-057
    // 的 tab 都会让它对不上——见 progress-feat-055.md 的 Notes（本条不改门，避免与并行线
    // 在同一处打架，由集成方一次性更新期望值）。
    { label: t.lite2.tabProjects, screen: 'projects' },
    { label: t.lite2.tabRoom, screen: 'room' },
    { label: t.lite2.tabFollowups, screen: 'followups' },
    { label: t.lite2.tabNotes, screen: 'notes' },
    { label: t.lite2.tabCloserLook, screen: 'closerlook' },
    { label: t.lite2.tabPlaybooks, screen: 'playbooks' },
    { label: t.lite2.tabVision, screen: 'vision' },
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
      {/* feat-045：通知铃铛——真事件驱动（notifyStore），nav 之外、mode 开关之前。 */}
      <LiteBell />
      {/* feat-053：账号入口。同样在 .scene-tabs nav 之外（门相位按 `.scene-tabs .scene-tab`
          数 tab，账号按钮不得混进去）。未配置 Supabase 时整块不渲染 —— 游客路径不受影响。 */}
      <AuthPanel />
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
