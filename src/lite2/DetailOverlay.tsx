import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLite } from './store'
import { useRouteDetail } from './routes'
import { useDict } from '../shared/i18n/useDict'
import { InitialAvatar } from './InitialAvatar'
import { LiteModal } from './LiteModal'
import {
  buildProjectViews,
  isManualField,
  milestoneStatusLabel,
  projectRiskLabel,
  projectStatusLabel,
  type ProjectView,
} from './projectView'
import type { LiteDetail } from './store'
import type { LitePerson, LiteTeam } from './teamData'
import type { LiveTeamPayload, PersonPatchInput, ProjectPatchInput } from './transport'

// feat-024 · 薄只读详情浮层——ADR-0022 决策 2（v1 范围拍板）。
// 点人卡/项目卡开 ~百行纯 live payload 浮层：名字/角色/owns/来源文件——零 fixtures，
// 杀死 "Unknown teammate"（story 详情页只查 fixtures 的确诊渗漏）。
// 🔴 红线：人的浮层只显定性事实（角色/负责/协作/任期）；指向人的信号原样当"情境"呈现，
// 永不出现评分/排名/%。项目可硬（progress 数字允许）。
//
// feat-052：底座换成 LiteModal（背景点击 / Esc / 滚动锁 / 进出场动画 / 焦点管理 / 层级
// 统一走基座）。本体内容一行未改——只是不再自己挂 Escape 监听、不再自己画背景与卡片外壳。

