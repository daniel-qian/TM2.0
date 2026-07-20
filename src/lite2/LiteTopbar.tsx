import { applyModeToUrl, useMode } from '../shared/modeStore'
import { useDict } from '../shared/i18n/useDict'
import { useLocaleStore } from '../shared/i18n/localeStore'
import type { Locale } from '../shared/i18n'
import { useLite, type LiteScreen } from './store'
import { useCurrentScreen } from './routes'
import { showModeSwitch, type AveryMode } from '../shared/mode'
import { useLook } from './lookStore'
import type { LiteLook } from './look'
import { LiteBell } from './LiteBell'
import { AuthPanel } from './auth/AuthPanel'

// feat-035 · lite2 壳的顶栏：6 tab + mode 开关。复用 story 顶栏的 CSS chrome
//（.prototype-topbar 容器 pointer-events:none——可点子元素 .scene-tabs/.mode-switch
// 各自 auto 回来，4e90966 的坑已由既有规则盖住）。
// feat-045：加通知铃铛（LiteBell）——放在 .scene-tabs nav 之外（v2Boots 门相位按
// `.scene-tabs .scene-tab` 数 6 个 tab，铃铛不得混进去）；.lite-bell 在 lite2.css 里
// 自己 pointer-events:auto 回来（同 .scene-tabs/.mode-switch 的规矩）。
// open-loop-0720：加语言（中文/英文）+ 观感（暖纸/极光）两个开关——同一套「nav 之外、
// 自己 pointer-events:auto 回来」的规矩，见 .lang-switch/.look-switch 在 lite2.css 里的样式块。
export function LiteTopbar() {
  // feat-051：高亮哪个 tab 由 URL 说了算（深链 `/team/:personId` 归到「你的团队」）。
  const screen = useCurrentScreen()
  const goScreen = useLite((s) => s.goScreen)
  const mode = useMode((s) => s.mode)
  const setMode = useMode((s) => s.setMode)
  const { t } = useDict()
  // open-loop-0720：语言 + 观感两个开关。二者都是「URL 参数 > localStorage > 默认值」——
  // 解析细节分别见 shared/i18n/index.ts（resolveLocale）与 lite2/look.ts（resolveLook），
  // 反应式落点分别是 localeStore.ts 与 lookStore.ts（点开关立即生效，不必刷新；写
  // localStorage 的动作在各自的 setLocale/setLook 里，深链场景的同步在各 store 的
  // 初始化函数里，见那两个文件的注释）。
  const locale = useLocaleStore((s) => s.locale)
  const setLocale = useLocaleStore((s) => s.setLocale)
  const look = useLook((s) => s.look)
  const setLook = useLook((s) => s.setLook)

  // PRD 顺序（6 tab）+ feat-047 第 7 tab：Your team · The room · Follow-ups · Avery's notes ·
  // A closer look · Playbooks · Where this goes。笔记面移植自 src/lite，放在 Follow-ups 之后
  // （本棒的 tab 顺序决定，理由见 progress.md）。
  // feat-057：聚合入口排在最前——它是 `/` 的落点，也是"今天先看哪儿"的那一屏；
  // 排在末尾的入口不叫入口。7 个分屏一个没退休，顺序一个没动，只是前面多了一扇门。
  const tabs: { label: string; screen: LiteScreen }[] = [
    { label: t.lite2.tabHome, screen: 'home' },
    { label: t.lite2.tabTeam, screen: 'team' },
    // feat-055（PRD G9）：第 8 个 tab「项目」。放在「你的团队」之后而不是队尾——它和团队屏
    // 是同一份上传长出来的两半（人 / 项目），排到「Where this goes」后面等于把主数据屏
    // 塞进未来叙事之后。
    // 🔴 这个数组一动（增 / 删 / 重排），必须在**同一个 commit** 里同步
    // `scripts/gates/live-frontend-gate.snippet.js` 的 `assertV2Boots` 期望数组，
    // 否则门的 v2Boots 相位必红。feat-057 加 `home` tab 时同理。
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

  const switchLocale = (next: Locale) => {
    if (next !== locale) setLocale(next)
  }

  const switchLook = (next: LiteLook) => {
    if (next !== look) setLook(next)
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
      {/* open-loop-0720：语言开关（中文/英文）。同样在 .scene-tabs nav 之外（门相位按
          `.scene-tabs .scene-tab` 数 tab，不得混进去）。可见文案 100% 走字典——中文纯度门
          （verify-zh-purity.mjs）扫的是 zh 下的 innerText，字典里这两个键在 zh.ts 已是纯中文
          （中文/英文，不是字母 ZH/EN）。 */}
      <div className="lang-switch" role="group" aria-label={t.lite2.langSwitchAria}>
        <button
          type="button"
          className={`lang-switch-btn${locale === 'zh' ? ' is-active' : ''}`}
          aria-pressed={locale === 'zh'}
          onClick={() => switchLocale('zh')}
        >
          {t.lite2.langSwitchZh}
        </button>
        <button
          type="button"
          className={`lang-switch-btn${locale === 'en' ? ' is-active' : ''}`}
          aria-pressed={locale === 'en'}
          onClick={() => switchLocale('en')}
        >
          {t.lite2.langSwitchEn}
        </button>
      </div>
      {/* open-loop-0720：观感开关（暖纸/极光）。lite2 专属——v01 没有 Look 概念，
          resolveLook()/lookStore.ts 只在这棵树里。 */}
      <div className="look-switch" role="group" aria-label={t.lite2.lookSwitchAria}>
        <button
          type="button"
          className={`look-switch-btn${look === 'paper' ? ' is-active' : ''}`}
          aria-pressed={look === 'paper'}
          onClick={() => switchLook('paper')}
        >
          {t.lite2.lookSwitchPaper}
        </button>
        <button
          type="button"
          className={`look-switch-btn${look === 'aurora' ? ' is-active' : ''}`}
          aria-pressed={look === 'aurora'}
          onClick={() => switchLook('aurora')}
        >
          {t.lite2.lookSwitchAurora}
        </button>
      </div>
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
