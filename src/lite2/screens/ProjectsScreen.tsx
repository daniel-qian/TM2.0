import { useMemo, useState, type FormEvent } from 'react'
import { useLite } from '../store'
import { useFlow } from '../flowStore'
import { useDict } from '../../shared/i18n/useDict'
import {
  buildProjectViews,
  groupProjects,
  projectAskPrefill,
  projectCoverage,
  projectRiskLabel,
  projectStatusLabel,
  projectStatusTone,
  type ProjectGroupKey,
  type ProjectStatusKey,
  type ProjectView,
} from '../projectView'
import type { Dict } from '../../shared/i18n'
import type { ProjectAddInput } from '../transport'
// #67 · 卡面「去问 Avery」带项目引用——构造走 refOfProject（与 @ 弹层候选同一把尺）。
import { refOfProject } from '../askRefs'

// rich-align-0722/05a：某卡是否含手编字段（origin==='manual'）——卡面挂一枚「手动编辑」小角标。
// 逐字段出处在详情浮层（DetailOverlay）逐行标；卡面只给一个「这张卡有人手动改过」的整体提示。
function cardHasManual(view: ProjectView): boolean {
  return Object.values(view.provenance).some((p) => p.origin === 'manual')
}

// #48 · 预填文本 projectAskPrefill 收在 projectView.ts（项目屏卡面与详情浮层共用一份）。

// feat-055（PRD G9）· lite2 屏 8：项目屏（整屏新建）。
//
// ## 为什么有这一屏
// 差异清单里最大的结构缺口——我们根本没有项目屏，真项目只能混在「你的团队」右栏当卡片。
// 三家外部公司会拿自己的项目文档来试，看不到项目屏说不过去。
//
// ## 🔴 本屏的核心不是布局，是「未知」态
// 真 payload 的覆盖率：title/summary 17/17 · owner 16/17 · status/blockers 13/17 ·
// **dueDate 7/17 · progress 6/17**。进度和到期只有三分之一有值。任何把缺失渲染成 `0%`、
// 空进度条或空白格的写法，都是在替客户的文档说「这事没进展」——当着他自己的文件的面撒谎。
// 所以：进度未知时**根本不画条**（不是画一条 0 宽的），到期/负责人/状态未知时显式写出
// 「文档未提及」。判据全在 `projectView.ts`（那里也解释了为什么读 rawTeam 而不是 team）。
//
// ## 布局为什么不是固定看板栏
// 离线 heuristic 抽取路径目前每篇文档只吐 1 个项目（`_projects_from_doc` 的结构性缺陷，
// 与 H4 同源，feat-054 的粒度门只覆盖 LLM 路径），所以「只有 1 个项目」甚至「0 个项目」
// 是**必然会被真实用户撞到的常态**，不是边角情况。固定三栏看板在 1 个项目时会剩两条空栏
// （看着像坏了），所以这里用「非空分组 + 自适应卡片网格」：一个项目就是一组一张卡，
// 零个项目走诚实空态。🔴 绝不画假的骨架卡撑版面。
//
// 不做（PRD G9 明确）：里程碑、成员历史时间线——我们没有这两样数据。
// 🔴 零写死数据：屏头那几个数字（项目总数、多少个没写进度/到期/状态）全是当场真算的。

type Lite2Dict = Dict['lite2']

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

// 状态语气色。沿用既有 tone-* / edge-* 语法（与「你的团队」项目卡同一套族色）。
// 🔴 「文档没写状态」永远是中性的——不给它染成绿色（那是在替文档说"没事"）。
// team-map-revival-0804（B1）：本函数原样提进 `projectView.ts` 并导出——地图页的项目条要
// 用同一套语气色，而它手上只有 `LiteProject.statusRaw` 没有 `ProjectView`。判断逻辑一字未改，
// 提上去只是为了不让同一个状态在两块屏上有两个颜色（PRD §3.4「单一尺子」）。
const statusTone = projectStatusTone

