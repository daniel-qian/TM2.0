import { useMemo, useState, type FormEvent } from 'react'
import { useLite } from '../store'
import type { PersonAddInput } from '../transport'
import { useFlow, selectTriagePending, selectTriageHandled, selectTriageSetAside } from '../flowStore'
import { draftFromHandoff } from '../draftLinks'
import { useDraft } from '../draftStore'
import { useDict } from '../../shared/i18n/useDict'
import { localizeBriefing, briefingRiskCount } from '../../shared/briefing'
import {
  localizeHandoff,
  localizePersonRead,
  type HandoffDisplay,
} from '../../shared/handoffCopy'
import { projectStatusText } from '../../shared/projectStatus'
import { UploadPanel } from '../UploadPanel'
import { InitialAvatar } from '../InitialAvatar'
import { LiteComposer } from '../LiteComposer'
import {
  deriveGroupFacets,
  deriveMoodFacets,
  filterDirectory,
  GROUP_ALL,
  GROUP_UNGROUPED,
  MOOD_ALL,
} from '../teamDirectory'
import type { LiteHandoff, LitePerson } from '../teamData'

// feat-024 · lite 屏 1+2：上传空态 · Your team——ADR-0022 决策 1。
// 空态：左脊柱是 live 自己的引导文案（不渲染任何 scripted 占位——story 渗漏的第一现场）；
// 右栏 = 上传。上传后：briefing 真数顶栏（人数/项目数来自 ingestion，聚合数字 R2 真算才显）
// + 人卡/项目卡双轨 + 晨间分诊区（feat-036，PRD F2 / ADR-0017 原判执行）。
// 🔴 红线：人卡永不渲染任何数字——LitePerson 类型层就没有评分键的位置。
//
// feat-036 · 晨间分诊三动作（ADR-0017 决策 5）：分诊条目本身仍是 teamData.ts liveHandoffs()
// 的真派生（handoffs ← 项目 blockers，零捏造）；这里只加真接线的三动作 + "今天已照料"堆：
//   done → 收进堆、pending 计数安静更新；discard → 直接消失（同样收进堆，标"搁置"）；
//   带进议事室 → composer 预填该条目上下文，切到 The room（不自动提交——人审过再问）。
// marks 态与 Follow-ups 一样走 flowStore 的 localStorage（key 带 lite2 前缀）。

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

// 进度条分档与 story 地图页同口径（<40 低 · 40–69 中 · ≥70 高），复用 strip-* 配色类。
function progressBand(progress: number) {
  if (progress < 40) return 'strip-low'
  if (progress < 70) return 'strip-mid'
  return 'strip-high'
}

// 🔴 判据吃 `statusRaw`（文档自述原值，缺失即 undefined），不吃 `project.status`——
// 后者是 teamData.ts 里的**渲染文案**（07-19 起缺失时已经是本地化的兜底句，不再是
// `'on-track'`，但依然不是判据；同一枚字段既装文案又被这里当字面量比对，是这个
// 文件本来在犯的"一层之下"那个错：文案永远比不出 'blocked'/'at-risk'，于是缺状态
// 的项目卡拿到的 tone 和真·on-track 一样——都是空串，圆点一样绿）。
function statusTone(statusRaw: string | undefined) {
  if (statusRaw === 'blocked') return 'tone-danger'
  if (statusRaw === 'at-risk') return 'tone-warning'
  // 空/undefined = 文档没读到状态——给中性灰，别落回默认的 sage/绿（那看起来像「没事」）。
  if (!statusRaw) return 'tone-unknown'
  return ''
}

// edge 左缘只染「需要经理出手」的两档——on-track/done/未知一律不上色（同 ProjectsScreen
// / lite-project-card 那套既有口径）。与 statusTone 分开算，避免 tone-unknown 顺带
// 把 `edge-${statusRaw}` 拼出一个空后缀的垃圾类名。
function statusEdgeClass(statusRaw: string | undefined): string | null {
  if (statusRaw === 'blocked') return 'edge-blocked'
  if (statusRaw === 'at-risk') return 'edge-at-risk'
  return null
}

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

// rich-align-0722/03 · 自述出处 → 展示用文档名（剥掉 `:行号` 尾缀）。
function docFromSource(source: string): string {
  return source.replace(/:\d+$/, '')
}

