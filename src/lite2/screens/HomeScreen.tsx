import { useMemo, useState } from 'react'
import { useLite } from '../store'
import { useFlow, selectGapsActive } from '../flowStore'
import { useDict } from '../../shared/i18n/useDict'
import { UploadPanel } from '../UploadPanel'
import { deriveAttentionPeople, summarizeDecisions, type AttentionPerson } from '../homeDerive'
import type { LiveDecisionCard } from '../transport'

// feat-057（PRD G4 / decisions.md Q2「两个都极端 → 结合」）· 聚合首屏。
//
// Danny 拍板：聚合做**入口**，7 个分屏**全部保留**为深入面——不是二选一。所以这一屏本身
// 不承载细节，它只回答"今天先看哪儿"，然后把人送进真正管那件事的那一屏。
// 四块：① 今天要决策的（feat-056 定级）② 差距摘要（→ 多看一眼）③ 需关注的人（→ 你的团队）
// ④ Avery 手上有什么（计数，各自点进对应屏）。
//
// 🔴 本屏的验收线就一条：**每个数字都能追到真数据来源，没有一个是写死的**。
// 所有计数一律来自 homeDerive.ts 对真 payload 的清点，或 store 里真实数组的 length。
// 参考库那种问候统计句（"扫描了 186 条信号""距国庆还有 83 天"）是硬编码的，一个都不搬；
// 我们没有的量（她的 5 张 KPI 指标条）本波不做（feat-066 才有推导工具）。
//
// 🔴 定级契约（feat-056）：等级、排序、理由**全归后端**。前端不判级、不重排、不改写 reason。
// `decisions` 是 optional —— 老后端不发这个键，那时必须给**诚实空态**，不许造数据、不许崩。
//
// 🔴 「文档未提及」(unknown_fields) 与「读不准」(unparsed_fields) 是两件事，措辞永不混用：
// 后者必须把**文档原文**摆出来。客户手上就有原件，把他写过的字说成"没写"，
// 这份读数的全部说服力当场归零（decision_grading_rules.md §缺数据怎么判）。

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

// 等级 → 语气温度（与全壳 home-tone-* 同族：terracotta 今天需要你 · honey 值得一看 ·
// sage 安稳）。🔴 只做视觉分档，不参与判级——判级是后端的活。
function gradeTone(grade: LiveDecisionCard['grade']): string {
  if (grade === 'high_risk') return 'terracotta'
  if (grade === 'needs_confirmation') return 'honey'
  return 'sage'
}