// edge 左缘只染「需要经理出手」的两档——on-track/done/未知一律不上色。单独算，
// 不与 statusTone 共用同一个真值判断：unknown 现在也有非空 tone，不能再用
// `tone && edge-${statusKey}` 这种耦合写法，否则会顺带画出一条 `edge-unknown` 边。
function statusEdgeClass(statusKey: ProjectStatusKey): string | null {
  if (statusKey === 'blocked') return 'edge-blocked'
  if (statusKey === 'at-risk') return 'edge-at-risk'
  return null
}

function groupLabel(key: ProjectGroupKey, l: Lite2Dict): string {
  switch (key) {
    case 'needsYou':
      return l.projectsGroupNeedsYou
    case 'moving':
      return l.projectsGroupMoving
    case 'done':
      return l.projectsGroupDone
    case 'unknown':
      return l.projectsGroupUnknown
    default:
      return l.projectsGroupOther
  }
}

// 一行「标签 · 值」。值为 null 即渲染「文档未提及」，并挂 is-unknown 让它视觉上明确是
// 缺信息（弱化、斜体），而不是一个正常的值。
function FactRow({
  label,
  value,
  unknownLabel,
}: {
  label: string
  value: string | null
  unknownLabel: string
}) {
  const known = value !== null
  return (
    <span className={classNames(['lite-project-fact', !known && 'is-unknown'])}>
      <span className="lite-project-fact-label">{label}</span>
      <span className="lite-project-fact-value">{known ? value : unknownLabel}</span>
    </span>
  )
}

