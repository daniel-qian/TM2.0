import { useMemo, useState, type FormEvent } from 'react'
import { useLite } from '../store'
import type { PersonAddInput } from '../transport'
import { useDict } from '../../shared/i18n/useDict'
import { localizeBriefing } from '../../shared/briefing'
import { localizePersonRead } from '../../shared/handoffCopy'
// files-hub-0729/03 · UploadPanel 的 import 已删——本屏彻底零文件元素（ADR-0032）。
import { Link } from 'react-router-dom'
import { filesHref } from '../routes'
import { InitialAvatar } from '../InitialAvatar'
import {
  deriveGroupFacets,
  deriveMoodFacets,
  filterDirectory,
  GROUP_ALL,
  GROUP_UNGROUPED,
  MOOD_ALL,
} from '../teamDirectory'
import type { LitePerson } from '../teamData'

// feat-024 · lite 屏 1+2：上传空态 · Your team——ADR-0022 决策 1。
// 空态：左脊柱是 live 自己的引导文案（不渲染任何 scripted 占位——story 渗漏的第一现场）。
// 🔴 红线：人卡永不渲染任何数字——LitePerson 类型层就没有评分键的位置。
//
// issue #46（2026-08-05，Danny 拍板推翻 ADR-0017，见 ADR-0034）：本屏回归**纯人员目录**——
// briefing 头 + 筛选目录 + 添加/停用。晨间分诊（feat-036 三动作）整块迁去 HomeScreen
// 与「今天要决策的」相邻；项目卡带删除（与 ProjectsScreen 纯重复，入口走顶栏项目 tab）。
// 分诊的 flowStore 接线（triageMarks localStorage）没动，只是消费方换了屏。

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
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
  // feat-050 · 会话不丢：空态下要分清"正在取回上次会话"和"真没有会话"。
  const restoring = useLite((s) => s.restoring)
  const restoreError = useLite((s) => s.restoreError)
  const restoreSession = useLite((s) => s.restoreSession)
  // rich-align-0722/06 · 人员手编 CRUD：有 context 才出「添加成员」入口（无 context=首访没上传→不出假按钮）。
  const contextId = useLite((s) => s.contextId)
  const resetProjectWrite = useLite((s) => s.resetProjectWrite)
  const [showAddPerson, setShowAddPerson] = useState(false)

  // feat-068 · 后端 briefing() 只会说英文（registry.py 里三处字面量写死，无 locale 参数，
  // 线上镜像不许重建）。中文构建下在这里本地重组；EN 下原样透传，视觉零变化。
  // 详见 src/shared/briefing.ts 顶部——请不要"顺手"把这层删掉。
  const briefing = useMemo(
    () => (team ? localizeBriefing(team.briefing, team, t.lite2, locale) : null),
    [team, t, locale],
  )

  return (
    <section className="scene scene-home is-active" aria-label={t.lite2.teamLiveAria}>
      <div className="home-scroll">
        {/* #46 · 单列（.home-frame--people，lite2.css）：分诊/项目迁走后左脊柱只剩 briefing 头，
            38/62 双列会留一根空柱——v01/story 的 .home-frame 原样不动。 */}
        <div className="home-frame home-frame--people">
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
                {/* #46 · 晨间分诊整块迁去 HomeScreen（与「今天要决策的」相邻）——ADR-0034。 */}
              </>
            ) : (
              /* ── 上传空态：live 自己的引导文案，零 scripted 占位 ── */
              <header className="home-greeting lite-empty-greeting">
                <p className="eyebrow">{t.lite2.emptyEyebrow}</p>
                <h1>{t.team.emptyTitle}</h1>
                {/* files-hub-0729/03 · 这里**不能**再用 `t.team.emptyBody`：那句话写的是
                    「把几个文件拖到右边」，而右边的上传口本片已经撤走了——它会当场变成一句
                    假话（本战役修的正是这一类）。
                    🔴 但也不能就地改 `t.team.emptyBody`：那个键是 v01 与 v02 **共用**的
                    （src/lite/screens/TeamScreen.tsx:219 也在读它），而 v01 一个字节没动、
                    右边的上传口还在，那句话在 v01 里仍然是真的。改它等于为了修 v02 去把 v01
                    弄错。lite2 有自己的命名空间正是为了这种分叉（kickoff-dev.md §6）。 */}
                <p className="home-greeting-sub">{t.lite2.teamEmptyLead}</p>
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

          {/* ── 右栏：空态 = 去资料库的引导；满态 = 双轨卡带 ──────────────────────────
              files-hub-0729/03（ADR-0032）· 本屏**彻底零文件元素**。Danny 原话：
              「团队和项目应该只分析团队和项目」。
              🔴 顺带删掉了原来那句注释「上传入口保留可加文件」——它是**假话**：后端不支持
              追加，`POST /ingest` 每次新铸 context，传旧 id 是重建并覆盖。在团队屏摆一个
              上传口，等于邀请用户做一件会把当前这份换掉的事，还告诉他这是"加文件"。
              上传、清单、下载、多库切换现在全在 /files。 */}
          {team ? (
            <div className="home-lanes">
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
              {/* #46 · 项目卡带删除：与 ProjectsScreen（feat-055）纯重复，入口走顶栏项目 tab——ADR-0034。 */}
            </div>
          ) : (
            // files-hub-0729/03 · 空态换引导卡：说清楚这里为什么是空的，并把人送去资料库。
            // 🔴 不在这里放上传口（本屏零文件元素），也不假装"正在加载"——没有 team 就是
            // 还没传过材料，说实话比转一个永远转不完的圈诚实。
            <div className="home-lanes home-lanes-live-empty">
              <div className="lite-team-empty-card">
                <p className="lite-team-empty-title">{t.lite2.teamEmptyTitle}</p>
                <p className="lite-team-empty-body">{t.lite2.teamEmptyBody}</p>
                <Link className="lite-btn lite-btn--primary lite-team-empty-cta" to={filesHref()}>
                  {t.lite2.teamEmptyCta}
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* #47 · LiteComposer 退役（Danny 拍板统一形态）：本屏提问入口 = 全局悬浮
          AskAveryLauncher 胶囊（Lite2App 挂载,不再对 team 收起）。@引用选人/选项目
          的场景由人员/项目卡面的「去问 Avery」接替（#48）。 */}
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
          {l.labelSep}
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