export function HomeScreen() {
  const { t } = useDict()
  const team = useLite((s) => s.team)
  const rawTeam = useLite((s) => s.rawTeam)
  const files = useLite((s) => s.files)
  const notes = useLite((s) => s.notes)
  const goScreen = useLite((s) => s.goScreen)
  const openDetail = useLite((s) => s.openDetail)
  // feat-050 · 会话不丢：首屏现在是落地屏，所以"正在取回上次会话"必须在这里也说清楚，
  // 否则刷新后第一眼是一屏空摘要，看着像数据没了。
  const restoring = useLite((s) => s.restoring)
  const restoreError = useLite((s) => s.restoreError)
  const restoreSession = useLite((s) => s.restoreSession)

  const gapMarks = useFlow((s) => s.gapMarks)
  const followups = useFlow((s) => s.followups)

  const decisions = rawTeam?.decisions
  const decisionSummary = useMemo(() => summarizeDecisions(decisions), [decisions])
  const gaps = useMemo(() => selectGapsActive(team, gapMarks), [team, gapMarks])
  const attention = useMemo(() => deriveAttentionPeople(team, rawTeam), [team, rawTeam])
  const openFollowups = followups.filter((item) => !item.done).length

  // ── 空态：还没有团队数据 ──────────────────────────────────────────────────
  // 首屏是 `/` 的落点，所以首访者第一眼落在这里——空态必须自己带上传入口，
  // 不能把人晾在一屏空摘要上（"去别的 tab 传文件"是让用户替我们找路）。
  if (!team) {
    return (
      <section className="scene is-active lite-home" aria-label="Today">
        <div className="lite-home-scroll">
          <div className="lite-home-frame lite-home-frame-empty">
            <header className="lite-home-header">
              <p className="eyebrow">{t.lite2.emptyEyebrow}</p>
              <h1>{t.team.emptyTitle}</h1>
              <p className="lite-home-lede">{t.team.emptyBody}</p>
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
                    className="lite-empty-restore-retry"
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
            <UploadPanel />
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="scene is-active lite-home" aria-label="Today">
      <div className="lite-home-scroll">
        <div className="lite-home-frame">
          <header className="lite-home-header">
            <p className="eyebrow">{t.lite2.homeEyebrow}</p>
            <h1>{t.lite2.homeTitle}</h1>
            <p className="lite-home-lede">{t.lite2.homeLede}</p>
          </header>

          {/* ── ① 今天要决策的 ─────────────────────────────────────────── */}
          <section className="lite-home-block lite-home-decisions" aria-label={t.lite2.homeDecisionsTitle}>
            <div className="lite-home-block-head">
              <h2>{t.lite2.homeDecisionsTitle}</h2>
              {decisions && decisions.length > 0 ? (
                <span className="lite-home-count">
                  {fill(t.lite2.homeDecisionsCount, { total: decisionSummary.total })}
                </span>
              ) : null}
              <button
                type="button"
                className="lite-home-block-link"
                onClick={() => goScreen('room')}
              >
                {t.lite2.tabRoom} →
              </button>
            </div>

            {decisions === undefined ? (
              /* 老后端不发 decisions 这个键。诚实说明是哪种"空"——绝不造一条假决策，
                 也绝不说成"今天没事"（那是两回事，说错等于替后端撒谎）。 */
              <div className="lite-home-empty" data-empty-kind="absent">
                <h3>{t.lite2.homeDecisionsAbsentTitle}</h3>
                <p>{t.lite2.homeDecisionsAbsentBody}</p>
              </div>
            ) : decisions.length === 0 ? (
              <div className="lite-home-empty" data-empty-kind="none">
                <h3>{t.lite2.homeDecisionsEmptyTitle}</h3>
                <p>{t.lite2.homeDecisionsEmptyBody}</p>
              </div>
            ) : (
              <>
                <div className="lite-home-grade-row">
                  {/* 分级计数——label 取自 payload 的 grade_label，前端不自拟这三个词。 */}
                  {decisionSummary.buckets.map((bucket) => (
                    <span
                      key={bucket.grade}
                      className={`lite-home-grade-chip home-tone-${gradeTone(bucket.grade)}`}
                    >
                      <strong>{bucket.count}</strong> {bucket.label}
                    </span>
                  ))}
                  <span className="lite-home-order-note">{t.lite2.homeDecisionsOrderNote}</span>
                </div>
                {/* 🔴 数组顺序 = 后端按严重度排好的顺序。前端不 sort。 */}
                <ol className="lite-home-decision-list">
                  {/* key 带上数组下标：跨文档去重当前是坏的（后端 issue #10），同一个主体
                      可能带着同一个 id 出现两遍。用纯 id 当 key 会撞键、React 复用错节点
                      （展开态串到另一张卡上）。🔴 这里只是让重复**显示得出来**，
                      刻意不在前端去重——那会把后端的 bug 藏起来。 */}
                  {decisions.map((card, idx) => (
                    <DecisionCard
                      key={`${card.subject_type}_${card.subject_id}_${idx}`}
                      card={card}
                      onOpenProject={() => openDetail('project', card.subject_id)}
                      onTakeToRoom={() =>
                        goScreen('room', { q: `${card.subject_title} — ${card.reason}` })
                      }
                    />
                  ))}
                </ol>
              </>
            )}
          </section>

          <div className="lite-home-row">
            {/* ── ② 差距摘要 → 多看一眼 ───────────────────────────────── */}
            <section className="lite-home-block lite-home-gaps" aria-label={t.lite2.homeGapsTitle}>
              <div className="lite-home-block-head">
                <h2>{t.lite2.homeGapsTitle}</h2>
                {gaps.length > 0 ? (
                  <span className="lite-home-count">
                    {fill(t.lite2.homeGapsCount, { count: gaps.length })}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="lite-home-block-link"
                  onClick={() => goScreen('closerlook')}
                >
                  {t.lite2.homeGapsLink} →
                </button>
              </div>
              {gaps.length === 0 ? (
                <p className="lite-home-quiet">{t.lite2.homeGapsEmpty}</p>
              ) : (
                <ul className="lite-home-gap-list">
                  {/* 摘要只列前三条并写明还剩多少，细节在「多看一眼」屏。引用的是
                      gapDerive.ts 已有的原文 evidence（verbatim），不转述。 */}
                  {/* key 带下标：跨文档重复的项目会产出同 id 的 gap（后端 issue #10 —— 人名/项目
                      去重在 LLM 抽取路径上失效），裸 gap.id 会撞键。本屏另外两个列表已经这么做了，
                      这里是漏的第三处。🔴 不在前端去重：那会把后端的 bug 藏起来。 */}
                  {gaps.slice(0, 3).map((gap, idx) => (
                    <li key={`${gap.id}_${idx}`} className="lite-home-gap-item">
                      <button
                        type="button"
                        className="lite-home-gap-title"
                        onClick={() => openDetail('project', gap.projectId)}
                      >
                        {gap.projectTitle}
                      </button>
                      <p className="lite-home-gap-evidence">{gap.evidence}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ── ③ 需关注的人 → 你的团队 ────────────────────────────── */}
            <section
              className="lite-home-block lite-home-attention"
              aria-label={t.lite2.homeAttentionTitle}
            >
              <div className="lite-home-block-head">
                <h2>{t.lite2.homeAttentionTitle}</h2>
                {attention.length > 0 ? (
                  <span className="lite-home-count">{attention.length}</span>
                ) : null}
                <button
                  type="button"
                  className="lite-home-block-link"
                  onClick={() => goScreen('team')}
                >
                  {t.lite2.homeAttentionLink} →
                </button>
              </div>
              {/* 🔴 口径必须写在脸上：这里数的是文件里提到的次数，不是对人的评价。
                  参考库用 load>=90 / sentiment=strained 挑人，那两个字段我们都没有，
                  也不许凭空造（homeDerive.ts §需关注的人）。 */}
              <p className="lite-home-caption">{t.lite2.homeAttentionCaption}</p>
              {attention.length === 0 ? (
                <p className="lite-home-quiet">{t.lite2.homeAttentionEmpty}</p>
              ) : (
                <ul className="lite-home-attention-list">
                  {/* 同上：人名跨文档去重是坏的（issue #10），id 可能重复出现，key 带下标。 */}
                  {attention.slice(0, 4).map((person, idx) => (
                    <AttentionRow
                      key={`${person.id}_${idx}`}
                      person={person}
                      onOpen={() => openDetail('person', person.id)}
                    />
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* ── ④ 团队概览计数（每个数各自点进对应屏）───────────────────── */}
          <section className="lite-home-block lite-home-overview" aria-label={t.lite2.homeOverviewTitle}>
            <div className="lite-home-block-head">
              <h2>{t.lite2.homeOverviewTitle}</h2>
            </div>
            {/* 每个数都是真数组的 length —— people/projects 来自 ingestion 回包，
                files/notes 来自各自的持久化端点，跟进来自 flowStore 的未完成条目。 */}
            <div className="lite-home-counts">
              <button type="button" className="lite-home-count-cell" onClick={() => goScreen('team')}>
                <strong>{team.people.length}</strong>
                <span>{t.lite2.homeOverviewPeople}</span>
              </button>
              <button type="button" className="lite-home-count-cell" onClick={() => goScreen('team')}>
                <strong>{team.projects.length}</strong>
                <span>{t.lite2.homeOverviewProjects}</span>
              </button>
              <button type="button" className="lite-home-count-cell" onClick={() => goScreen('team')}>
                <strong>{files.length}</strong>
                <span>{t.lite2.homeOverviewFiles}</span>
              </button>
              <button type="button" className="lite-home-count-cell" onClick={() => goScreen('notes')}>
                <strong>{notes.length}</strong>
                <span>{t.lite2.homeOverviewNotes}</span>
              </button>
              <button
                type="button"
                className="lite-home-count-cell"
                onClick={() => goScreen('followups')}
              >
                <strong>{openFollowups}</strong>
                <span>{t.lite2.homeOverviewFollowups}</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}

// ── 一张决策卡 ──────────────────────────────────────────────────────────────
// 展开 = 逐条列出命中的规则（rule_id / title / basis）与**原文证据**。
// 🔴 evidence 是文档原文，原样展示，不转述、不截断成省略号后丢掉原文。
function DecisionCard({
  card,
  onOpenProject,
  onTakeToRoom,
}: {
  card: LiveDecisionCard
  onOpenProject: () => void
  onTakeToRoom: () => void
}) {
  const { t } = useDict()
  const [open, setOpen] = useState(false)

  // 机器键 → 中文/英文字段名。后端 unknown_fields 只发机器键（'status'|'progress'|'dueDate'）；
  // 认不出的键原样显示（宁可露出机器键，也不假装认识它）。
  const fieldLabel = (field: string): string => {
    if (field === 'status') return t.lite2.homeFieldStatus
    if (field === 'progress') return t.lite2.homeFieldProgress
    if (field === 'dueDate') return t.lite2.homeFieldDueDate
    return field
  }

  return (
    <li
      className={classNames(['lite-home-decision', `home-tone-${gradeTone(card.grade)}`])}
      data-decision-grade={card.grade}
      data-decision-severity={card.severity}
    >
      <div className="lite-home-decision-head">
        {/* 用户面只显示 grade_label（后端发的中文档位），不显示 high_risk 这类机器键。 */}
        <span className="lite-home-decision-grade">{card.grade_label}</span>
        <h3 className="lite-home-decision-title">{card.subject_title}</h3>
        {card.owner_name ? (
          <span className="lite-home-decision-owner">
            {t.lite2.homeDecisionOwner} {card.owner_name}
          </span>
        ) : null}
      </div>

      <p className="lite-home-decision-reason">{card.reason}</p>
      <p className="lite-home-decision-source">
        {card.reason_source === 'avery'
          ? t.lite2.homeDecisionReasonAvery
          : t.lite2.homeDecisionReasonRule}
        {card.escalated ? ` · ${t.lite2.homeDecisionEscalated}` : ''}
      </p>
      {/* 上调必须写明为什么（feat-056 契约）——有就原样显示。 */}
      {card.escalated && card.escalation_reason ? (
        <p className="lite-home-decision-escalation">{card.escalation_reason}</p>
      ) : null}

      {/* 🔴 两种"没值"分开说。unknown = 文档确实没写；unparsed = 文档写了、读不准，
          必须把原文摆出来。绝不把后者说成「文档未提及」。 */}
      {card.unknown_fields.length > 0 ? (
        <p className="lite-home-decision-unknown">
          {t.lite2.homeDecisionUnknownLabel}：{card.unknown_fields.map(fieldLabel).join('、')}
        </p>
      ) : null}
      {card.unparsed_fields.length > 0 ? (
        <ul className="lite-home-decision-unparsed">
          {card.unparsed_fields.map((item) => (
            <li key={item.field}>
              {fill(t.lite2.homeDecisionUnparsed, {
                field: item.field_label || fieldLabel(item.field),
                raw: item.raw,
              })}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="lite-home-decision-actions">
        <button
          type="button"
          className="lite-home-decision-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {t.lite2.homeDecisionRulesToggle} · {card.matched_rules.length}
          <span aria-hidden="true">{open ? ' ▴' : ' ▾'}</span>
        </button>
        <button type="button" className="lite-home-decision-open" onClick={onOpenProject}>
          {t.lite2.homeDecisionOpenProject} →
        </button>
        {/* 带着这条决策的问题进议事室（feat-051 已接好 `?q=` 接力参数）。
            不自动提交——manager 审过再问，同 feat-036/044 的 authorship 原则。 */}
        <button type="button" className="lite-home-decision-room" onClick={onTakeToRoom}>
          {t.lite2.homeDecisionAskRoom} ↗
        </button>
      </div>

      {open ? (
        <ul className="lite-home-rule-list">
          {card.matched_rules.map((hit) => (
            <li key={hit.rule_id} className="lite-home-rule">
              <div className="lite-home-rule-head">
                <span className="lite-home-rule-id">{hit.rule_id}</span>
                <span className="lite-home-rule-title">{hit.title}</span>
                <span className="lite-home-rule-grade">{hit.grade_label}</span>
              </div>
              <p className="lite-home-rule-basis">
                {t.lite2.homeDecisionRuleBasis}：{hit.basis}
              </p>
              {hit.evidence.length > 0 ? (
                <>
                  {/* 证据必须自报出处：下面这几行是文档原文，不是 Avery 的话。 */}
                  <p className="lite-home-evidence-label">{t.lite2.homeDecisionEvidenceLabel}</p>
                  <ul className="lite-home-rule-evidence">
                    {hit.evidence.map((line, idx) => (
                      <li key={`${hit.rule_id}_${idx}`}>{line}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

// ── 需关注的人的一行 ────────────────────────────────────────────────────────
// 🔴 红线：这不是人卡（刻意不复用 .home-person-card），更不是打分。显示的两个数分别是
// 「几条信号提到她」和「她名下项目挂着几条卡点」——都是文件里的事的条数，且旁边永远
// 跟着原文，让经理自己判断。永不出现 %、评分、排名位次。
function AttentionRow({ person, onOpen }: { person: AttentionPerson; onOpen: () => void }) {
  const { t } = useDict()
  const why: string[] = []
  if (person.signalCount > 0) {
    why.push(fill(t.lite2.homeAttentionWhySignals, { count: person.signalCount }))
  }
  if (person.blockerCount > 0) {
    why.push(fill(t.lite2.homeAttentionWhyBlockers, { count: person.blockerCount }))
  }
  return (
    <li className="lite-home-attention-item">
      <button type="button" className="lite-home-attention-name" onClick={onOpen}>
        {person.name}
        {person.role ? <span className="lite-home-attention-role">{person.role}</span> : null}
      </button>
      <p className="lite-home-attention-why">{why.join(' · ')}</p>
      {person.evidence.length > 0 ? (
        <p className="lite-home-attention-evidence">{person.evidence[0]}</p>
      ) : null}
    </li>
  )
}