export function DetailOverlay() {
  const { t } = useDict()
  // feat-051：详情由路由派生（`/team/:personId` · `/projects/:projectId`）——可深链、
  // 可后退关闭、刷新还在。closeDetail 仍走 store（签名不变），内部推路由。
  // feat-052：名字保留 live* 前缀——下面那套 lastRef 出场快照要区分「此刻真值」与
  // 「出场动画期间留住的最后一帧」，两者不能同名。
  const liveDetail = useRouteDetail()
  const liveTeam = useLite((s) => s.team)
  const rawTeam = useLite((s) => s.rawTeam)
  const closeDetail = useLite((s) => s.closeDetail)

  const open = Boolean(liveDetail && liveTeam)

  // 出场动画期间 store.detail 已经是 null，但面板还在屏上——留住最后一帧快照，否则关闭瞬间
  // 内容整块闪没、只剩一个空壳在缩。（LiteModal 的 open 由 store 驱动，这是配套写法。）
  // feat-055：快照里一并留住 rawTeam。项目详情改吃原始 payload 之后，只快照 team 会让人卡
  // 与项目卡在出场动画期间行为不一致——`reset()` 把 team/rawTeam 一起清空时，人卡还能从
  // 快照里渲染完这 300ms，项目卡却会当场翻成「这张卡片已不在你上传的文件里」再消失。
  // 两者同源同寿命，就该锁在同一张快照里。
  const lastRef = useRef<{
    detail: NonNullable<LiteDetail>
    team: LiteTeam
    raw: LiveTeamPayload | null
  } | null>(null)
  if (liveDetail && liveTeam) lastRef.current = { detail: liveDetail, team: liveTeam, raw: rawTeam }
  const held =
    liveDetail && liveTeam ? { detail: liveDetail, team: liveTeam, raw: rawTeam } : lastRef.current

  const detail = held?.detail ?? null
  const team = held?.team ?? null
  const heldRaw = held?.raw ?? null

  const signals = (rawTeam?.signals ?? []).filter(
    (sig) =>
      sig.subjectId === detail?.id && (sig.subjectType === 'person' || sig.subjectType === 'project'),
  )

  // rich-align-0722/06：人查找并入停用列表（同项目并入归档），停用瞬间不闪 detailGone + 深链可开。
  const person =
    detail?.kind === 'person' && team
      ? team.people.find((p) => p.id === detail.id) ??
        team.archivedPeople.find((p) => p.id === detail.id) ??
        null
      : null
  const personArchived = !!(person && team?.archivedPeople.some((p) => p.id === person.id))

  // feat-055：项目详情改吃**原始 payload**（rawTeam），不再吃 team.projects。
  // 理由与项目屏同一条：teamData 当时的 `status ?? 'on-track'` / `ownerName ?? 'Unassigned'`
  // 兜底会把「文档没写」抹成一个看起来正常的值，浮层于是把没写状态的项目显示成
  // "on-track"。（那两个兜底 07-19 已改成诚实文案 + Raw 判据，但 LiteProject 上的
  // status/ownerName 依然是**渲染文案**，不能当判据——读 raw 这条不变。）
  // 派生口径收在 projectView.ts，屏与浮层共用一份（同一个项目两处说法必须一致）。
  // 注：store 里 team 与 rawTeam 永远成对写入（uploadFiles / restoreSession / refreshTeam
  // 三处都在同一次 set 里落），所以「有 team 没 raw」不会发生。
  // 吃的是 held 快照里那份 raw（见上），不是 live rawTeam——理由同人卡。
  // rich-align-0722/05a：浮层项目查找并入归档列表。归档后卡离开 heldRaw.projects，若只查活动列表，
  // 归档那一刻 project 会瞬变 null 闪一下「detailGone」。并入归档列表则归档态平滑（页脚翻成恢复），
  // 也让归档项目的深链可打开。archivedIds 把页脚从「编辑·归档」翻成「恢复」。
  const projectViews = useMemo(
    () =>
      buildProjectViews(
        [...(heldRaw?.projects ?? []), ...(heldRaw?.archived_projects ?? [])],
        heldRaw?.people,
      ),
    [heldRaw],
  )
  const archivedIds = useMemo(
    () => new Set((heldRaw?.archived_projects ?? []).map((p) => p.id)),
    [heldRaw],
  )
  const project =
    detail?.kind === 'project' ? projectViews.find((p) => p.id === detail.id) ?? null : null
  const projectArchived = project ? archivedIds.has(project.id) : false

  return (
    <LiteModal
      open={open}
      onClose={closeDetail}
      ariaLabel={t.lite2.detailAria}
      backdropLabel={t.lite2.detailClose}
      panelClassName="lite-detail-card"
    >
      <button type="button" className="lite-btn lite-btn--ghost lite-detail-close" onClick={closeDetail}>
        {t.lite2.detailClose}
      </button>

      {person ? (
        <PersonDetailBody key={person.id} person={person} open={open} archived={personArchived} />
      ) : null}

      {project ? (
        <ProjectDetailBody key={project.id} project={project} open={open} archived={projectArchived} />
      ) : null}

      {detail && !person && !project ? (
        // 只有数据刷新竞态才可能到这——不渲染 "Unknown"（story 渗漏的口径），显平静空态。
        <section className="lite-detail-section">
          <p>{t.lite2.detailGone}</p>
        </section>
      ) : null}

      {signals.length > 0 ? (
        <section className="lite-detail-section">
          <p className="eyebrow">{t.lite2.detailSignals}</p>
          <ul>
            {signals.map((sig) => (
              <li key={sig.id}>{sig.summary}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* #37：这里曾经渲染「出处：你上传的文件」——喂的是 team.sourceFiles，
          一个**工作区级**的全量文件名清单，与被打开的这张卡没有任何关系。
          于是 16 个人的详情浮层逐字打印同一份 9 文件清单（人力经理的「出处」里列着
          另外两个人的简历），而纯手打、六个字段全挂「手动编辑」角标的项目，
          详情里照样列出全部 9 份文档——与角标本身直接自相矛盾。

          为什么是**删掉**而不是「手打卡改显示『此卡无文档出处』」：
          契约里根本没有逐卡溯源这个东西。LivePersonCard / LiveProjectCard
          （src/lite/transport.ts）都不带任何 source 字段，只有 payload 顶层的
          workspace 级 `source_files`。所以「这张卡出自这些文件」这句话，
          对**任何**一张卡都是我们说不出口的——不只是手打的那些。
          只给手打卡加一句「无文档出处」，反而等于坐实了"其余卡片列的就是它们的出处"，
          把同一个谎话说得更隐蔽。产品的核心主张是「没有一处是编的」、可溯源到具体文件，
          那就不能拿工作区级清单冒充卡片级溯源。
          工作区级清单本来就有正确的家：上传面板的「你的文件」（UploadPanel），
          删掉这一节没有丢失任何信息。
          要做**真的**逐卡溯源，那是后端契约变更（人卡/项目卡各自带 source 归属），
          值得单开一票，别用一个前端过滤器假装。 */}
    </LiteModal>
  )
}

// rich-align-0722/05a：详情浮层项目体——读态（逐字段「手动编辑」出处角标）/ 编辑态（字段原地变
// 输入框，保存 primary + 取消 ghost）/ 页脚操作（编辑 · 归档 / 或恢复）。
// 🔴 出场动画单独处理编辑态：open→false（关浮层）即退回读态，不显编辑输入框；切卡由 key={id} 重挂重置。
// 🔴 归档=软删可逆：归档成功即 closeDetail（卡去 projects 屏「已归档」折叠区）；归档态（深链/过渡）页脚给恢复。
function ProjectDetailBody({
  project,
  open,
  archived,
}: {
  project: ProjectView
  open: boolean
  archived: boolean
}) {
  const { t } = useDict()
  const l = t.lite2
  const patchProject = useLite((s) => s.patchProject)
  const archiveProject = useLite((s) => s.archiveProject)
  const restoreProject = useLite((s) => s.restoreProject)
  const closeDetail = useLite((s) => s.closeDetail)
  const busy = useLite((s) => s.projectWriteBusy)
  const error = useLite((s) => s.projectWriteError)
  const resetProjectWrite = useLite((s) => s.resetProjectWrite)

  const [editing, setEditing] = useState(false)
  const [dTitle, setDTitle] = useState(project.title)
  const [dOwner, setDOwner] = useState(project.ownerName ?? '')
  const [dStatus, setDStatus] = useState(project.statusRaw ?? '')
  const [dDue, setDDue] = useState(project.dueDate ?? '')
  const [dProgress, setDProgress] = useState(project.progress === null ? '' : String(project.progress))
  const [dSummary, setDSummary] = useState(project.summary ?? '')

  // 关浮层（open→false）即退编辑态——出场动画显读态快照（编辑态单独处理）。切卡由 key={project.id} 重挂。
  useEffect(() => {
    if (!open) setEditing(false)
  }, [open])

  const startEdit = () => {
    resetProjectWrite()
    setDTitle(project.title)
    setDOwner(project.ownerName ?? '')
    setDStatus(project.statusRaw ?? '')
    setDDue(project.dueDate ?? '')
    setDProgress(project.progress === null ? '' : String(project.progress))
    setDSummary(project.summary ?? '')
    setEditing(true)
  }

  const cancelEdit = () => {
    resetProjectWrite()
    setEditing(false)
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const patch: ProjectPatchInput = {}
    // title 必填、不可清空：非空且变了才发。
    const nt = dTitle.trim()
    if (nt && nt !== project.title) patch.title = nt
    // 其余字段：变了才发；清空（''）→ null（后端清→渲染 absent「文档未提及」，绝不折默认）。
    const diff = (draft: string, orig: string | null): string | null | undefined => {
      const d = draft.trim()
      const o = orig ?? ''
      if (d === o) return undefined
      return d === '' ? null : d
    }
    const owner = diff(dOwner, project.ownerName)
    if (owner !== undefined) patch.ownerName = owner
    const status = diff(dStatus, project.statusRaw)
    if (status !== undefined) patch.status = status
    const due = diff(dDue, project.dueDate)
    if (due !== undefined) patch.dueDate = due
    const summary = diff(dSummary, project.summary)
    if (summary !== undefined) patch.summary = summary
    // progress：'' → null（清空→absent）；有值只接受 0–100 有限数，越界/非数当没改（不发骗人的值）。
    const origProg = project.progress === null ? '' : String(project.progress)
    const np = dProgress.trim()
    if (np !== origProg) {
      if (np === '') patch.progress = null
      else {
        const n = Number(np)
        if (Number.isFinite(n) && n >= 0 && n <= 100) patch.progress = Math.round(n)
      }
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false)
      return
    }
    const ok = await patchProject(project.id, patch)
    if (ok) setEditing(false)
  }

  const archive = async () => {
    if (busy) return
    const ok = await archiveProject(project.id)
    if (ok) closeDetail() // 卡去「已归档」折叠区；并入归档列表的查找让此刻不闪 detailGone。
  }

  const restore = async () => {
    if (busy) return
    await restoreProject(project.id) // 留在浮层：恢复后页脚翻回「编辑·归档」。
  }

  const canSave = dTitle.trim().length > 0 && !busy
  const isEditing = editing && open && !archived

  const manual = (field: string) =>
    isManualField(project, field) ? (
      <span className="lite-detail-provenance">{l.projectsManualBadge}</span>
    ) : null

  if (isEditing) {
    return (
      <form className="lite-detail-edit" onSubmit={save} aria-label={l.projectsEditFormAria}>
        <header className="lite-detail-head">
          <div>
            <p className="eyebrow">{l.detailProjectEyebrow}</p>
            <label className="lite-detail-edit-field">
              <span className="lite-detail-edit-label">{l.projectsFieldTitle}</span>
              <input
                className="lite-detail-edit-input"
                value={dTitle}
                onChange={(e) => setDTitle(e.target.value)}
                maxLength={200}
                aria-label={l.projectsFieldTitle}
                autoFocus
                required
              />
            </label>
          </div>
        </header>
        <div className="lite-detail-edit-grid">
          <label className="lite-detail-edit-field">
            <span className="lite-detail-edit-label">{l.detailOwner}</span>
            <input
              className="lite-detail-edit-input"
              value={dOwner}
              onChange={(e) => setDOwner(e.target.value)}
              maxLength={120}
              aria-label={l.detailOwner}
            />
          </label>
          <label className="lite-detail-edit-field">
            <span className="lite-detail-edit-label">{l.detailStatus}</span>
            <input
              className="lite-detail-edit-input"
              value={dStatus}
              onChange={(e) => setDStatus(e.target.value)}
              maxLength={40}
              aria-label={l.detailStatus}
            />
          </label>
          <label className="lite-detail-edit-field">
            <span className="lite-detail-edit-label">{l.detailDue}</span>
            <input
              className="lite-detail-edit-input"
              value={dDue}
              onChange={(e) => setDDue(e.target.value)}
              maxLength={60}
              aria-label={l.detailDue}
            />
          </label>
          <label className="lite-detail-edit-field">
            <span className="lite-detail-edit-label">{l.detailProgress}</span>
            <input
              className="lite-detail-edit-input"
              value={dProgress}
              onChange={(e) => setDProgress(e.target.value)}
              inputMode="numeric"
              maxLength={3}
              placeholder={l.projectsProgressOptional}
              aria-label={l.detailProgress}
            />
          </label>
          <label className="lite-detail-edit-field lite-detail-edit-field--wide">
            <span className="lite-detail-edit-label">{l.detailSummary}</span>
            <textarea
              className="lite-detail-edit-input lite-detail-edit-textarea"
              value={dSummary}
              onChange={(e) => setDSummary(e.target.value)}
              maxLength={2000}
              rows={3}
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
        <div className="lite-detail-actions">
          <button type="submit" className="lite-btn lite-btn--primary" disabled={!canSave}>
            {l.detailSave}
          </button>
          <button type="button" className="lite-btn lite-btn--ghost" onClick={cancelEdit} disabled={busy}>
            {l.detailCancel}
          </button>
        </div>
      </form>
    )
  }

  // ── 读态 ──
  return (
    <>
      <header className="lite-detail-head">
        <div>
          <p className="eyebrow">{l.detailProjectEyebrow}</p>
          <h2>
            {project.title}
            {manual('title')}
          </h2>
          {archived ? <p className="lite-detail-archived-note">{l.projectsArchivedNote}</p> : null}
          <p className="lite-detail-subtitle">
            {l.detailStatus}
            {': '}
            <span className={project.statusKey === 'unknown' ? 'is-unknown' : undefined}>
              {projectStatusLabel(project, l)}
            </span>
            {manual('status')}
          </p>
          <p className="lite-detail-subtitle">
            {l.detailOwner}
            {': '}
            <span className={project.ownerName ? undefined : 'is-unknown'}>
              {project.ownerName ?? l.projectsUnknownValue}
            </span>
            {manual('ownerName')}
          </p>
          <p className="lite-detail-subtitle">
            {l.detailDue}
            {': '}
            <span className={project.dueDate ? undefined : 'is-unknown'}>
              {project.dueDate ?? l.projectsUnknownValue}
            </span>
            {manual('dueDate')}
          </p>
        </div>
      </header>

      {project.summary ? (
        <section className="lite-detail-section">
          <p className="eyebrow">
            {l.detailSummary}
            {manual('summary')}
          </p>
          <p>{project.summary}</p>
        </section>
      ) : null}

      <section className="lite-detail-section lite-detail-progress-section">
        <p className="eyebrow">
          {l.detailProgress}
          {manual('progress')}
        </p>
        {project.progress === null ? (
          <p className="is-unknown">{l.projectsUnknownValue}</p>
        ) : (
          <ProjectProgressRing value={project.progress} />
        )}
      </section>

      {project.riskLevel ? (
        <section className="lite-detail-section">
          <p className="eyebrow">{l.projectsRiskLabel}</p>
          <span className={`lite-project-risk risk-${project.riskLevel}`}>
            <span className="lite-project-risk-dot" aria-hidden="true" />
            <span className="lite-project-risk-level">{projectRiskLabel(project.riskLevel, l)}</span>
          </span>
          {project.riskReason ? <p className="lite-detail-risk-reason">{project.riskReason}</p> : null}
        </section>
      ) : null}

      {project.milestones.length > 0 ? (
        <section className="lite-detail-section">
          <p className="eyebrow">{l.projectsMilestonesLabel}</p>
          <span className="lite-detail-milestone-bar" aria-hidden="true">
            {project.milestones.map((m, idx) => (
              <span key={idx} className={`lite-detail-milestone-seg ms-${m.status}`} />
            ))}
          </span>
          <ul className="lite-detail-milestone-list">
            {project.milestones.map((m, idx) => (
              <li key={`${m.name}-${idx}`} className={`ms-${m.status}`}>
                <span className="lite-detail-milestone-dot" aria-hidden="true" />
                <span className="lite-detail-milestone-name">{m.name}</span>
                <span className="lite-detail-milestone-status">{milestoneStatusLabel(m, l)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {project.blockers.length > 0 ? (
        <section className="lite-detail-section">
          <p className="eyebrow">{l.detailBlockers}</p>
          <ul>
            {project.blockers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* rich-align-0722/05a：页脚操作区。活动卡→编辑·归档（软删可逆）；归档卡→恢复回主网格。 */}
      <div className="lite-detail-actions lite-detail-actions--footer">
        {archived ? (
          <button
            type="button"
            className="lite-btn lite-btn--soft lite-detail-restore"
            onClick={restore}
            disabled={busy}
          >
            {l.projectsArchivedRestore}
          </button>
        ) : (
          <>
            <button type="button" className="lite-btn lite-btn--soft" onClick={startEdit} disabled={busy}>
              {l.detailEdit}
            </button>
            <button
              type="button"
              className="lite-btn lite-btn--ghost lite-detail-archive"
              onClick={archive}
              disabled={busy}
            >
              {l.detailArchive}
            </button>
          </>
        )}
      </div>
      {error ? (
        <p className="lite-project-form-error" aria-live="polite">
          {l.projectsWriteFailed}
          {l.labelSep}
          {error}
        </p>
      ) : null}
    </>
  )
}

// rich-align-0722/06：详情浮层人员体——读态（逐字段「手动编辑」出处角标）/ 编辑态（**定性字段**原地
// 变输入框：姓名/职位/组别/司龄/负责，🔴 无人身数字位）/ 页脚操作（编辑 · 停用 / 或恢复）。
// 🔴 停用=软删可逆：停用成功即 closeDetail（卡去团队目录页尾折叠区）；停用态（深链/过渡）页脚给恢复。
// 🔴 两世界零数字：手编人无 self_report（禁经手编通道），故本体无任何自述数字面——开关开也 absent。
function PersonDetailBody({
  person,
  open,
  archived,
}: {
  person: LitePerson
  open: boolean
  archived: boolean
}) {
  const { t } = useDict()
  const l = t.lite2
  const patchPerson = useLite((s) => s.patchPerson)
  const archivePerson = useLite((s) => s.archivePerson)
  const restorePerson = useLite((s) => s.restorePerson)
  const closeDetail = useLite((s) => s.closeDetail)
  const busy = useLite((s) => s.projectWriteBusy)
  const error = useLite((s) => s.projectWriteError)
  const resetProjectWrite = useLite((s) => s.resetProjectWrite)

  const [editing, setEditing] = useState(false)
  const [dName, setDName] = useState(person.name)
  const [dRole, setDRole] = useState(person.role)
  const [dTeam, setDTeam] = useState(person.team ?? '')
  const [dTenure, setDTenure] = useState(person.tenure ?? '')
  const [dOwns, setDOwns] = useState((person.owns ?? []).join(l.listJoin))

  useEffect(() => {
    if (!open) setEditing(false)
  }, [open])

  const startEdit = () => {
    resetProjectWrite()
    setDName(person.name)
    setDRole(person.role)
    setDTeam(person.team ?? '')
    setDTenure(person.tenure ?? '')
    setDOwns((person.owns ?? []).join(l.listJoin))
    setEditing(true)
  }

  const cancelEdit = () => {
    resetProjectWrite()
    setEditing(false)
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const patch: PersonPatchInput = {}
    const nn = dName.trim()
    if (nn && nn !== person.name) patch.name = nn
    const diff = (draft: string, orig: string | null | undefined): string | null | undefined => {
      const d = draft.trim()
      const o = orig ?? ''
      if (d === o) return undefined
      return d === '' ? null : d
    }
    const role = diff(dRole, person.role)
    if (role !== undefined) patch.role = role
    const team = diff(dTeam, person.team)
    if (team !== undefined) patch.team = team
    const tenure = diff(dTenure, person.tenure)
    if (tenure !== undefined) patch.tenure = tenure
    // owns：顺序敏感的 list 比较；清空→null（absent）。
    const ownsList = dOwns.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
    const origOwns = (person.owns ?? []).map((s) => s.trim()).filter(Boolean)
    if (JSON.stringify(ownsList) !== JSON.stringify(origOwns)) {
      patch.owns = ownsList.length ? ownsList : null
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false)
      return
    }
    const ok = await patchPerson(person.id, patch)
    if (ok) setEditing(false)
  }

  const deactivate = async () => {
    if (busy) return
    const ok = await archivePerson(person.id)
    if (ok) closeDetail()
  }

  const restore = async () => {
    if (busy) return
    await restorePerson(person.id)
  }

  const canSave = dName.trim().length > 0 && !busy
  const isEditing = editing && open && !archived

  const manual = (field: string) =>
    person.provenance?.[field]?.origin === 'manual' ? (
      <span className="lite-detail-provenance">{l.projectsManualBadge}</span>
    ) : null

  if (isEditing) {
    return (
      <form className="lite-detail-edit" onSubmit={save} aria-label={l.peopleEditFormAria}>
        <header className="lite-detail-head">
          <InitialAvatar name={dName || person.name} size={52} className="lite-detail-avatar" />
          <div>
            <p className="eyebrow">{l.detailPersonEyebrow}</p>
            <label className="lite-detail-edit-field">
              <span className="lite-detail-edit-label">{l.peopleFieldName}</span>
              <input
                className="lite-detail-edit-input"
                value={dName}
                onChange={(e) => setDName(e.target.value)}
                maxLength={80}
                aria-label={l.peopleFieldName}
                autoFocus
                required
              />
            </label>
          </div>
        </header>
        <div className="lite-detail-edit-grid">
          <label className="lite-detail-edit-field">
            <span className="lite-detail-edit-label">{l.peopleFieldRole}</span>
            <input className="lite-detail-edit-input" value={dRole} onChange={(e) => setDRole(e.target.value)} maxLength={120} aria-label={l.peopleFieldRole} />
          </label>
          <label className="lite-detail-edit-field">
            <span className="lite-detail-edit-label">{l.peopleFieldTeam}</span>
            <input className="lite-detail-edit-input" value={dTeam} onChange={(e) => setDTeam(e.target.value)} maxLength={120} aria-label={l.peopleFieldTeam} />
          </label>
          <label className="lite-detail-edit-field">
            <span className="lite-detail-edit-label">{l.detailTenure}</span>
            <input className="lite-detail-edit-input" value={dTenure} onChange={(e) => setDTenure(e.target.value)} maxLength={120} aria-label={l.detailTenure} />
          </label>
          <label className="lite-detail-edit-field lite-detail-edit-field--wide">
            <span className="lite-detail-edit-label">{l.detailOwns}</span>
            <input className="lite-detail-edit-input" value={dOwns} onChange={(e) => setDOwns(e.target.value)} maxLength={400} placeholder={l.peopleOwnsHint} aria-label={l.detailOwns} />
          </label>
        </div>
        {error ? (
          <p className="lite-project-form-error" aria-live="polite">
            {l.projectsWriteFailed}
            {l.labelSep}
            {error}
          </p>
        ) : null}
        <div className="lite-detail-actions">
          <button type="submit" className="lite-btn lite-btn--primary" disabled={!canSave}>
            {l.detailSave}
          </button>
          <button type="button" className="lite-btn lite-btn--ghost" onClick={cancelEdit} disabled={busy}>
            {l.detailCancel}
          </button>
        </div>
      </form>
    )
  }

  // ── 读态 ──
  return (
    <>
      <header className="lite-detail-head">
        <InitialAvatar name={person.name} size={52} className="lite-detail-avatar" />
        <div>
          <p className="eyebrow">{l.detailPersonEyebrow}</p>
          <h2>
            {person.name}
            {manual('name')}
          </h2>
          <p className="lite-detail-subtitle">
            {[person.role, person.team].filter(Boolean).join(' · ')}
            {manual('role')}
            {manual('team')}
          </p>
          {archived ? <p className="lite-detail-archived-note">{l.peopleArchivedNote}</p> : null}
        </div>
      </header>

      {person.tenure ? (
        <section className="lite-detail-section">
          <p className="eyebrow">
            {l.detailTenure}
            {manual('tenure')}
          </p>
          <p>{person.tenure}</p>
        </section>
      ) : null}

      {person.owns && person.owns.length > 0 ? (
        <section className="lite-detail-section">
          <p className="eyebrow">
            {l.detailOwns}
            {manual('owns')}
          </p>
          <ul>
            {person.owns.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {person.collaboration && person.collaboration.length > 0 ? (
        <section className="lite-detail-section">
          <p className="eyebrow">{l.detailCollab}</p>
          <ul>
            {person.collaboration.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* rich-align-0722/06：页脚操作区。活动成员→编辑·停用（软删可逆）；停用成员→恢复回目录。 */}
      <div className="lite-detail-actions lite-detail-actions--footer">
        {archived ? (
          <button type="button" className="lite-btn lite-btn--soft lite-detail-restore" onClick={restore} disabled={busy}>
            {l.projectsArchivedRestore}
          </button>
        ) : (
          <>
            <button type="button" className="lite-btn lite-btn--soft" onClick={startEdit} disabled={busy}>
              {l.detailEdit}
            </button>
            <button type="button" className="lite-btn lite-btn--ghost lite-detail-archive" onClick={deactivate} disabled={busy}>
              {l.peopleDeactivate}
            </button>
          </>
        )}
      </div>
      {error ? (
        <p className="lite-project-form-error" aria-live="polite">
          {l.projectsWriteFailed}
          {l.labelSep}
          {error}
        </p>
      ) : null}
    </>
  )
}

// rich-align-0722/01：详情浮层环形进度。结构量级对齐她方（SVG 56 / stroke 5 / r 25.5 /
// 周长 ≈160.22）；颜色走皮层令牌（track 皮自适应淡底、fill 走 accent），入场过渡在 CSS 里
// 用 @media (prefers-reduced-motion: no-preference) 隔离。中心显示原始数字（不带 %，随她方）。
// value 已经过 projectView.progressOf 校验（0..100 有限数），这里只做防御性 clamp。
function ProjectProgressRing({ value }: { value: number }) {
  const size = 56
  const stroke = 5
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  const offset = circ * (1 - pct / 100)
  return (
    <span className="lite-project-ring" role="img" aria-label={`${value}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          className="lite-project-ring-track"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          className="lite-project-ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="lite-project-ring-value" aria-hidden="true">
        {value}
      </span>
    </span>
  )
}