function ProjectCard({
  view,
  onOpen,
  onAsk,
}: {
  view: ProjectView
  onOpen: (id: string) => void
  onAsk: (view: ProjectView) => void
}) {
  const { t } = useDict()
  const l = t.lite2
  const tone = statusTone(view.statusKey)
  const blockerCount = view.blockers.length

  return (
    // #48 · 整卡从单个 <button> 改成「容器 + 内部多按钮」（HTML 不许按钮嵌按钮）：
    // div 的 onClick 保住「点卡面任意处开详情」的既有手感；键盘/读屏路径走标题按钮
    // （原 aria-label 原样搬过去）；卡面新增「去问 Avery ↗」次级动作（stopPropagation
    // 防止冒泡开详情）。同批改的 TeamScreen PersonCard 是同一个结构。
    <div
      className={classNames([
        'lite-project-card',
        statusEdgeClass(view.statusKey),
        view.statusKey === 'unknown' && 'is-status-unknown',
      ])}
      data-project-id={view.id}
      onClick={() => onOpen(view.id)}
    >
      <span className="lite-project-card-head">
        <h3 className="lite-project-title">
          <button
            type="button"
            className="lite-card-open"
            onClick={(e) => {
              e.stopPropagation()
              onOpen(view.id)
            }}
            aria-label={fill(l.projectsOpenAria, { title: view.title })}
          >
            {view.title}
          </button>
        </h3>
        <span className={classNames(['lite-project-status', view.statusKey === 'unknown' && 'is-unknown'])}>
          <span className={classNames(['status-dot', tone])} aria-hidden="true" />
          {projectStatusLabel(view, l)}
        </span>
      </span>

      {/* rich-align-0722/05a：卡含手编字段 → 一枚「手动编辑」出处角标（逐字段出处在详情浮层）。
          🔴 纯文档抽取卡（provenance 全 doc/缺席）不挂——不替文档冒充手编。 */}
      {cardHasManual(view) ? (
        <span className="lite-project-provenance">{l.projectsManualBadge}</span>
      ) : null}

      {/* 🔴 风险徽章：有 riskLevel 才画（absent≠none）。文档没写风险 = 整个徽章收起，
          绝不渲染「无风险 / low」。等级 → 她的软底深字令牌（high 红/medium 橙/low 绿）。 */}
      {view.riskLevel ? (
        <span className={classNames(['lite-project-risk', `risk-${view.riskLevel}`])}>
          <span className="lite-project-risk-dot" aria-hidden="true" />
          <span className="lite-project-risk-level">{projectRiskLabel(view.riskLevel, l)}</span>
          {view.riskReason ? (
            <span className="lite-project-risk-reason">{view.riskReason}</span>
          ) : null}
        </span>
      ) : null}

      {/* 🔴 里程碑圆点串：有里程碑才画（absent≠none）。点色随状态（done绿/active蓝/blocked红/
          upcoming线灰/other 独立空心点）；名称小字。文档没写 = 整行收起。 */}
      {view.milestones.length > 0 ? (
        <span className="lite-project-milestones">
          {view.milestones.map((m, idx) => (
            <span
              key={`${m.name}-${idx}`}
              className={classNames(['lite-project-milestone', `ms-${m.status}`])}
            >
              <span className="lite-project-milestone-dot" aria-hidden="true" />
              <span className="lite-project-milestone-name">{m.name}</span>
            </span>
          ))}
        </span>
      ) : null}

      {view.summary ? <p className="lite-project-summary">{view.summary}</p> : null}

      <span className="lite-project-facts">
        <FactRow
          label={l.projectsOwnerLabel}
          value={view.ownerName}
          unknownLabel={l.projectsUnknownValue}
        />
        <FactRow
          label={l.projectsDueLabel}
          value={view.dueDate}
          unknownLabel={l.projectsUnknownValue}
        />
      </span>

      {/* 🔴 进度：有值才画条。未知时画的不是 0% 的条，而是一行「文档未提及」——
          一条 0 宽的进度条和「文档没写」在屏幕上长得一模一样，那正是本条要避免的谎。 */}
      {view.progress !== null ? (
        <span className="lite-project-progress">
          <span className="lite-project-progress-row">
            <span className="lite-project-fact-label">{l.projectsProgressLabel}</span>
            <span className="lite-project-progress-value">{view.progress}%</span>
          </span>
          <span className="lite-project-progress-track" aria-hidden="true">
            <span className="lite-project-progress-fill" style={{ width: `${view.progress}%` }} />
          </span>
        </span>
      ) : (
        <span className="lite-project-progress">
          <FactRow
            label={l.projectsProgressLabel}
            value={null}
            unknownLabel={l.projectsUnknownValue}
          />
        </span>
      )}

      {blockerCount > 0 ? (
        <span className="lite-project-blockers">
          <span className="lite-project-blocker-count">
            {blockerCount === 1
              ? l.projectsBlockersOne
              : fill(l.projectsBlockersMany, { count: blockerCount })}
          </span>
          <span className="lite-project-blocker-first">{view.blockers[0]}</span>
        </span>
      ) : null}

      {/* #48 · 带着这个项目去问 Avery——composerDraft 预填 + 跳议事室，只预填不自动发。
          文案复用分诊卡同一动作的同一个词（triageTakeToRoomLabel）。 */}
      <span className="lite-card-actions">
        <button
          type="button"
          className="lite-btn lite-btn--ghost lite-card-ask"
          onClick={(e) => {
            e.stopPropagation()
            onAsk(view)
          }}
        >
          {l.triageTakeToRoomLabel} ↗
        </button>
      </span>
    </div>
  )
}