// rich-align-0722/03 · 情绪定性枚举 → 当前字典的词。other 走文档原词 valueRaw（不替客户改写）。
function moodLabel(
  mood: NonNullable<NonNullable<LitePerson['selfReport']>['mood']>,
  t: ReturnType<typeof useDict>['t'],
): string {
  switch (mood.value) {
    case 'steady':
      return t.lite2.selfReportMoodSteady
    case 'stretched':
      return t.lite2.selfReportMoodStretched
    case 'strained':
      return t.lite2.selfReportMoodStrained
    default:
      return mood.valueRaw?.trim() || t.lite2.selfReportMoodOther
  }
}

// rich-align-0722/03 · 本人自述负载/情绪。🔴 双世界执法的可见端：只在开关开、后端投影了 self_report
// 时才渲染（selfReport 缺席即整段收起，绝不显 0/空）。**每一处出现数字或情绪词的元素都带
// data-metric-source 锚点**（AFK 门据此判定：锚点外出现血条/情绪词=红），并挂系统自证式出处角标
// 「《X》记录的本人自述」——不直接断言"本人自述"（作者身份系统验不了），只归因到文档。
function SelfReportRow({
  report,
  t,
}: {
  report: NonNullable<LitePerson['selfReport']>
  t: ReturnType<typeof useDict>['t']
}) {
  const { load, mood } = report
  if (!load && !mood) return null
  return (
    <p className="home-person-selfreport">
      {load ? (
        <span
          className="lite-selfreport lite-selfreport--load"
          data-metric-source={load.source}
          data-metric-caliber={load.caliber}
          title={fill(t.lite2.selfReportProvenance, { source: docFromSource(load.source) })}
        >
          <span className="lite-selfreport-label">{t.lite2.selfReportLoadLabel}</span>
          <span className="lite-selfreport-value">{load.value}%</span>
        </span>
      ) : null}
      {mood ? (
        <span
          className="lite-selfreport lite-selfreport--mood"
          data-metric-source={mood.source}
          data-metric-caliber={mood.caliber}
          title={fill(t.lite2.selfReportProvenance, { source: docFromSource(mood.source) })}
        >
          <span className="lite-selfreport-label">{t.lite2.selfReportMoodLabel}</span>
          <span className="lite-selfreport-value">{moodLabel(mood, t)}</span>
        </span>
      ) : null}
    </p>
  )
}

// 单张人卡（分组视图与兜底 flat 视图共用）。🔴 红线：定性为主；唯一的数字面是本人自述负载/情绪，
// 且只在开关开时由后端投影、由 SelfReportRow 带出处渲染（见其注释）。
function PersonCard({
  person,
  onOpen,
}: {
  person: LitePerson
  onOpen: (id: string) => void
}) {
  const { t } = useDict()
  // feat-068 · 读数在这里才成句（派生层只给语料原文 + owns 条目）。localizePersonRead 恒返回
  // 非空串——无信号时走 personReadNone 兜底，所以不再需要 person.read 的空值分支。
  const read = localizePersonRead(person, t.lite2)
  return (
    <button
      type="button"
      className={classNames(['home-person-card', `home-tone-${person.tone}`])}
      onClick={() => onOpen(person.id)}
      // feat-068 · aria-label 以前是 `Open ${name}` 的硬编码拼接——中文屏幕阅读器会念出英文
      // 动词。整句模板 + 占位符，语序交给各语言自己定。
      aria-label={fill(t.lite2.personCardOpenAria, { name: person.name, read })}
    >
      <InitialAvatar name={person.name} size={44} className="home-person-avatar" />
      <span className="home-person-body">
        <h3>{person.name}</h3>
        <p className="home-person-role">{person.role}</p>
        <p className="home-person-read">{read}</p>
        {/* rich-align-0722/03：本人自述负载/情绪。缺席（含开关关）即不渲染——人卡回到零数字。 */}
        {person.selfReport ? <SelfReportRow report={person.selfReport} t={t} /> : null}
      </span>
    </button>
  )
}

