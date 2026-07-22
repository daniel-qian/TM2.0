import { useEffect, useMemo, useState } from 'react'
import { useLite } from '../store'
import { useFlow, selectGapsActive, selectGapsResolved, selectGapsDismissed } from '../flowStore'
import { useDict } from '../../shared/i18n/useDict'
import { UploadPanel } from '../UploadPanel'
import { InitialAvatar } from '../InitialAvatar'
import { useAuth } from '../auth/authStore'
import { useDemo } from '../demoStore'
import { deriveAttentionPeople, summarizeDecisions, type AttentionPerson } from '../homeDerive'
import { gapClaimText, type GapCard } from '../gapDerive'
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

// 差距面板的三态筛选口径（棒D）。'active' = 未标记；resolved/dismissed 与 gapMarks 同名。
type GapFilter = 'active' | 'resolved' | 'dismissed'

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
  // 0721 对齐棒 · B4 闭环：决策卡「加入跟进」+ 首页今日待办块。
  const addFollowup = useFlow((s) => s.addFollowup)
  const completeFollowup = useFlow((s) => s.completeFollowup)
  const [followupAddedKeys, setFollowupAddedKeys] = useState<ReadonlySet<string>>(new Set())

  const decisions = rawTeam?.decisions
  const decisionSummary = useMemo(() => summarizeDecisions(decisions), [decisions])
  // 差距三态（棒D · 布局与真部件战役）：gapMarks 已有 resolved/dismissed 两桶，active = 未标记。
  // 三态筛选 chip 是纯前端——只按同一份 deriveGaps 结果分桶，零 transport、零新派生。
  const gapsActive = useMemo(() => selectGapsActive(team, gapMarks), [team, gapMarks])
  const gapsResolved = useMemo(() => selectGapsResolved(team, gapMarks), [team, gapMarks])
  const gapsDismissed = useMemo(() => selectGapsDismissed(team, gapMarks), [team, gapMarks])
  const [gapFilter, setGapFilter] = useState<GapFilter>('active')
  const gapsShown =
    gapFilter === 'resolved' ? gapsResolved : gapFilter === 'dismissed' ? gapsDismissed : gapsActive
  const gapsTotal = gapsActive.length + gapsResolved.length + gapsDismissed.length
  const attention = useMemo(() => deriveAttentionPeople(team, rawTeam), [team, rawTeam])
  const openFollowups = followups.filter((item) => !item.done).length
  // 今日待办（B4）：flowStore 真数据——dueGroup==='today' 且未完成。首页只列前 5 条，
  // 细节/编辑仍归待办清单屏（feat-057 拍板：聚合做入口，不承载细节）。
  const todayFollowups = followups.filter((item) => !item.done && item.dueGroup === 'today')

  // ── 空态：还没有团队数据 ──────────────────────────────────────────────────
  // 0721 对齐棒 · Danny 拍板 4A（合伙人反馈 B1）：空态第一眼从「整屏上传面板」改为
  // **指挥室骨架**——四块各自诚实说"还没有材料、进来之后长什么"，上传降为右侧入口卡。
  // 合伙人零数据实测的结论就是：第一眼是拖文件，产品被读成了文件解析器。
  // 🔴 骨架四块是**预告不是数据**：不渲染任何数字、不装加载中、块上无链接（后面还没有
  //    东西，给个「→」等于把人送进四个空屏）。文案全部描述真实存在的产出面。
  // 🔴 restoring / restoreError 的会话恢复分支原样保留（feat-050）——回访用户第一眼
  //    还是"正在取回"，不是骨架。
  // Q3-A（input-side-0721 兑现）：「一键示例团队」真按钮——只在后端能力探测说有时出现
  //（探不到就一个像素都不出，仍然不出假按钮）。主入口在 onboarding 闸门页的三扇门；
  // 这里是给跳过了闸门（先自己逛逛）的人留的第二次机会。
  const authStatus = useAuth((s) => s.status)
  const demoAvailability = useDemo((s) => s.availability)
  const probeDemo = useDemo((s) => s.probe)
  const demoClaiming = useLite((s) => s.demoClaiming)
  const demoClaimError = useLite((s) => s.demoClaimError)
  const claimDemoTeam = useLite((s) => s.claimDemoTeam)
  useEffect(() => {
    if (!team) probeDemo()
  }, [team, probeDemo])
  if (!team) {
    return (
      <section className="scene is-active lite-home" aria-label={t.lite2.tabHome}>
        <div className="lite-home-scroll">
          <div className="lite-home-frame lite-home-frame-empty" data-home-skeleton="">
            <header className="lite-home-header">
              <p className="eyebrow">{t.lite2.emptyEyebrow}</p>
              <h1>{t.lite2.homeSkeletonTitle}</h1>
              <p className="lite-home-lede">{t.lite2.homeSkeletonLede}</p>
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
              ) : null}
            </header>
            <div className="lite-home-skeleton-row">
              <div className="lite-home-skeleton-blocks">
                {/* 四块与有数据态一一同名（homeDecisions/homeGaps/homeAttention/homeOverview）
                    ——骨架就是产品的形状，不是另一套页面。
                    ⚠️ 顺序自棒C 起不再一致：有数据态把 ④ 概览提到了第二段（KPI 条），骨架这边
                    仍是 决策→差距→关注→概览。棒B 已把空态几何逐像素冻结（lite2.css 尾段），
                    骨架顺序留到骨架自身重排那一棒再同步——只为对齐注释去动空态会白白漂移像素基线。 */}
                <section className="lite-home-block lite-home-skeleton" aria-label={t.lite2.homeDecisionsTitle}>
                  <div className="lite-home-block-head">
                    <h2>{t.lite2.homeDecisionsTitle}</h2>
                  </div>
                  <p className="lite-home-skeleton-note">{t.lite2.homeSkeletonDecisions}</p>
                </section>
                <section className="lite-home-block lite-home-skeleton" aria-label={t.lite2.homeGapsTitle}>
                  <div className="lite-home-block-head">
                    <h2>{t.lite2.homeGapsTitle}</h2>
                  </div>
                  <p className="lite-home-skeleton-note">{t.lite2.homeSkeletonGaps}</p>
                </section>
                <section className="lite-home-block lite-home-skeleton" aria-label={t.lite2.homeAttentionTitle}>
                  <div className="lite-home-block-head">
                    <h2>{t.lite2.homeAttentionTitle}</h2>
                  </div>
                  <p className="lite-home-skeleton-note">{t.lite2.homeSkeletonAttention}</p>
                </section>
                <section className="lite-home-block lite-home-skeleton" aria-label={t.lite2.homeOverviewTitle}>
                  <div className="lite-home-block-head">
                    <h2>{t.lite2.homeOverviewTitle}</h2>
                  </div>
                  <p className="lite-home-skeleton-note">{t.lite2.homeSkeletonOverview}</p>
                </section>
              </div>
              <aside className="lite-home-upload-side">
                {demoAvailability === 'yes' ? (
                  <div className="lite-home-demo" data-home-demo="">
                    <button
                      type="button"
                      className="lite-btn lite-btn--primary lite-home-demo-btn"
                      disabled={demoClaiming}
                      aria-busy={demoClaiming}
                      onClick={() => void claimDemoTeam()}
                    >
                      {demoClaiming
                        ? t.lite2.onboardDoorDemoBusy
                        : t.lite2.onboardDoorDemoTitle}
                    </button>
                    <p className="lite-home-demo-note">{t.lite2.homeDemoNote}</p>
                    {demoClaimError ? (
                      <p className="lite-home-demo-error" role="alert">
                        {t.lite2.onboardDoorDemoErrorLead} {demoClaimError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <UploadPanel />
                <ul className="lite-empty-hints">
                  <li>{t.lite2.emptyHintRoster}</li>
                  <li>{t.lite2.emptyHintProject}</li>
                  <li>{t.lite2.emptyHintPrivacy}</li>
                </ul>
                {/* 登录提示前置（合伙人反馈 A6）：authGuestNote 原来只在账号弹层里可见。
                    渲染条件 = 登录按钮真的在顶栏上（status==='guest'）——auth 未配置的
                    构建里没有登录按钮，这句会变成没头没脑的话。 */}
                {authStatus === 'guest' ? (
                  <p className="lite-home-guest-note" data-guest-note="">
                    {t.lite2.homeGuestNote}
                  </p>
                ) : null}
              </aside>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="scene is-active lite-home" aria-label={t.lite2.tabHome}>
      <div className="lite-home-scroll">
        <div className="lite-home-frame">
          <header className="lite-home-header">
            <p className="eyebrow">{t.lite2.homeEyebrow}</p>
            <h1>{t.lite2.homeTitle}</h1>
            <p className="lite-home-lede">{t.lite2.homeLede}</p>
          </header>

          {/* ── ④ 团队概览计数（每个数各自点进对应屏）───────────────────── */}
          {/* 位置：棒C（布局与真部件战役 2026-07-22）把这一块从页面最底提到标题块之后作
              第二段——她的主页纵序是 标题块 → KPI 条 → 双栏（battle-map §3.1）。
              区块编号沿用 ④ 不改：CSS 里的 `── ④ Avery 手上有什么` 段、空态骨架的四块
              同名注释都按这个编号索引，重编号只会让沿革断线。**只挪位置，数据来源一个字未动**。 */}
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

          {/* ── 主次双栏（棒B' · 布局与真部件战役 2026-07-22）────────────────────────
              她的主页双栏是 grid-cols-[1.55fr_1fr]：**左柱装 DecisionQueue，右轨纵向堆
              GapRail + PeopleRail**（battle-map §3.1）。棒B 只把既有的 .lite-home-row 改成
              1.55fr/1fr 就收工了，但那根柱子里装的一直是 ②差距 + ③关注人 —— ①决策 / ①½待办
              从来没进过双栏，仍是 frame 的全宽直系子。
              后果（对抗审查 blast 视角实测）：外夹放宽到 1392 之后，决策卡读宽变成 **1354px**，
              比 D15「内容栏守 760-1040」的上限超出 314px —— 而 plan.md D-1 批准 1480 外夹的
              整条论证前提正是「左栏 835.17 落在 D15 带内」。前提没兑现，D15 就是实打实破着的。
              更隐蔽的是：spec 的 homeRowLeftWidth=835.17 **量的是差距块**，所以 SPEC_STICK=5
              十行全绿，却是绿在错的结构上（假绿）。
              → 这里把 ①①½ 收进左柱、②③ 收进右轨，柱子与内容才配对上。
              新增的 layout.homeDecisionsColWidth / homeRailBlocks 两行规格钉死这个结构，
              防止以后再出现「宽度对了但装错东西」的假绿。 */}
          <div className="lite-home-row">
            {/* 左柱 1.55fr —— 她的 DecisionQueue 位 */}
            <div className="lite-home-main">
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
                  {decisions.map((card, idx) => {
                    const cardKey = `${card.subject_type}_${card.subject_id}_${idx}`
                    return (
                      <DecisionCard
                        key={cardKey}
                        card={card}
                        onOpenProject={() => openDetail('project', card.subject_id)}
                        onTakeToRoom={() =>
                          goScreen('room', { q: `${card.subject_title} — ${card.reason}` })
                        }
                        followupAdded={followupAddedKeys.has(cardKey)}
                        onAddFollowup={() => {
                          // B4 闭环：决策落成待办。标题走字典模板（CloserLook 的英文硬模板
                          // 是已知历史债，这里不再新增一处）；note 带决策理由溯源。
                          addFollowup({
                            title: fill(t.lite2.homeDecisionFollowupTitle, {
                              title: card.subject_title,
                            }),
                            source: 'decision',
                            dueGroup: 'today',
                            note: card.reason,
                          })
                          setFollowupAddedKeys((prev) => {
                            const next = new Set(prev)
                            next.add(cardKey)
                            return next
                          })
                        }}
                      />
                    )
                  })}
                </ol>
              </>
            )}
          </section>

          {/* ── ①½ 今日待办（0721 · B4 闭环）：flowStore 真数据，只列 today 组未完成前 5 条。
              打勾就地完成（completeFollowup，同待办清单屏一致）；编辑/历史仍归待办清单屏。 */}
          <section className="lite-home-block lite-home-todos" aria-label={t.lite2.homeTodayTitle}>
            <div className="lite-home-block-head">
              <h2>{t.lite2.homeTodayTitle}</h2>
              {todayFollowups.length > 0 ? (
                <span className="lite-home-count">{todayFollowups.length}</span>
              ) : null}
              <button
                type="button"
                className="lite-home-block-link"
                onClick={() => goScreen('followups')}
              >
                {t.lite2.tabFollowups} →
              </button>
            </div>
            {todayFollowups.length === 0 ? (
              <p className="lite-home-quiet">{t.lite2.homeTodayEmpty}</p>
            ) : (
              <ul className="lite-home-todo-list">
                {todayFollowups.slice(0, 5).map((item) => (
                  <li key={item.id} className="lite-home-todo-item">
                    <button
                      type="button"
                      className="lite-home-todo-check"
                      aria-label={fill(t.lite2.homeTodayDoneAria, { title: item.title })}
                      onClick={() => completeFollowup(item.id)}
                    />
                    <span className="lite-home-todo-title">{item.title}</span>
                  </li>
                ))}
                {todayFollowups.length > 5 ? (
                  <li className="lite-home-todo-more">
                    {fill(t.lite2.homeTodayMore, { count: todayFollowups.length - 5 })}
                  </li>
                ) : null}
              </ul>
            )}
          </section>

            </div>

            {/* 右轨 1fr —— 她的 GapRail + PeopleRail 纵向堆叠位 */}
            <div className="lite-home-rail">
            {/* ── ② 差距摘要 → 多看一眼（棒D · 布局与真部件战役 2026-07-22）──────────
                她的 /gaps 差距卡把「自报 vs 观察」做成对照双列——这是这个概念的视觉语法。主页右轨
                是摘要位（空间窄），不整卡照搬，但对齐她的语法：section-label 小标题 + 每条
                「自报 / 观察」两侧带标签的证据 + 项目归属。
                🔴 claim 走 gapClaimText（B-2 修复）：summary 是真自述句才引原文，是标题/负责人这类
                元信息结构行就退回本地化的机械状态读出，绝不让一句标题冒充「文件里的说法」。 */}
            <section className="lite-home-block lite-home-gaps" aria-label={t.lite2.homeGapsTitle}>
              <div className="lite-home-block-head">
                <h2>{t.lite2.homeGapsTitle}</h2>
                {gapsActive.length > 0 ? (
                  <span className="lite-home-count">
                    {fill(t.lite2.homeGapsCount, { count: gapsActive.length })}
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
              {gapsTotal === 0 ? (
                <p className="lite-home-quiet">{t.lite2.homeGapsEmpty}</p>
              ) : (
                <>
                  {/* 三态筛选 chip + 每态计数（纯前端分桶）。chip 是带 aria-pressed 的按钮，
                      可见中文即标签——不加 aria-label（够不着的门反而是它，且无需拉丁串）。
                      resolved/dismissed 的词复用 gapResolvedBadge/gapDismissedBadge，与「多看
                      一眼」屏历史徽章一字不差，避免同一状态两处两个说法。 */}
                  <div className="lite-home-gap-filter">
                    <button
                      type="button"
                      className="lite-home-gap-chip"
                      aria-pressed={gapFilter === 'active'}
                      onClick={() => setGapFilter('active')}
                    >
                      {t.lite2.homeGapFilterActive}
                      <span className="lite-home-gap-chip-count">{gapsActive.length}</span>
                    </button>
                    <button
                      type="button"
                      className="lite-home-gap-chip"
                      aria-pressed={gapFilter === 'resolved'}
                      onClick={() => setGapFilter('resolved')}
                    >
                      {t.lite2.gapResolvedBadge}
                      <span className="lite-home-gap-chip-count">{gapsResolved.length}</span>
                    </button>
                    <button
                      type="button"
                      className="lite-home-gap-chip"
                      aria-pressed={gapFilter === 'dismissed'}
                      onClick={() => setGapFilter('dismissed')}
                    >
                      {t.lite2.gapDismissedBadge}
                      <span className="lite-home-gap-chip-count">{gapsDismissed.length}</span>
                    </button>
                  </div>
                  {gapsShown.length === 0 ? (
                    <p className="lite-home-quiet">{t.lite2.homeGapsFilterEmpty}</p>
                  ) : (
                    <ul className="lite-home-gap-list">
                      {/* 摘要只列前三条，细节在「多看一眼」屏。 */}
                      {/* key 带下标：跨文档重复的项目会产出同 id 的 gap（后端 issue #10 —— 人名/项目
                          去重在 LLM 抽取路径上失效），裸 gap.id 会撞键。本屏另外两个列表已经这么做了。
                          🔴 不在前端去重：那会把后端的 bug 藏起来。 */}
                      {gapsShown.slice(0, 3).map((gap, idx) => (
                        <li key={`${gap.id}_${idx}`} className="lite-home-gap-item">
                          <button
                            type="button"
                            className="lite-home-gap-title"
                            onClick={() => openDetail('project', gap.projectId)}
                          >
                            {gap.projectTitle}
                          </button>
                          <div className="lite-home-gap-side lite-home-gap-side-claim">
                            <span className="lite-home-gap-side-label">{t.lite2.gapCardClaimLabel}</span>
                            <p className="lite-home-gap-side-text">{gapClaimText(gap, t.lite2)}</p>
                          </div>
                          <div className="lite-home-gap-side lite-home-gap-side-observed">
                            <span className="lite-home-gap-side-label">
                              {t.lite2.gapCardEvidenceLabel}
                            </span>
                            {/* verbatim blocker 原文——gapDerive.ts 逐字透传，不转述。 */}
                            <p className="lite-home-gap-side-text">{gap.evidence}</p>
                          </div>
                          <p className="lite-home-gap-source">{t.lite2.handoffEvidenceTag}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
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
          </div>
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
  onAddFollowup,
  followupAdded,
}: {
  card: LiveDecisionCard
  onOpenProject: () => void
  onTakeToRoom: () => void
  // 0721 · B4 闭环：加入跟进（added 态由父级按卡 key 记，防重复添加）。
  onAddFollowup: () => void
  followupAdded: boolean
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
      className={classNames(['lite-card', 'lite-home-decision', `home-tone-${gradeTone(card.grade)}`])}
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
          className="lite-btn lite-btn--ghost lite-home-decision-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {t.lite2.homeDecisionRulesToggle} · {card.matched_rules.length}
          <span aria-hidden="true">{open ? ' ▴' : ' ▾'}</span>
        </button>
        <button type="button" className="lite-btn lite-btn--ghost lite-home-decision-open" onClick={onOpenProject}>
          {t.lite2.homeDecisionOpenProject} →
        </button>
        {/* 带着这条决策的问题进议事室（feat-051 已接好 `?q=` 接力参数）。
            不自动提交——manager 审过再问，同 feat-036/044 的 authorship 原则。 */}
        <button type="button" className="lite-btn lite-btn--ghost lite-home-decision-room" onClick={onTakeToRoom}>
          {t.lite2.homeDecisionAskRoom} ↗
        </button>
        {/* 0721 · B4 闭环：决策落成待办（同 CloserLook 卡的 addFollowup 形态）。 */}
        <button
          type="button"
          className="lite-btn lite-btn--soft lite-home-decision-followup"
          disabled={followupAdded}
          onClick={onAddFollowup}
        >
          {followupAdded ? t.lite2.followupAdded : t.lite2.homeDecisionAddFollowup}
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

// ── 需关注的人的一行（棒D · 布局与真部件战役 2026-07-22）──────────────────────
// 她的行结构：首字母头像 + 姓名 + 状态标签 + 角色，行内 py-3 分隔线。我方照搬**行结构 /
// 间距 / 头像**，但：
// 🔴 D14 人面零数字零血条：她每行右侧的 91%/88%/84% 百分比列**整列删掉**。LitePerson 类型层
//    本就没有数字槽位、stripPersonNumbers 运行时还会丢弃任何 number 键——想撞也撞不上。
// 🔴 两个诚实性前置（homeDerive.ts §需关注的人，缺一即触红线）：
//    ① 口径写在脸上：「因为出现在 N 条信号里 / 名下挂着 N 条卡点」（why 行 + panel caption）。
//    ② 同屏摆 verbatim 原文：AttentionPerson.evidence[≤2]，原样不转述——名单可解释才敢给人看。
// 这不是人卡（刻意不复用 .home-person-card），更不是打分。signalCount/blockerCount 数的是
// **文件里的事的条数**，不是对人的评价。永不出现 %、评分、排名位次。
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
      <InitialAvatar name={person.name} size={36} className="lite-home-attention-avatar" />
      <div className="lite-home-attention-body">
        <button type="button" className="lite-home-attention-name" onClick={onOpen}>
          {person.name}
          {person.role ? <span className="lite-home-attention-role">{person.role}</span> : null}
        </button>
        <p className="lite-home-attention-why">{why.join(' · ')}</p>
        {/* verbatim 原文，最多两条（homeDerive 已 slice(0,2)）。原样摆出来，不转述、不改写。 */}
        {person.evidence.map((line, i) => (
          <p key={i} className="lite-home-attention-evidence">
            {line}
          </p>
        ))}
      </div>
    </li>
  )
}