export function ProjectsScreen() {
  const { t } = useDict()
  const l = t.lite2
  // 🔴 读 rawTeam：`LiteProject` 上的 status/ownerName 是**渲染文案**（历史上更糟——曾是
  // `status ?? 'on-track'` / `ownerName ?? 'Unassigned'` 这种编出来的值）。判已知/未知只认
  // 原始 payload（见 projectView.ts 的说明）。
  const rawTeam = useLite((s) => s.rawTeam)
  const openDetail = useLite((s) => s.openDetail)
  const goScreen = useLite((s) => s.goScreen)
  // #48 · 卡面快问：预填走 flowStore.composerDraft（与分诊卡「去问 Avery」同一条通道）。
  const setComposerHint = useFlow((s) => s.setComposerHint)   // #69 · 卡片入口＝灰提示通道
  // #67 · refOfProject 按 id 查的是 store.team（@ 弹层候选的同一份数据面）——本屏渲染用
  // rawTeam 的 view，id 两边同源（liteTeamFromPayload 不换 id）。
  const team = useLite((s) => s.team)
  // feat-050 · 会话不丢：空态要分清「正在取回上次会话」和「真没有会话」（与 TeamScreen 同口径）。
  const restoring = useLite((s) => s.restoring)
  const restoreError = useLite((s) => s.restoreError)
  const restoreSession = useLite((s) => s.restoreSession)
  // rich-align-0722/05a：有 context 才出「添加项目」入口（无 context = 首访没上传，addProject 无处可写→不出假按钮）。
  const contextId = useLite((s) => s.contextId)
  const resetProjectWrite = useLite((s) => s.resetProjectWrite)
  const [showAddForm, setShowAddForm] = useState(false)

  const views = useMemo(
    () => buildProjectViews(rawTeam?.projects, rawTeam?.people),
    [rawTeam],
  )
  const groups = useMemo(() => groupProjects(views), [views])
  const coverage = useMemo(() => projectCoverage(views), [views])
  // rich-align-0722/05a：归档（软删）项目 → 网格下方折叠区。缺席=空（archived_projects 缺键 → []）。
  const archivedViews = useMemo(
    () => buildProjectViews(rawTeam?.archived_projects, rawTeam?.people),
    [rawTeam],
  )
  // #93：被粒度闸并进母卡的条目 → 归档区**下面**再一个区。同 absent≠none（缺键 → []）。
  const foldedViews = useMemo(
    () => buildProjectViews(rawTeam?.folded_projects, rawTeam?.people),
    [rawTeam],
  )

  const hasCoverageGap =
    coverage.missingProgress > 0 || coverage.missingDueDate > 0 || coverage.missingStatus > 0

  return (
    <section className="scene scene-nexus is-active lite-projects" aria-label={l.tabProjects}>
      <div className="lite-projects-scroll">
        <div className="lite-projects-frame">
          <header className="lite-projects-header">
            <div className="lite-projects-header-row">
              <div className="lite-projects-header-heading">
                <p className="eyebrow">{l.projectsEyebrow}</p>
                <h1>{l.projectsTitle}</h1>
              </div>
              {/* rich-align-0722/05a：页头右端 primary「添加项目」→ 内联表单。只在有 context 时出。 */}
              {contextId ? (
                <button
                  type="button"
                  className="lite-btn lite-btn--primary lite-projects-add"
                  onClick={() => {
                    resetProjectWrite()
                    setShowAddForm((v) => !v)
                  }}
                  aria-expanded={showAddForm}
                >
                  {l.projectsAddCta}
                </button>
              ) : null}
            </div>
            <p className="lite-projects-lede">{l.projectsLede}</p>
            {views.length > 0 ? (
              <p className="lite-projects-count">
                {views.length === 1
                  ? l.projectsCountOne
                  : fill(l.projectsCountMany, { count: views.length })}
              </p>
            ) : null}
            {/* 内联添加表单（页头下方展开；保存 primary + 取消 ghost，字段全中文 aria）。 */}
            {showAddForm && contextId ? (
              <AddProjectForm onDone={() => setShowAddForm(false)} />
            ) : null}
          </header>

          {/* 覆盖率实况。数字当场真算（projectCoverage），不是写死的统计句。
              一个缺口都没有时整块不渲染——没缺口就没必要念这段。 */}
          {views.length > 0 && hasCoverageGap ? (
            <section className="lite-projects-coverage" aria-label={l.projectsCoverageTitle}>
              <p className="eyebrow lite-projects-coverage-title">{l.projectsCoverageTitle}</p>
              <ul className="lite-projects-coverage-list">
                {coverage.missingProgress > 0 ? (
                  <li>{fill(l.projectsCoverageProgress, { count: coverage.missingProgress })}</li>
                ) : null}
                {coverage.missingDueDate > 0 ? (
                  <li>{fill(l.projectsCoverageDue, { count: coverage.missingDueDate })}</li>
                ) : null}
                {coverage.missingStatus > 0 ? (
                  <li>{fill(l.projectsCoverageStatus, { count: coverage.missingStatus })}</li>
                ) : null}
              </ul>
              <p className="lite-projects-coverage-note">{l.projectsCoverageNote}</p>
            </section>
          ) : null}

          {/* 只有 1 个项目：说清楚这可能是抽取粒度而不是「你只有一个项目」，并给可操作建议。
              离线 heuristic 路径每篇文档只吐 1 个，这是真实用户会撞到的常态。 */}
          {views.length === 1 ? (
            <p className="lite-projects-single-note">{l.projectsSingleNote}</p>
          ) : null}

          {views.length > 0 ? (
            groups.map((group) => (
              <section
                key={group.key}
                className="lite-projects-group"
                data-project-group={group.key}
                aria-label={groupLabel(group.key, l)}
              >
                <p className="eyebrow lite-projects-group-title">
                  {groupLabel(group.key, l)}
                  <span className="lite-projects-group-count">{group.views.length}</span>
                </p>
                <div className="lite-projects-grid">
                  {group.views.map((view) => (
                    <ProjectCard
                      key={view.id}
                      view={view}
                      onOpen={(id) => openDetail('project', id)}
                      onAsk={(v) => {
                        // #67 · 引用随预填走；查不到（不该发生，防御）退纯提示。
                        // #69 · 模板文字进 hint 通道（灰 placeholder），正文留空。
                        const ref = refOfProject(team, v.id)
                        setComposerHint(projectAskPrefill(v), ref ? [ref] : undefined)
                        goScreen('room')
                      }}
                    />
                  ))}
                </div>
              </section>
            ))
          ) : (
            /* 0 个项目的诚实空态：不摆骨架卡、不摆假分组栏。 */
            <section className="lite-projects-empty" aria-label={l.projectsEmptyAria}>
              {restoring ? (
                <p className="lite-projects-restoring" aria-live="polite">
                  {l.restoringLabel}
                </p>
              ) : restoreError ? (
                <div className="lite-projects-restore-failed" aria-live="polite">
                  <p>{l.restoreFailed}</p>
                  <p className="lite-projects-restore-detail">{restoreError}</p>
                  <button type="button" className="lite-btn lite-btn--ghost" onClick={() => void restoreSession()}>
                    {l.restoreRetry}
                  </button>
                </div>
              ) : (
                <>
                  <h2>{l.projectsEmptyTitle}</h2>
                  <p>{l.projectsEmptyBody}</p>
                  {/* 上传入口自 ADR-0032（files-hub-0729）起住在「资料库」——此前这里送去
                      「你的团队」，但 Team 屏已零上传元素，用户落地后还要被引导卡再转发一跳
                      （0802 走查实锤的两跳绕路）。直接送到上传真正所在的屏。 */}
                  <button
                    type="button"
                    className="lite-btn lite-btn--primary lite-projects-empty-cta"
                    onClick={() => goScreen('files')}
                  >
                    {l.projectsEmptyCta} →
                  </button>
                </>
              )}
            </section>
          )}

          {/* rich-align-0722/05a：归档（软删）折叠区——网格下方。有归档项目才出；灰化卡 + 恢复键。 */}
          {archivedViews.length > 0 ? <ArchivedDrawer views={archivedViews} /> : null}
          {/* #93：「已并入」区——归档区之下。有被折叠的条目才出；说清并去哪、凭哪一行，无恢复键。 */}
          {foldedViews.length > 0 ? <FoldedDrawer views={foldedViews} /> : null}
        </div>
      </div>
    </section>
  )
}