// rich-align-0722/04 · team 屏目录形态（有数据分支）。她方通讯录形态：筛选 chip 行（组别恒在；
// 情绪仅开关开时渲染，挂「按本人自述筛选」口径角标）+ 3 列成员卡网格。
// 🔴 裁决（PRD C 节 / ADR-0023）：chip 是**筛选**不是**横向比较**——不排序、不计分。
//   · 组别 chip 可带 count 徽章；情绪 chip **不带**任何 count（跨人计数=分数并列，裁决禁）。
//   · 情绪 chip 行仅在 scoringEnabled 且有人报了 mood 时渲染——开关关整行不出现，
//     情绪词表词（如常/偏紧/吃紧）因此在关世界零出现（人卡的 SelfReportRow 也已被剥离层收起）。
//   · 上传部件在两分支都渲染（降位不卸载）——AFK 上传相位与 skin probe 依赖 .upload-panel。
// 成员卡 .home-person-card DOM 锚点零改（门相位 C/E 不受影响）；网格保留 .home-lane-people 类
// （AFK skin probe 轮询 `.upload-panel || .home-lane-people`）。
function moodChipLabel(key: string, t: ReturnType<typeof useDict>['t']): string {
  switch (key) {
    case 'steady':
      return t.lite2.selfReportMoodSteady
    case 'stretched':
      return t.lite2.selfReportMoodStretched
    case 'strained':
      return t.lite2.selfReportMoodStrained
    default:
      return t.lite2.selfReportMoodOther
  }
}

