import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { applyModeToUrl, useMode } from '../shared/modeStore'
import { useDict } from '../shared/i18n/useDict'
import { useLocaleStore } from '../shared/i18n/localeStore'
import type { Locale } from '../shared/i18n'
import { useLite, type LiteScreen } from './store'
import { paperworkHref, visionHref, useCurrentScreen } from './routes'
import { showModeSwitch, type AveryMode } from '../shared/mode'
import { useLook } from './lookStore'
import type { LiteLook } from './look'
import { LiteBell } from './LiteBell'
import { LiteSearch } from './LiteSearch'
import { AuthPanel, restartAll } from './auth/AuthPanel'

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
  // 0721 · 7B：语言/观感切换器收进次级设置菜单（Danny：demo 试玩器常驻顶栏不符合常理
  // UIUX）。本地态即可——菜单不跨屏持久，刷新回到收起是预期行为。
  const [settingsOpen, setSettingsOpen] = useState(false)
  // rich-align-0722/09：「重新开始」误触保护——两击确认（首击变「确认？」，再击才执行）。
  // 菜单收起即复位确认态（不留半确认残留）。
  const [confirmRestart, setConfirmRestart] = useState(false)
  const closeSettings = () => {
    setSettingsOpen(false)
    setConfirmRestart(false)
  }

  // ui-sweep-0802 · 弹层 Escape 失聪实锤：原 Escape 挂在 pop 的 onKeyDown 上，焦点不在菜单
  // 内（比如刚点完开关、焦点还在 body）就没反应。展开期挂 document 级 Escape，收起即卸。
  // 🔴 刻意只修 Escape、不做「点外即收」也不做与铃铛互斥：verify-button-family 的防作弊
  // 计数（≥15）靠**同时展开**两弹层审计其内按钮，verify-onboard-gate 世界 F 的两击确认
  // 「重新开始」也依赖菜单在外点后仍开。叠加是否算产品缺陷留 Danny 裁，别在这里顺手改。
  useEffect(() => {
    if (!settingsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsOpen(false)
        setConfirmRestart(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [settingsOpen])

  // uiux-narrow-0728 · tab 条溢出信号。.scene-tabs 是横滚容器且藏了滚动条
  // （lite2.css l.5414 scrollbar-width:none + ::-webkit-scrollbar{display:none}）——960px 起
  // 「未来方向」就滑出可视区，390px 掉六个，屏上却没有任何「右边还有」的提示，第一次用的人
  // 不知道那几屏存在（合伙人验收暴露的同批问题）。这里只量、只打 data-overflow，渐隐遮罩由
  // CSS 挂（lite2.css 尾 ④）。🔴 不真溢出就不打属性 —— 宽屏一像素不变，像素基线不动。
  const tabsRef = useRef<HTMLElement | null>(null)
  const [tabsOverflow, setTabsOverflow] = useState<'none' | 'left' | 'right' | 'both'>('none')
  useEffect(() => {
    const el = tabsRef.current
    if (!el) return
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth
      if (max <= 1) return setTabsOverflow('none')
      const hasLeft = el.scrollLeft > 1
      const hasRight = el.scrollLeft < max - 1
      setTabsOverflow(hasLeft && hasRight ? 'both' : hasLeft ? 'left' : 'right')
    }
    // 当前屏的 tab 若被滑出可视区，把它拉回来（窄屏 9 个 tab 必然溢出；不拉回的话
    // 点进某屏后高亮 tab 看不见，等于丢了「我在哪」）。🔴 只动 el.scrollLeft，不用
    // scrollIntoView —— 后者会连带滚祖先，能把整页顶上去。
    const revealActive = () => {
      const active = el.querySelector('.scene-tab.is-active')
      if (!active) return
      const a = active.getBoundingClientRect()
      const e = el.getBoundingClientRect()
      if (a.left < e.left + 8) el.scrollLeft -= e.left + 8 - a.left
      else if (a.right > e.right - 8) el.scrollLeft += a.right - (e.right - 8)
    }
    revealActive()
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    // 视口变化改 clientWidth；语言切换改 scrollWidth（en tab 条实测比 zh 宽 ~200px），
    // 后者靠 effect 依赖 locale 重跑。
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      ro.disconnect()
    }
  }, [locale, screen])

  // PRD 顺序（6 tab）+ feat-047 第 7 tab：Your team · The room · Follow-ups · Avery's notes ·
  // A closer look · Playbooks · Where this goes。笔记面移植自 src/lite，放在 Follow-ups 之后
  // （本棒的 tab 顺序决定，理由见 progress.md）。
  // feat-057：聚合入口排在最前——它是 `/` 的落点，也是"今天先看哪儿"的那一屏；
  // 排在末尾的入口不叫入口。7 个分屏一个没退休，顺序一个没动，只是前面多了一扇门。
  // 0721 对齐棒 · Danny 拍板 2C（主+副小字）：home/followups 换主名（指挥室/待办清单），
  // 原名降为副小字（sub）。副小字渲染成 .scene-tab-sub（display:block 的 10px 行，样式在
  // lite2.css 0721 段），门读主名走 .scene-tab-main。其余 7 tab 无 sub，DOM 形状不变。
  // 0729 大白话命名（ADR-0031）：home 主名改回「今天/Today」，副小字取消；
  // 5 个 tab 主名换企业大白话，词表 Danny 07-29 审字通过。
  // （当年那句「tabHomeSub 键保留未用」已过期：2026-08-03 的 i18n 孤儿清理做完 git 考古 +
  //  对抗复核，确认它是退役文案而非被吃掉的功能，键已删。同族的 tabFollowupsSub 仍在用，别一起删。）
  const tabs: { label: string; sub?: string; screen: LiteScreen }[] = [
    { label: t.lite2.tabHome, screen: 'home' },
    { label: t.lite2.tabTeam, screen: 'team' },
    // feat-055（PRD G9）：第 8 个 tab「项目」。放在「你的团队」之后而不是队尾——它和团队屏
    // 是同一份上传长出来的两半（人 / 项目），排到「Where this goes」后面等于把主数据屏
    // 塞进未来叙事之后。
    // 🔴 这个数组一动（增 / 删 / 重排 / 改主名），必须在**同一个 commit** 里同步
    // `scripts/gates/live-frontend-gate.snippet.js` 的 `assertV2Boots` 期望数组，
    // 否则门的 v2Boots 相位必红。feat-057 加 `home` tab 时同理。
    { label: t.lite2.tabProjects, screen: 'projects' },
    { label: t.lite2.tabRoom, screen: 'room' },
    { label: t.lite2.tabFollowups, sub: t.lite2.tabFollowupsSub, screen: 'followups' },
    { label: t.lite2.tabNotes, screen: 'notes' },
    { label: t.lite2.tabCloserLook, screen: 'closerlook' },
    { label: t.lite2.tabPlaybooks, screen: 'playbooks' },
    // files-hub-0729/01（ADR-0032）· tab 换防：「资料库 / Files」进队尾，「完整版预告」
    // （vision）出 tabs 数组、降进下面的设置菜单。净效果是 tab 数从 9 回到 9 —— 加一个、
    // 减一个，窄屏溢出的压力没有变差（uiux-narrow-0728 那条 bug 的射程不变）。
    //
    // 🔴 为什么 vision 可以下、七个分屏不可以：feat-057 的裁定原文是「聚合与分屏两极都要，
    // 7 个分屏一个都没退休」，指的是 team/room/followups/notes/closerlook/playbooks/projects
    // 这七屏。vision 是 feat-026 的**叙事页**，从来不在那七个里面 —— 把它的 tab 收进设置
    // 菜单不触碰那条裁定。而且它的路由、屏组件、data-scene 一个字没改，只是入口换了地方
    //（同 /paperwork 的待遇）。
    { label: t.lite2.tabFiles, screen: 'files' },
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
    <header className="prototype-topbar" aria-label={t.lite2.topbarAria}>
      <nav
        className="scene-tabs"
        aria-label={t.lite2.screenNavAria}
        ref={tabsRef}
        data-overflow={tabsOverflow === 'none' ? undefined : tabsOverflow}
      >
        {tabs.map((tab) => (
          <button
            key={tab.screen}
            type="button"
            className={`scene-tab${screen === tab.screen ? ' is-active' : ''}`}
            onClick={() => goScreen(tab.screen)}
          >
            {tab.sub ? (
              <>
                {/* 主名进 .scene-tab-main（门 assertV2Boots 只读它），副小字 aria-hidden——
                    读屏只念主名，不念「指挥室 今天」连读。 */}
                <span className="scene-tab-main">{tab.label}</span>
                <span className="scene-tab-sub" aria-hidden="true">
                  {tab.sub}
                </span>
              </>
            ) : (
              tab.label
            )}
          </button>
        ))}
      </nav>
      {/* 棒E：顶栏真搜索（布局与真部件战役）——nav 之外（门相位按 `.scene-tabs .scene-tab`
          数 tab，搜索块不得混进 .scene-tabs）。纯客户端内存检索，零 transport。断点 1280
          （<1280 CSS 里 hidden，见 lite2.css 棒E 段）；无材料时组件自身返回 null。 */}
      <LiteSearch />
      {/* feat-045：通知铃铛——真事件驱动（notifyStore），nav 之外、mode 开关之前。 */}
      <LiteBell />
      {/* feat-053：账号入口。同样在 .scene-tabs nav 之外（门相位按 `.scene-tabs .scene-tab`
          数 tab，账号按钮不得混进去）。未配置 Supabase 时整块不渲染 —— 游客路径不受影响。 */}
      <AuthPanel />
      {/* 0721 · 7B（Danny 拍板）：语言/观感切换器从顶栏常驻收进次级设置菜单。
          菜单**内部**的 .lang-switch/.look-switch 结构与类名一字未动（open-loop-0720 原样
          搬进来）——verify-switchers/verify-auth-form 两道门只多一步「先点 .lite-settings-toggle」。
          仍在 .scene-tabs nav 之外（门相位数 tab 不得混进去）；.lite-settings 在 lite2.css 里
          自己 pointer-events:auto 回来（同 .lang-switch/.look-switch 的老规矩）。
          可见文案 100% 走字典（齿轮符号 ⚙ 是标点级字形，zh-purity 扫的是字母）。 */}
      <div className="lite-settings">
        <button
          type="button"
          className="lite-settings-toggle"
          aria-haspopup="true"
          aria-expanded={settingsOpen}
          aria-label={t.lite2.settingsAria}
          title={t.lite2.settingsAria}
          onClick={() => (settingsOpen ? closeSettings() : setSettingsOpen(true))}
        >
          <span aria-hidden="true">⚙</span>
        </button>
        {settingsOpen ? (
          <div
            className="lite-settings-pop"
            role="group"
            aria-label={t.lite2.settingsAria}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeSettings()
            }}
          >
            <div className="lite-settings-row">
              <span className="lite-settings-row-label">{t.lite2.langSwitchAria}</span>
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
            </div>
            <div className="lite-settings-row">
              <span className="lite-settings-row-label">{t.lite2.lookSwitchAria}</span>
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
            </div>
            {/* partner-docs-0728 ·「文件与表单」入口（→ /paperwork）。
                插在**语言/观感之后、重新开始之前**：verify-switchers / verify-auth-form 按
                `.nth(0/1)` 索引语言与观感那两行，插在它们之后不动那两个索引；而「重新开始」
                是靠 `.lite-settings-restart` 类名找的、不吃 nth，所以把它往后推一位是安全的。
                放在销毁类按钮之前也更顺手——把一条查资料的链接排在红色「重新开始」下面很怪。
                用 <Link>+paperworkHref()（带粘性 query），裸 href 会丢 `?v=2` 掉回 v01。 */}
            <div className="lite-settings-row lite-settings-row--paperwork">
              <span className="lite-settings-row-label">{t.lite2.settingsPaperworkLabel}</span>
              <Link
                className="lite-settings-paperwork-link"
                to={paperworkHref()}
                onClick={closeSettings}
              >
                {t.lite2.settingsPaperworkLink}
              </Link>
            </div>
            {/* files-hub-0729/01 ·「完整版预告」（vision）从 tab 降进设置菜单，照
                `/paperwork` 那一行的样式与写法。插在 paperwork 之后、「重新开始」之前，
                理由与 paperwork 那条完全相同：verify-switchers / verify-auth-form 按
                `.nth(0/1)` 索引语言与观感两行，往它们**之后**插不动那两个索引；而
                「重新开始」靠 `.lite-settings-restart` 类名找、不吃 nth，往后推一位安全。
                🔴 用 <Link>+visionHref()（带粘性 query）。vision 的路由与页面一个字没改，
                变的只是入口在哪。 */}
            <div className="lite-settings-row lite-settings-row--vision">
              <span className="lite-settings-row-label">{t.lite2.settingsVisionLabel}</span>
              <Link
                className="lite-settings-vision-link"
                to={visionHref()}
                onClick={closeSettings}
              >
                {t.lite2.settingsVisionLink}
              </Link>
            </div>
            {/* rich-align-0722/09 · 「重新开始」：清 lite2:* 全量（含语言/观感）+ 忘光
                owner_token + 回 onboarding 闸门。误触保护=两击确认。🔴 单动作按钮（非 nth 开关组），
                不动上面 lang/look 两行的顺序/嵌套（verify-switchers/auth-form 按 .nth(0/1) 索引它们）。 */}
            <div className="lite-settings-row lite-settings-row--restart">
              <button
                type="button"
                className="lite-btn lite-btn--danger lite-settings-restart"
                data-confirm={confirmRestart ? '1' : undefined}
                aria-label={t.lite2.restartAria}
                onClick={() => {
                  if (confirmRestart) {
                    restartAll()
                    closeSettings()
                  } else {
                    setConfirmRestart(true)
                  }
                }}
              >
                {confirmRestart ? t.lite2.restartConfirm : t.lite2.restartAction}
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {/* feat-034 polish：Story/Live 开关默认不渲染（?modeSwitch=1 显示，shared/mode.ts
          小工具——lite 只 import shared，墙不破）。缺席时整块不出 DOM，布局无空洞。 */}
      {showModeSwitch() ? (
        <div className="mode-switch" role="group" aria-label={t.mode.switchAria}>
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