// rich-align-0722/05a：页头内联「添加项目」表单。title 必填；其余可选（不填即不发键，absent≠none：
// 后端不折 0/默认）。状态用 canonical 键选择（on-track/at-risk/blocked/done）以落进已知分组；
// 进度选填、越界/非数当作没填（宁可不发也不画骗人的条）。保存 primary + 取消 ghost，字段全中文 aria。
function AddProjectForm({ onDone }: { onDone: () => void }) {
  const { t } = useDict()
  const l = t.lite2
  const addProject = useLite((s) => s.addProject)
  const busy = useLite((s) => s.projectWriteBusy)
  const error = useLite((s) => s.projectWriteError)

  const [title, setTitle] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [status, setStatus] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [progress, setProgress] = useState('')
  const [summary, setSummary] = useState('')

  const canSubmit = title.trim().length > 0 && !busy

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    // 🔴 只塞真填了的键（absent≠none）——空字段不发，后端就不设、渲染层显「文档未提及」。
    const input: ProjectAddInput = { title: title.trim() }
    if (ownerName.trim()) input.ownerName = ownerName.trim()
    if (status) input.status = status
    if (dueDate.trim()) input.dueDate = dueDate.trim()
    if (summary.trim()) input.summary = summary.trim()
    const p = progress.trim()
    if (p !== '') {
      const nRaw = Number(p)
      // 越界/非数 → 当没填（不发 progress），绝不折 0 或截断成一个骗人的值。
      if (Number.isFinite(nRaw) && nRaw >= 0 && nRaw <= 100) input.progress = Math.round(nRaw)
    }
    const ok = await addProject(input)
    if (ok) onDone()
  }

  return (
    <form className="lite-project-form" onSubmit={submit} aria-label={l.projectsAddFormAria}>
      <div className="lite-project-form-grid">
        <label className="lite-project-form-field">
          <span className="lite-project-form-label">{l.projectsFieldTitle}</span>
          <input
            className="lite-project-form-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            aria-label={l.projectsFieldTitle}
            required
          />
        </label>
        <label className="lite-project-form-field">
          <span className="lite-project-form-label">{l.projectsOwnerLabel}</span>
          <input
            className="lite-project-form-input"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            maxLength={120}
            aria-label={l.projectsOwnerLabel}
          />
        </label>
        <label className="lite-project-form-field">
          <span className="lite-project-form-label">{l.detailStatus}</span>
          <select
            className="lite-project-form-input"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label={l.detailStatus}
          >
            <option value="">{l.projectsStatusUnset}</option>
            <option value="on-track">{l.projectsStatusOnTrack}</option>
            <option value="at-risk">{l.projectsStatusAtRisk}</option>
            <option value="blocked">{l.projectsStatusBlocked}</option>
            <option value="done">{l.projectsStatusDone}</option>
          </select>
        </label>
        <label className="lite-project-form-field">
          <span className="lite-project-form-label">{l.projectsDueLabel}</span>
          <input
            className="lite-project-form-input"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            maxLength={60}
            aria-label={l.projectsDueLabel}
          />
        </label>
        <label className="lite-project-form-field">
          <span className="lite-project-form-label">{l.projectsProgressLabel}</span>
          <input
            className="lite-project-form-input"
            value={progress}
            onChange={(e) => setProgress(e.target.value)}
            inputMode="numeric"
            maxLength={3}
            placeholder={l.projectsProgressOptional}
            aria-label={l.projectsProgressLabel}
          />
        </label>
        <label className="lite-project-form-field lite-project-form-field--wide">
          <span className="lite-project-form-label">{l.detailSummary}</span>
          <textarea
            className="lite-project-form-input lite-project-form-textarea"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={2000}
            rows={2}
            aria-label={l.detailSummary}
          />
        </label>
      </div>
      {error ? (
        <p className="lite-project-form-error" aria-live="polite">
          {l.projectsWriteFailed}
          {l.labelSep}
          {error}
        </p>
      ) : null}
      <div className="lite-project-form-actions">
        <button type="submit" className="lite-btn lite-btn--primary" disabled={!canSubmit}>
          {l.projectsAddSubmit}
        </button>
        <button type="button" className="lite-btn lite-btn--ghost" onClick={onDone} disabled={busy}>
          {l.detailCancel}
        </button>
      </div>
    </form>
  )
}