function TeamDirectory({
  people,
  scoringEnabled,
  onOpen,
}: {
  people: LitePerson[]
  scoringEnabled: boolean
  onOpen: (id: string) => void
}) {
  const { t } = useDict()
  const [groupFilter, setGroupFilter] = useState<string>(GROUP_ALL)
  const [moodFilter, setMoodFilter] = useState<string>(MOOD_ALL)

  const groupFacets = useMemo(() => deriveGroupFacets(people), [people])
  const moodFacets = useMemo(
    () => deriveMoodFacets(people, scoringEnabled),
    [people, scoringEnabled],
  )

  // 开关关掉 / 名册变化后失效的筛选值兜底回「全部」（不 setState，纯渲染期收敛——避免开关关时
  // 残留的 mood 筛选把网格清空、也避免情绪词表词经由残留态漏进关世界）。
  const effGroupFilter = groupFacets.some((f) => f.key === groupFilter) ? groupFilter : GROUP_ALL
  const effMoodFilter =
    moodFacets.length > 0 && moodFacets.some((f) => f.key === moodFilter) ? moodFilter : MOOD_ALL

  const filtered = useMemo(
    () => filterDirectory(people, effGroupFilter, effMoodFilter),
    [people, effGroupFilter, effMoodFilter],
  )

  function groupChipLabel(key: string): string {
    if (key === GROUP_ALL) return t.lite2.directoryGroupAllLabel
    if (key === GROUP_UNGROUPED) return t.lite2.directoryUngroupedLabel
    return key // 部门原文，不翻译
  }

  return (
    <div className="lite-team-directory-wrap">
      <div
        className="lite-team-filter-row"
        role="group"
        aria-label={t.lite2.peopleLane}
      >
        {groupFacets.map((f) => (
          <button
            key={f.key}
            type="button"
            className={classNames([
              'lite-team-filter-chip',
              f.key === GROUP_ALL && 'is-all',
            ])}
            aria-pressed={effGroupFilter === f.key}
            aria-label={
              f.key === GROUP_ALL
                ? t.lite2.directoryGroupAllAria
                : fill(t.lite2.directoryGroupFilterAria, { group: groupChipLabel(f.key) })
            }
            onClick={() => setGroupFilter(f.key)}
          >
            <span className="lite-team-filter-chip-label">{groupChipLabel(f.key)}</span>
            {/* 组别 count 徽章合法（组内计数≠跨人分数并列）。 */}
            <span className="lite-team-filter-chip-count" aria-hidden="true">
              {f.count}
            </span>
          </button>
        ))}
      </div>

      {/* 情绪 chip 行——仅开关开且有人自述 mood 时渲染，挂系统自证式口径角标。 */}
      {moodFacets.length > 0 ? (
        <div className="lite-team-mood-block">
          <p className="lite-badge lite-team-mood-caption">{t.lite2.directoryMoodFilterCaption}</p>
          <div
            className="lite-team-filter-row lite-team-filter-row--mood"
            role="group"
            aria-label={t.lite2.directoryMoodRowLabel}
          >
            {moodFacets.map((f) => (
              <button
                key={f.key}
                type="button"
                className={classNames([
                  'lite-team-filter-chip',
                  'lite-team-filter-chip--mood',
                  f.key === MOOD_ALL && 'is-all',
                ])}
                aria-pressed={effMoodFilter === f.key}
                aria-label={
                  f.key === MOOD_ALL
                    ? t.lite2.directoryMoodAllAria
                    : fill(t.lite2.directoryMoodFilterAria, {
                        mood: moodChipLabel(f.key, t),
                      })
                }
                onClick={() => setMoodFilter(f.key)}
              >
                <span className="lite-team-filter-chip-label">
                  {f.key === MOOD_ALL ? t.lite2.directoryMoodAllLabel : moodChipLabel(f.key, t)}
                </span>
                {/* 🔴 情绪 chip 无 count 徽章（跨人情绪计数=分数并列，裁决禁）。 */}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {filtered.length > 0 ? (
        <div
          className="home-lane home-lane-people lite-team-directory"
          aria-label={t.lite2.peopleLane}
        >
          {filtered.map((person) => (
            <PersonCard key={person.id} person={person} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <p className="lite-team-directory-empty">{t.lite2.directoryEmptyFiltered}</p>
      )}
    </div>
  )
}

export function TeamScreen() {
  const { t, locale } = useDict()
  const team = useLite((s) => s.team)
  const openDetail = useLite((s) => s.openDetail)
  const goScreen = useLite((s) => s.goScreen)
  // feat-050 · 会话不丢：空态下要分清"正在取回上次会话"和"真没有会话"。
  const restoring = useLite((s) => s.restoring)
  const restoreError = useLite((s) => s.restoreError)
  const restoreSession = useLite((s) => s.restoreSession)
  // rich-align-0722/06 · 人员手编 CRUD：有 context 才出「添加成员」入口（无 context=首访没上传→不出假按钮）。
  const contextId = useLite((s) => s.contextId)
  const resetProjectWrite = useLite((s) => s.resetProjectWrite)
  const [showAddPerson, setShowAddPerson] = useState(false)

  const triageMarks = useFlow((s) => s.triageMarks)
  const markTriageDone = useFlow((s) => s.markTriageDone)
  const discardTriage = useFlow((s) => s.discardTriage)
  const restoreTriage = useFlow((s) => s.restoreTriage)
  const addFollowup = useFlow((s) => s.addFollowup)
  const setComposerDraft = useFlow((s) => s.setComposerDraft)
  // feat-058 · 应用内草稿框（弹层本体常驻挂在壳层 Lite2App，这里只负责开框）。
  const openDraft = useDraft((s) => s.openDraft)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [addedFollowupIds, setAddedFollowupIds] = useState<ReadonlySet<string>>(new Set())

  // feat-068 · 分诊条目的文案层（ZH-02）。teamData.ts 的 liveHandoffs() 现在只吐结构化信号，
  // 成句在这里按当前字典拼——详见 src/shared/handoffCopy.ts 顶部。
  // 三条 list 都要过这一层：pending 渲染卡片，handled/setAside 进"今天已照料"抽屉，抽屉里
  // 同样显示 action 文案（漏掉任何一条，中文页就会在那一处露出英文）。
  const localize = useMemo(() => (h: LiteHandoff) => localizeHandoff(h, t.lite2), [t])
  const pending = useMemo(
    () => selectTriagePending(team, triageMarks).map(localize),
    [team, triageMarks, localize],
  )
  const handled = useMemo(
    () => selectTriageHandled(team, triageMarks).map(localize),
    [team, triageMarks, localize],
  )
  const setAside = useMemo(
    () => selectTriageSetAside(team, triageMarks).map(localize),
    [team, triageMarks, localize],
  )
  const totalHandoffs = team?.handoffs.length ?? 0

  // feat-068 · 后端 briefing() 只会说英文（registry.py 里三处字面量写死，无 locale 参数，
  // 线上镜像不许重建）。中文构建下在这里本地重组；EN 下原样透传，视觉零变化。
  // 详见 src/shared/briefing.ts 顶部——请不要"顺手"把这层删掉。
  const briefing = useMemo(
    () => (team ? localizeBriefing(team.briefing, team, t.lite2, locale) : null),
    [team, t, locale],
  )

  // feat-068 · 入参从 LiteHandoff 换成 HandoffDisplay：composer 预填 / 跟进标题 / mailto 正文
  // 用的都是**已本地化**的 action + evidence（原来它们直接吃派生层的英文串）。
  function handleTakeToRoom(handoff: HandoffDisplay) {
    // 分隔符用 " — " 而非换行：composer 是 <input type="text">，换行被剥掉后两段文字会
    // 连成一坨不可读（feat-044 对抗验证发现的同根 bug，与 CloserLookScreen 的 ask 预填
    // 一并修，见该处注释）。
    setComposerDraft(`${handoff.action} — ${handoff.evidence}`)
    goScreen('room')
  }

  function handleAddFollowup(handoff: HandoffDisplay) {
    addFollowup({ title: handoff.action, source: 'triage', dueGroup: 'today', note: handoff.evidence })
    setAddedFollowupIds((prev) => {
      const next = new Set(prev)
      next.add(handoff.id)
      return next
    })
  }

  return (
    <section className="scene scene-home is-active" aria-label={t.lite2.teamLiveAria}>
      <div className="home-scroll">
        <div className="home-frame">
          {/* ── 左脊柱 ─────────────────────────────────────────────── */}
          <div className="home-spine">
            {team && briefing ? (
              <>
                <header className="home-greeting">
                  <p className="eyebrow">{t.lite2.briefingEyebrow}</p>
                  <h1>{briefing.headline}</h1>
                  <p className="home-greeting-sub">{briefing.subhead}</p>
                  {briefing.metrics.length > 0 ? (
                    <div className="lite-metrics" aria-label={t.lite2.metricsLabel}>
                      {briefing.metrics.map((m) => (
                        <span key={m.label} className="lite-metric-chip">
                          <strong>{m.value}</strong> {m.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </header>

                <div className="home-spine-head">
                  <h2>{t.lite2.handoffsTitle}</h2>
                  {totalHandoffs > 0 && pending.length > 0 ? (
                    <p className="home-count" aria-live="polite">
                      {fill(t.lite2.triageRemaining, { pending: pending.length, total: totalHandoffs })}
                    </p>
                  ) : null}
                </div>

                {pending.length > 0 ? (
                  <ol className="home-handoff-list">
                    {pending.map((handoff) => (
                      <li
                        key={handoff.id}
                        className={classNames(['home-handoff', `home-tone-${handoff.tone}`])}
                      >
                        <button
                          type="button"
                          className="home-check"
                          aria-label={fill(t.lite2.triageDoneAria, { action: handoff.action })}
                          onClick={() => markTriageDone(handoff.id)}
                        >
                          <span className="lite-triage-checkmark" aria-hidden="true">
                            ✓
                          </span>
                        </button>
                        <div className="home-handoff-body">
                          {/* feat-068 · is-cjk：基线样式给这行加了 text-transform:uppercase +
                              0.14em 字距（英文小标签的排版语言）。中文没有大小写，宽字距只会
                              读成"喊话"，所以中文构建下关掉大写、收紧字距。 */}
                          <span
                            className={classNames([
                              'lite-badge',
                              'home-handoff-tone',
                              locale === 'zh' && 'is-cjk',
                            ])}
                          >
                            {handoff.toneLabel}
                          </span>
                          <h3>{handoff.action}</h3>
                          <p>{handoff.evidence}</p>
                          <div className="home-handoff-links">
                            <button
                              type="button"
                              className="home-map-card-link"
                              onClick={() => openDetail('project', handoff.projectIds[0])}
                            >
                              {t.lite2.handoffOpen} →
                            </button>
                            <button
                              type="button"
                              className="lite-btn lite-btn--ghost lite-triage-room"
                              onClick={() => handleTakeToRoom(handoff)}
                            >
                              {t.lite2.triageTakeToRoomLabel} ↗
                            </button>
                            <button
                              type="button"
                              className="lite-btn lite-btn--soft lite-triage-addfollowup"
                              disabled={addedFollowupIds.has(handoff.id)}
                              onClick={() => handleAddFollowup(handoff)}
                            >
                              {addedFollowupIds.has(handoff.id)
                                ? t.lite2.followupAdded
                                : t.lite2.triageAddFollowupLabel}
                            </button>
                            {/* feat-058：这里曾是一条裸 mailto: 链接（点一下人就被甩进系统
                                邮件客户端，草稿正文根本没露过面）。现在开应用内草稿框。 */}
                            <button
                              type="button"
                              className="lite-btn lite-btn--ghost lite-triage-draftmail"
                              onClick={() => openDraft(draftFromHandoff(handoff, team))}
                            >
                              {t.lite2.triageDraftMailLabel}
                            </button>
                            <button
                              type="button"
                              className="lite-btn lite-btn--ghost home-discard"
                              onClick={() => discardTriage(handoff.id)}
                            >
                              {t.lite2.triageDiscardLabel}
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="lite-handoffs-empty">
                    {totalHandoffs > 0
                      ? t.lite2.triageAllDone
                      : briefingRiskCount(team?.briefing) > 0
                        ? fill(t.lite2.handoffsEmptyButLook, { count: briefingRiskCount(team.briefing) })
                        : t.lite2.handoffsEmpty}
                  </p>
                )}

                {handled.length + setAside.length > 0 ? (
                  <section className="home-drawer">
                    <button
                      type="button"
                      className="home-drawer-toggle"
                      aria-expanded={drawerOpen}
                      onClick={() => setDrawerOpen((open) => !open)}
                    >
                      {t.lite2.triageDrawerLabel} · {handled.length}
                      {setAside.length > 0 ? ` · ${setAside.length} ${t.lite2.triageSetAsideLabel}` : ''}
                      <span aria-hidden="true">{drawerOpen ? '▴' : '▾'}</span>
                    </button>
                    {drawerOpen ? (
                      <ul className="home-drawer-list">
                        {handled.map((handoff) => (
                          <li key={handoff.id}>
                            <span className="home-drawer-item">{handoff.action}</span>
                            <button type="button" className="lite-btn lite-btn--ghost" onClick={() => restoreTriage(handoff.id)}>
                              {t.lite2.triageRestoreLabel}
                            </button>
                          </li>
                        ))}
                        {setAside.map((handoff) => (
                          <li key={handoff.id} className="is-set-aside">
                            <span className="home-drawer-item">{handoff.action}</span>
                            <button type="button" className="lite-btn lite-btn--ghost" onClick={() => restoreTriage(handoff.id)}>
                              {t.lite2.triageRestoreLabel}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                ) : null}
              </>
            ) : (
              /* ── 上传空态：live 自己的引导文案，零 scripted 占位 ── */
              <header className="home-greeting lite-empty-greeting">
                <p className="eyebrow">{t.lite2.emptyEyebrow}</p>
                <h1>{t.team.emptyTitle}</h1>
                <p className="home-greeting-sub">{t.team.emptyBody}</p>
                {/* feat-050 · 会话不丢：有存下的 contextId 时，先说"正在取回"，别让人对着
                    上传引导以为数据没了。取不回来（且非 404）就一行说明 + 重试，不堆红字；
                    404 走干净空态（下面的默认分支）——context 真没了，上传引导就是诚实答案。 */}
                {restoring ? (
                  <p className="lite-empty-restoring" aria-live="polite">
                    {t.lite2.restoringLabel}
                  </p>
                ) : restoreError ? (
                  <div className="lite-empty-restore-failed" aria-live="polite">
                    <p className="lite-empty-restore-note">{t.lite2.restoreFailed}</p>
                    <p className="lite-empty-restore-detail">{restoreError}</p>
                    <button
                      type="button"
                      className="lite-btn lite-btn--ghost lite-empty-restore-retry"
                      onClick={() => void restoreSession()}
                    >
                      {t.lite2.restoreRetry}
                    </button>
                  </div>
                ) : (
                  <ul className="lite-empty-hints">
                    <li>{t.lite2.emptyHintRoster}</li>
                    <li>{t.lite2.emptyHintProject}</li>
                    <li>{t.lite2.emptyHintPrivacy}</li>
                  </ul>
                )}
              </header>
            )}
          </div>

          {/* ── 右栏：空态 = 上传；上传后 = 双轨卡带（上传入口保留可加文件）── */}
          {team ? (
            <div className="home-lanes">
              <UploadPanel />
              <div className="home-lanes-head lite-team-head-row">
                <p className="eyebrow">{t.lite2.peopleLane}</p>
                {/* rich-align-0722/06：目录页头右端 primary「添加成员」→ 内联表单。只在有 context 时出。 */}
                {contextId ? (
                  <button
                    type="button"
                    className="lite-btn lite-btn--primary lite-people-add"
                    onClick={() => {
                      resetProjectWrite()
                      setShowAddPerson((v) => !v)
                    }}
                    aria-expanded={showAddPerson}
                  >
                    {t.lite2.peopleAddCta}
                  </button>
                ) : null}
              </div>
              {/* 内联添加成员表单（定性字段；🔴 无人身数字位——人身数字禁经手编通道，后端 422）。 */}
              {showAddPerson && contextId ? (
                <AddPersonForm onDone={() => setShowAddPerson(false)} />
              ) : null}
              {/* rich-align-0722/04：目录形态（筛选 chip 行 + 3 列成员卡网格）取代原 feat-025 分组视图。
                  人卡 .home-person-card 零改（门相位 C/E 不受影响）；网格保留 .home-lane-people 类。 */}
              <TeamDirectory
                people={team.people}
                scoringEnabled={team.scoringEnabled}
                onOpen={(id) => openDetail('person', id)}
              />

              {/* rich-align-0722/06：停用（软删）折叠区——目录网格之后。有停用成员才出；灰化卡 + 恢复键。 */}
              {team.archivedPeople.length > 0 ? (
                <ArchivedPeopleDrawer people={team.archivedPeople} />
              ) : null}

              <p className="eyebrow home-lane-label">{t.lite2.projectLane}</p>
              <div className="home-lane home-lane-projects" aria-label={t.lite2.projectLane}>
                {team.projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className={classNames([
                      'home-project-card',
                      statusEdgeClass(project.statusRaw),
                    ])}
                    onClick={() => openDetail('project', project.id)}
                    aria-label={fill(t.lite2.projectsOpenAria, { title: project.title })}
                  >
                    <span className="home-project-row">
                      <h3>{project.title}</h3>
                      <span className="home-project-status">
                        <span className={`status-dot ${statusTone(project.statusRaw)}`} />
                        {projectStatusText(project.statusRaw, t.lite2)}
                      </span>
                    </span>
                    {typeof project.progress === 'number' ? (
                      <span className="home-project-strip-row" aria-hidden="true">
                        <span className={`project-strip ${progressBand(project.progress)}`}>
                          <span
                            className="project-strip-fill"
                            style={{ width: `${project.progress}%` }}
                          />
                        </span>
                      </span>
                    ) : null}
                    <span className="home-project-meta">
                      {/* 兜底在渲染层（Blockers 5c）：派生层只给原值或空串，这一句跟着当前
                          字典走，切语言立刻变——与详情浮层同一口径，同一事实不出现两种说法。 */}
                      <span>{project.ownerName || t.lite2.projectsUnknownValue}</span>
                      {project.dueDate ? <span className="home-project-due">{project.dueDate}</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="home-lanes home-lanes-live-empty">
              <UploadPanel />
            </div>
          )}
        </div>
      </div>

      <LiteComposer />
    </section>
  )
}

// rich-align-0722/06 · 目录页头内联「添加成员」表单。**只有定性字段**（姓名/职位/组别/司龄/负责）——
// 🔴 人身数字（负载/情绪/自述）无输入位，后端 PersonIn extra=forbid + 值扫描双守（手填即 422）。
// 复用项目表单的 .lite-project-form 样式族。姓名必填，其余不填即不发键（absent≠none）。
function AddPersonForm({ onDone }: { onDone: () => void }) {
  const { t } = useDict()
  const l = t.lite2
  const addPerson = useLite((s) => s.addPerson)
  const busy = useLite((s) => s.projectWriteBusy)
  const error = useLite((s) => s.projectWriteError)

  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [teamName, setTeamName] = useState('')
  const [tenure, setTenure] = useState('')
  const [owns, setOwns] = useState('')

  const canSubmit = name.trim().length > 0 && !busy

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    const input: PersonAddInput = { name: name.trim() }
    if (role.trim()) input.role = role.trim()
    if (teamName.trim()) input.team = teamName.trim()
    if (tenure.trim()) input.tenure = tenure.trim()
    const ownsList = owns.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
    if (ownsList.length) input.owns = ownsList
    const ok = await addPerson(input)
    if (ok) onDone()
  }

  return (
    <form className="lite-project-form lite-people-form" onSubmit={submit} aria-label={l.peopleAddFormAria}>
      <div className="lite-project-form-grid">
        <label className="lite-project-form-field">
          <span className="lite-project-form-label">{l.peopleFieldName}</span>
          <input className="lite-project-form-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label={l.peopleFieldName} required />
        </label>
        <label className="lite-project-form-field">
          <span className="lite-project-form-label">{l.peopleFieldRole}</span>
          <input className="lite-project-form-input" value={role} onChange={(e) => setRole(e.target.value)} maxLength={120} aria-label={l.peopleFieldRole} />
        </label>
        <label className="lite-project-form-field">
          <span className="lite-project-form-label">{l.peopleFieldTeam}</span>
          <input className="lite-project-form-input" value={teamName} onChange={(e) => setTeamName(e.target.value)} maxLength={120} aria-label={l.peopleFieldTeam} />
        </label>
        <label className="lite-project-form-field">
          <span className="lite-project-form-label">{l.detailTenure}</span>
          <input className="lite-project-form-input" value={tenure} onChange={(e) => setTenure(e.target.value)} maxLength={120} aria-label={l.detailTenure} />
        </label>
        <label className="lite-project-form-field lite-project-form-field--wide">
          <span className="lite-project-form-label">{l.detailOwns}</span>
          <input className="lite-project-form-input" value={owns} onChange={(e) => setOwns(e.target.value)} maxLength={400} placeholder={l.peopleOwnsHint} aria-label={l.detailOwns} />
        </label>
      </div>
      {error ? (
        <p className="lite-project-form-error" aria-live="polite">
          {l.projectsWriteFailed}
          {'：'}
          {error}
        </p>
      ) : null}
      <div className="lite-project-form-actions">
        <button type="submit" className="lite-btn lite-btn--primary" disabled={!canSubmit}>
          {l.peopleAddSubmit}
        </button>
        <button type="button" className="lite-btn lite-btn--ghost" onClick={onDone} disabled={busy}>
          {l.detailCancel}
        </button>
      </div>
    </form>
  )
}

// rich-align-0722/06 · 停用（软删）折叠区。默认折起（「已停用 N」按钮），展开见灰化人卡 + 恢复文字键。
// 🔴 灰化卡是 div（不开详情浮层）——避免嵌套交互；恢复走卡内独立 ghost 文字键。零数字（灰化卡也守红线）。
function ArchivedPeopleDrawer({ people }: { people: LitePerson[] }) {
  const { t } = useDict()
  const l = t.lite2
  const restorePerson = useLite((s) => s.restorePerson)
  const busy = useLite((s) => s.projectWriteBusy)
  const [open, setOpen] = useState(false)

  return (
    <section className="lite-projects-archived lite-people-archived" aria-label={l.peopleArchivedAria}>
      <button
        type="button"
        className="lite-btn lite-btn--ghost lite-projects-archived-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {fill(l.peopleArchivedTitle, { count: people.length })}
      </button>
      {open ? (
        <div className="lite-projects-archived-grid lite-people-archived-grid">
          {people.map((person) => (
            <div key={person.id} className="home-person-card is-archived lite-people-archived-card" data-person-id={person.id}>
              <InitialAvatar name={person.name} size={40} className="home-person-avatar" />
              <span className="home-person-body">
                <h3>{person.name}</h3>
                {person.role ? <p className="home-person-role">{person.role}</p> : null}
              </span>
              <button
                type="button"
                className="lite-btn lite-btn--ghost lite-project-restore"
                onClick={() => void restorePerson(person.id)}
                disabled={busy}
              >
                {l.projectsArchivedRestore}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