// rich-align-0722/05a：归档折叠区。默认折起（「已归档 N」按钮），展开见灰化卡 + 恢复键。
// 🔴 归档卡不是 button（不开详情浮层）——避免「卡即按钮」里再套恢复 button 的嵌套交互；
// 恢复走卡内独立 ghost 文字键，软删可逆一键回主网格。
function ArchivedDrawer({ views }: { views: ProjectView[] }) {
  const { t } = useDict()
  const l = t.lite2
  const restoreProject = useLite((s) => s.restoreProject)
  const busy = useLite((s) => s.projectWriteBusy)
  const [open, setOpen] = useState(false)

  return (
    <section className="lite-projects-archived" aria-label={l.projectsArchivedAria}>
      <button
        type="button"
        className="lite-btn lite-btn--ghost lite-projects-archived-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {fill(l.projectsArchivedTitle, { count: views.length })}
      </button>
      {open ? (
        <div className="lite-projects-archived-grid">
          {views.map((view) => (
            <div key={view.id} className="lite-project-card is-archived" data-project-id={view.id}>
              <span className="lite-project-card-head">
                <h3 className="lite-project-title">{view.title}</h3>
              </span>
              <span className="lite-project-facts">
                <FactRow
                  label={l.projectsOwnerLabel}
                  value={view.ownerName}
                  unknownLabel={l.projectsUnknownValue}
                />
              </span>
              <button
                type="button"
                className="lite-btn lite-btn--ghost lite-project-restore"
                onClick={() => void restoreProject(view.id)}
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

// #93 ·「已并入其他项目」区。默认折起，展开见每条并去了哪张卡、凭资料里的哪一行。
//
// ## 这个区回答的是一个具体问题
// 合伙人一份一份地补资料，某次传完之后一张项目卡就没了。后端从 #93 起答得出「为什么」
// （裁决落了库、重启也在），但在这之前**没有任何界面去读它**——对经理来说那张卡就是凭空消失。
//
// ## 🔴 三个刻意的不同（都不是省事）
//  ① **没有恢复键**。归档抽屉有，是因为归档是经理自己的动作，恢复是把他自己的动作撤回。这里
//     是粒度闸判的，而重判每次补传都对**全档案**重跑一遍——手动放回来的卡，下一次上传会被
//     原样再折一次。那是一个会自己撤销的按钮，比没有按钮更伤。真要给「放回来」，得连带把这张
//     卡钉成手编领域（吃 `_manually_touched` 那条豁免），等于让经理给单张卡永久关掉粒度闸；
//     那是一个独立的产品决定。今天唯一的那条路写在区尾的说明里：删掉判它的那份资料。
//  ② **不是 `is-archived` 那种灰化卡，是一行一条**。这里要读的是「它去哪了、凭什么」，
//     不是负责人/进度那些卡面事实——那些读数已经并到母卡上了，在这儿再显示一遍就是同一摊事
//     说两遍（也正是 `_active_projects` 过滤它们的理由）。
//  ③ **理由用后端原句，不在前端拼**。`fold.reason` 是 `Ruling.reason`，那句中文是闸自己写的、
//     跟回执里那句逐字相同。前端按规则 id 编一句人话 = 同一条口径长两处，闸改了这儿不会红。
//     规则 id (`fold.rule`) 是给工程师看的，**不渲染**。
function FoldedDrawer({ views }: { views: ProjectView[] }) {
  const { t } = useDict()
  const l = t.lite2
  const [open, setOpen] = useState(false)

  return (
    <section className="lite-projects-folded" aria-label={l.projectsFoldedAria}>
      <button
        type="button"
        className="lite-btn lite-btn--ghost lite-projects-folded-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {fill(l.projectsFoldedTitle, { count: views.length })}
      </button>
      {open ? (
        <div className="lite-projects-folded-body">
          <p className="lite-projects-folded-lede">{l.projectsFoldedLede}</p>
          <ul className="lite-projects-folded-list">
            {views.map((view) => (
              <li key={view.id} className="lite-projects-folded-item" data-project-id={view.id}>
                <span className="lite-projects-folded-title">{view.title}</span>
                <span className="lite-projects-folded-into">
                  {view.fold?.intoTitle
                    ? fill(l.projectsFoldedInto, { title: view.fold.intoTitle })
                    : l.projectsFoldedIntoUnknown}
                </span>
                {/* 缺席=不显示（absent≠none）。理由缺了就只剩「并去哪」，绝不拿规则 id 顶上。 */}
                {view.fold?.reason ? (
                  <span className="lite-projects-folded-reason">{view.fold.reason}</span>
                ) : null}
                {view.fold?.evidence ? (
                  <span className="lite-projects-folded-evidence">
                    {fill(l.projectsFoldedEvidence, { source: view.fold.evidence })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="lite-projects-folded-note">{l.projectsFoldedNote}</p>
        </div>
      ) : null}
    </section>
  )
}
