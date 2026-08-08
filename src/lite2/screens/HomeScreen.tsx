import { useEffect, useMemo, useState } from 'react'
import { useLite } from '../store'
import {
  useFlow,
  selectGapsActive,
  selectGapsResolved,
  selectGapsDismissed,
  selectTriagePending,
  selectTriageHandled,
  selectTriageSetAside,
} from '../flowStore'
import { useDict } from '../../shared/i18n/useDict'
// #46（ADR-0034）· 晨间分诊从 TeamScreen 整块迁来，与「今天要决策的」相邻。
// 数据/文案/持久化三层原封不动：liveHandoffs 派生（teamData.ts）→ triageMarks 分桶
//（flowStore localStorage）→ localizeHandoff 成句（handoffCopy.ts）。
import { localizeHandoff, type HandoffDisplay } from '../../shared/handoffCopy'
import { briefingRiskCount } from '../../shared/briefing'
import { draftFromHandoff } from '../draftLinks'
import { useDraft } from '../draftStore'
import type { LiteHandoff } from '../teamData'
import { Link } from 'react-router-dom'
import { UploadPanel } from '../UploadPanel'
import { filesHref } from '../routes'
import { InitialAvatar } from '../InitialAvatar'
import { useAuth } from '../auth/authStore'
import { useDemo } from '../demoStore'
import { deriveAttentionPeople, summarizeDecisions, type AttentionPerson } from '../homeDerive'
import { gapClaimText, type GapCard } from '../gapDerive'
import type { LiveDecisionCard, LiveDecisionRuleHit } from '../transport'
import type { Dict } from '../../shared/i18n'

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
// 🔴 定级契约（feat-056 + [ADR-0033](docs/adr/0033-locale-is-a-request-field-backend-stops-
// emitting-prose.md)）：**等级和排序全归后端，句子全归前端。**
// 前端不判级、不重排、不改写等级；但那些人话——三个档位词、规则标题、"按规则判为…"那一句、
// 字段名——现在由本屏用 i18n 表按机器键渲染，zh/en 各一份。
// 这条注释以前写的是「理由也归后端、前端不改写 reason」。ADR-0033 反转了它，**保用意换载体**：
// 要的是单一事实源，不是"必须后端发"；后端发 `grade`/`rule_id`，前端查唯一那张表。
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

// ── ADR-0033 · 后端发机器键，这里查表出句子 ──────────────────────────────────────────────
//
// 这四个 helper 是「后端不再产出人话」的落地点。它们**只查表、不发挥**：拿到的是
// `high_risk` / `R-BLOCKER-STACK` / `dueDate` 这种机器键，出去的是 i18n 表里那一条。
// 查不到就把机器键原样露出来——🔴 绝不编一个看起来像人话的兜底词。露出 `R-XYZ` 是一眼可见的
// 缺表，编一个「其他风险」是查不出来的假话，后者贵得多。

function gradeLabelOf(t: Dict, grade: string): string {
  const table = t.lite2.decisionGrades as Record<string, string>
  return table[grade] ?? grade
}

function fieldLabelOf(t: Dict, field: string): string {
  if (field === 'status') return t.lite2.homeFieldStatus
  if (field === 'progress') return t.lite2.homeFieldProgress
  if (field === 'dueDate') return t.lite2.homeFieldDueDate
  if (field === 'blockers') return t.lite2.homeFieldBlockers
  return field
}

// 规则文案 = i18n 模板 + 命中自带的 params（阈值仍归后端配置，见 decision_rules.py::RULE_PARAMS）。
function ruleTextOf(t: Dict, hit: LiveDecisionRuleHit): { title: string; basis: string } {
  const table = t.lite2.decisionRules as Record<string, { title: string; basis: string }>
  const entry = table[hit.rule_id]
  if (!entry) return { title: hit.rule_id, basis: '' }
  return {
    title: fill(entry.title, hit.params ?? {}),
    basis: entry.basis,
  }
}

// 「按规则判为高风险：X；Y。」—— 后端此前拼好了整句发下来（写死中文），现在由这里拼。
// 只取**与最终等级同档**的命中，与后端旧实现同口径（低档命中不进这句话，它们在展开区里）。
function composeRuleReason(t: Dict, card: LiveDecisionCard): string {
  const top = card.matched_rules
    .filter((h) => h.grade === card.grade)
    .map((h) => ruleTextOf(t, h).title)
  const rules = top.length ? top.join(t.lite2.homeDecisionRuleJoin) : t.lite2.homeDecisionReasonNoRule
  return fill(t.lite2.homeDecisionReasonByRule, {
    grade: gradeLabelOf(t, card.grade),
    rules,
  })
}

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

// gap-design-0805 · B2b（#56）· 跨资料冲突类命中。这两条规则的证据是「每个读数一行」的对照
// （后端按上传日旧→新排好），渲染成双栏对照面 + 「可能只是叫法不同」的关闭出口。
// 机器键在这里出现是**分支判据**不是文案（文案仍在 i18n 表按 rule_id 查）。
const CONFLICT_RULE_IDS = new Set(['R-CROSS-DOC-CONFLICT', 'R-FRESH-CONTRADICTS-STALE'])

// 等级 → 语气温度（与全壳 home-tone-* 同族：terracotta 今天需要你 · honey 值得一看 ·
// sage 安稳）。🔴 只做视觉分档，不参与判级——判级是后端的活。
function gradeTone(grade: LiveDecisionCard['grade']): string {
  if (grade === 'high_risk') return 'terracotta'
  if (grade === 'needs_confirmation') return 'honey'
  return 'sage'
}

export function HomeScreen() {
  const { t, locale } = useDict()
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
  // #63（merge-closerlook）·「值得注意」屏并进本块，原地展开。浅合：只搬界面——对照卡/
  // 三态归宿（解决/忽略/放回来）/历史折叠/带去议事室预填，全部自 CloserLookScreen 迁入；
  // gapDerive 前端推导与 flowStore 的 gapMarks 一个字没动（深合另议，见票面「明确不做」）。
  // 默认仍是摘要形态（chips + 前三条预览，与迁移前逐字节相同）；点「全部展开」原地换成
  // 完整对照卡视图——不撑爆首屏靠的就是这个默认收起。
  const [gapsOpen, setGapsOpen] = useState(false)
  const [gapHistoryOpen, setGapHistoryOpen] = useState(false)
  const [gapFollowupIds, setGapFollowupIds] = useState<ReadonlySet<string>>(new Set())
  const resolveGap = useFlow((s) => s.resolveGap)
  const dismissGap = useFlow((s) => s.dismissGap)
  const restoreGap = useFlow((s) => s.restoreGap)
  const gapHistoryCount = gapsResolved.length + gapsDismissed.length
  const attention = useMemo(() => deriveAttentionPeople(team, rawTeam), [team, rawTeam])
  const openFollowups = followups.filter((item) => !item.done).length
  // 今日待办（B4）：flowStore 真数据——dueGroup==='today' 且未完成。首页只列前 5 条，
  // 细节/编辑仍归待办清单屏（feat-057 拍板：聚合做入口，不承载细节）。
  const todayFollowups = followups.filter((item) => !item.done && item.dueGroup === 'today')

  // ── #46 · 晨间分诊（自 TeamScreen 迁入，ADR-0034）────────────────────────────
  const triageMarks = useFlow((s) => s.triageMarks)
  const markTriageDone = useFlow((s) => s.markTriageDone)
  const discardTriage = useFlow((s) => s.discardTriage)
  const restoreTriage = useFlow((s) => s.restoreTriage)
  const setComposerDraft = useFlow((s) => s.setComposerDraft)
  // feat-058 · 应用内草稿框（弹层本体常驻挂在壳层 Lite2App，这里只负责开框）。
  const openDraft = useDraft((s) => s.openDraft)
  const [triageDrawerOpen, setTriageDrawerOpen] = useState(false)
  // 决策卡的 followupAddedKeys 是另一套键（cardKey），分诊条目用自己的 id 集合，别混桶。
  const [handoffFollowupIds, setHandoffFollowupIds] = useState<ReadonlySet<string>>(new Set())

  // feat-068 · 分诊条目的文案层（ZH-02）。teamData.ts 的 liveHandoffs() 只吐结构化信号，
  // 成句在这里按当前字典拼——详见 src/shared/handoffCopy.ts 顶部。
  // 三条 list 都要过这一层：pending 渲染卡片，handled/setAside 进"今天已照料"抽屉。
  const localizeH = useMemo(() => (h: LiteHandoff) => localizeHandoff(h, t.lite2), [t])
  const triagePending = useMemo(
    () => selectTriagePending(team, triageMarks).map(localizeH),
    [team, triageMarks, localizeH],
  )
  const triageHandled = useMemo(
    () => selectTriageHandled(team, triageMarks).map(localizeH),
    [team, triageMarks, localizeH],
  )
  const triageSetAside = useMemo(
    () => selectTriageSetAside(team, triageMarks).map(localizeH),
    [team, triageMarks, localizeH],
  )
  // `?.length` 双保险：selectTriage* / briefingRiskCount 对缺 handoffs/briefing 的形状都是
  // 防御式（?? []），这里对齐——auth 门的换身份 fixture 摆的就是不带 handoffs 的部分 team。
  const totalHandoffs = team?.handoffs?.length ?? 0

  // feat-068 · 入参是 HandoffDisplay：composer 预填 / 跟进标题 / 草稿正文用的都是
  // **已本地化**的 action + evidence。
  function handleTakeToRoom(handoff: HandoffDisplay) {
    // 分隔符用 " — " 而非换行：composer 是 <input type="text">，换行被剥掉后两段文字会
    // 连成一坨不可读（feat-044 对抗验证发现的同根 bug，见下面 handleGapAsk 同款注释）。
    setComposerDraft(`${handoff.action} — ${handoff.evidence}`)
    goScreen('room')
  }

  function handleHandoffFollowup(handoff: HandoffDisplay) {
    addFollowup({ title: handoff.action, source: 'triage', dueGroup: 'today', note: handoff.evidence })
    setHandoffFollowupIds((prev) => {
      const next = new Set(prev)
      next.add(handoff.id)
      return next
    })
  }

  // ── #63 · 对照卡的两个动作（自 CloserLookScreen 逐字迁入）──────────────────
  function handleGapAsk(gap: GapCard) {
    // 预填含项目引用 + claim/evidence 上下文；正文不携带人身评判语（只谈项目自述与信号，
    // 不谈"你为什么没说实话"一类归咎措辞）。不自动提交——manager 审过再问，同分诊
    // "带进议事室"的 authorship 原则（feat-036）。
    // 分隔符用 " — " 而非换行：composer 是 <input type="text">，换行被剥掉后三段文字会
    // 连成一坨不可读（对抗验证 redline 路发现，2026-07-14）。
    setComposerDraft(`${gap.projectTitle} — ${gapClaimText(gap, t.lite2)} — ${gap.evidence}`)
    goScreen('room')
  }

  function handleGapAddFollowup(gap: GapCard) {
    addFollowup({
      // 迁入时顺手还掉那笔记档过的债（原 CloserLook 写死英文模板 `Take a closer look at …`，
      // 本屏决策卡的同款动作早已走字典）：标题走 gapFollowupTitle 模板，zh/en 各一份。
      title: fill(t.lite2.gapFollowupTitle, { title: gap.projectTitle }),
      source: 'closer-look',
      dueGroup: 'today',
      note: gap.evidence,
    })
    setGapFollowupIds((prev) => {
      const next = new Set(prev)
      next.add(gap.id)
      return next
    })
  }

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
                {/* files-hub-0729/03 · 首页骨架的上传卡**保留**（Danny 拍板）：首访者的
                    第一个动作不该先跳一屏。卡底补一条去资料库的链接——上传之后"我传过什么、
                    现在用的是哪一批"都在那儿。
                    🔴 这里刻意不传 showFiles={false}：首页这份清单是首访者上传完的即时回执，
                    与资料库屏不同屏，不会出现两个 .upload-files。 */}
                <UploadPanel />
                <p className="lite-home-files-link-row">
                  <Link className="lite-home-files-link" to={filesHref()}>
                    {t.lite2.homeFilesManageLink} →
                  </Link>
                </p>
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
              {/* files-hub-0729/03 · 「资料概览」标题行加去资料库的链接。照本屏其他区块
                  `.lite-home-block-link` 的既有样式与写法（button + goScreen），不新造语法。
                  这一块数的就是文件/笔记，点进去管理它们是最自然的下一步。 */}
              <button
                type="button"
                className="lite-home-block-link"
                onClick={() => goScreen('files')}
              >
                {t.lite2.homeFilesLink} →
              </button>
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
                  {/* 分级计数。ADR-0033：后端发机器键 `grade`，这三个词从唯一那张 i18n 表查
                      （前端仍然不自拟，只是查表的位置从 payload 换成了 i18n）。 */}
                  {decisionSummary.buckets.map((bucket) => (
                    <span
                      key={bucket.grade}
                      className={`lite-home-grade-chip home-tone-${gradeTone(bucket.grade)}`}
                    >
                      <strong>{bucket.count}</strong> {gradeLabelOf(t, bucket.grade)}
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
                          // B4 闭环：决策落成待办。标题走字典模板（对照卡那笔英文硬模板的
                          // 历史债已随 #63 迁入一并还清——gapFollowupTitle）；note 带决策理由溯源。
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

          {/* ── ①¼ 今日提醒（#46 · 自 TeamScreen 迁入，ADR-0034）──────────────────
              与「今天要决策的」相邻：决策卡是后端定级引擎的产出，分诊条目是前端从项目
              blockers 的真派生（liveHandoffs，零捏造）——两套数据源，两个区块，不合并列表。
              三动作真接线原样：done/搁置 → 抽屉；去问 Avery → composer 预填不自动发；
              加到待办 → flowStore；起草消息 → 应用内草稿框。 */}
          <section className="lite-home-block lite-home-handoffs" aria-label={t.lite2.handoffsTitle}>
            <div className="lite-home-block-head">
              <h2>{t.lite2.handoffsTitle}</h2>
              {totalHandoffs > 0 && triagePending.length > 0 ? (
                <span className="lite-home-count" aria-live="polite">
                  {fill(t.lite2.triageRemaining, { pending: triagePending.length, total: totalHandoffs })}
                </span>
              ) : null}
            </div>

            {triagePending.length > 0 ? (
              <ol className="home-handoff-list">
                {triagePending.map((handoff) => (
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
                          disabled={handoffFollowupIds.has(handoff.id)}
                          onClick={() => handleHandoffFollowup(handoff)}
                        >
                          {handoffFollowupIds.has(handoff.id)
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

            {triageHandled.length + triageSetAside.length > 0 ? (
              <section className="home-drawer">
                <button
                  type="button"
                  className="home-drawer-toggle"
                  aria-expanded={triageDrawerOpen}
                  onClick={() => setTriageDrawerOpen((open) => !open)}
                >
                  {t.lite2.triageDrawerLabel} · {triageHandled.length}
                  {triageSetAside.length > 0 ? ` · ${triageSetAside.length} ${t.lite2.triageSetAsideLabel}` : ''}
                  <span aria-hidden="true">{triageDrawerOpen ? '▴' : '▾'}</span>
                </button>
                {triageDrawerOpen ? (
                  <ul className="home-drawer-list">
                    {triageHandled.map((handoff) => (
                      <li key={handoff.id}>
                        <span className="home-drawer-item">{handoff.action}</span>
                        <button type="button" className="lite-btn lite-btn--ghost" onClick={() => restoreTriage(handoff.id)}>
                          {t.lite2.triageRestoreLabel}
                        </button>
                      </li>
                    ))}
                    {triageSetAside.map((handoff) => (
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
            {/* ── ② 差距摘要（棒D 立摘要形态；#63 把「值得注意」整屏并进来，原地展开）────
                她的 /gaps 差距卡把「自报 vs 观察」做成对照双列——这是这个概念的视觉语法。主页右轨
                是摘要位（空间窄），默认不整卡照搬，但对齐她的语法：section-label 小标题 + 每条
                「自报 / 观察」两侧带标签的证据 + 项目归属。
                #63（浅合拍板，推翻 feat-057「7 分屏全保留」之 closerlook 一屏）：tab 退了之后
                这里就是对照卡唯一的家——头部链接从「跳去那一屏」换成「原地展开」，展开态渲染
                完整对照卡（.lite-gap-card 家族类名原样保留，B/C 组门的选择器合同不破）。
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
                {gapsTotal > 0 ? (
                  <button
                    type="button"
                    className="lite-home-block-link lite-home-gap-expand"
                    aria-expanded={gapsOpen}
                    onClick={() => setGapsOpen((open) => !open)}
                  >
                    {gapsOpen ? t.lite2.homeGapsCollapse : t.lite2.homeGapsExpand}{' '}
                    <span aria-hidden="true">{gapsOpen ? '▴' : '▾'}</span>
                  </button>
                ) : null}
              </div>
              {gapsTotal === 0 ? (
                <p className="lite-home-quiet">{t.lite2.homeGapsEmpty}</p>
              ) : gapsOpen ? (
                <>
                  {/* ── 展开态 = 原「值得注意」屏的正文（#63 迁入，DOM 类名逐字保留）─────
                      对照卡（claim/evidence 双栏 + 负责人 + 四动作）→ 实时预告 → 历史折叠。
                      key 带下标：跨文档重复项目会产出同 id 的 gap（后端 issue #10），裸 id 撞键；
                      data-gap-id 仍是裸 id——门按它找卡（assertGapsResolve），别把下标混进去。 */}
                  {gapsActive.length > 0 ? (
                    <ol className="lite-gap-list">
                      {gapsActive.map((gap, idx) => (
                        <li key={`${gap.id}_${idx}`} className="lite-gap-card" data-gap-id={gap.id}>
                          <div className="lite-gap-compare">
                            <div className="lite-gap-pane lite-gap-pane-claim">
                              <p className="lite-badge lite-gap-pane-label">{t.lite2.gapCardClaimLabel}</p>
                              <p className="lite-gap-pane-text">{gapClaimText(gap, t.lite2)}</p>
                            </div>
                            <div className="lite-gap-pane lite-gap-pane-evidence">
                              <p className="lite-badge lite-gap-pane-label">{t.lite2.gapCardEvidenceLabel}</p>
                              <p className="lite-gap-pane-text">{gap.evidence}</p>
                            </div>
                          </div>
                          <div className="lite-gap-meta">
                            <button
                              type="button"
                              className="lite-gap-project-link"
                              onClick={() => openDetail('project', gap.projectId)}
                            >
                              <span className="lite-gap-project-title">{gap.projectTitle}</span> →
                            </button>
                            <span className="lite-gap-owner">
                              {/* 兜底在渲染层（Blockers 5c）：gapDerive 透传的是原值或空串。 */}
                              {t.lite2.gapOwnerPrefix} {gap.ownerName || t.lite2.projectsUnknownValue}
                            </span>
                          </div>
                          <div className="lite-gap-actions">
                            <button type="button" className="lite-btn lite-btn--primary lite-gap-resolve" onClick={() => resolveGap(gap.id)}>
                              {t.lite2.gapResolveLabel}
                            </button>
                            <button type="button" className="lite-btn lite-btn--ghost lite-gap-dismiss" onClick={() => dismissGap(gap.id)}>
                              {t.lite2.gapDismissLabel}
                            </button>
                            <button type="button" className="lite-btn lite-btn--ghost lite-gap-ask" onClick={() => handleGapAsk(gap)}>
                              {t.lite2.gapAskLabel} ↗
                            </button>
                            <button
                              type="button"
                              className="lite-btn lite-btn--soft lite-gap-addfollowup"
                              disabled={gapFollowupIds.has(gap.id)}
                              onClick={() => handleGapAddFollowup(gap)}
                            >
                              {gapFollowupIds.has(gap.id) ? t.lite2.followupAdded : t.lite2.gapAddFollowupLabel}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <section className="lite-gap-empty" aria-label={t.lite2.gapEmptyAria}>
                      <h2>{t.lite2.gapEmptyTitle}</h2>
                      <p>{t.lite2.gapEmptyBody}</p>
                    </section>
                  )}

                  {/* 0721 对齐棒 · Danny 2C 拍板：实时分析不做名字（现功能是离线文档对照），
                      页内用条件时态预告「连接公司数据后变实时」。随 #63 原样迁入。 */}
                  <aside className="lite-gap-realtime-note" data-realtime-note="">
                    <p className="lite-gap-realtime-title">{t.lite2.gapRealtimeTitle}</p>
                    <p className="lite-gap-realtime-body">{t.lite2.gapRealtimeBody}</p>
                  </aside>

                  {gapHistoryCount > 0 ? (
                    <section className="lite-gap-history">
                      <button
                        type="button"
                        className="lite-gap-history-toggle"
                        aria-expanded={gapHistoryOpen}
                        onClick={() => setGapHistoryOpen((open) => !open)}
                      >
                        {t.lite2.gapHistoryToggleLabel} · {gapHistoryCount}
                        <span aria-hidden="true">{gapHistoryOpen ? '▴' : '▾'}</span>
                      </button>
                      {gapHistoryOpen ? (
                        <ul className="lite-gap-history-list">
                          {gapsResolved.map((gap) => (
                            <li
                              key={gap.id}
                              className="lite-gap-history-item"
                              data-gap-id={gap.id}
                              data-gap-status="resolved"
                            >
                              <span className="lite-gap-history-title">{gap.projectTitle}</span>
                              <span className={classNames(['lite-badge', 'lite-gap-history-badge', 'is-resolved'])}>
                                {t.lite2.gapResolvedBadge}
                              </span>
                              <button type="button" className="lite-btn lite-btn--ghost lite-gap-restore" onClick={() => restoreGap(gap.id)}>
                                {t.lite2.gapRestoreLabel}
                              </button>
                            </li>
                          ))}
                          {gapsDismissed.map((gap) => (
                            <li
                              key={gap.id}
                              className="lite-gap-history-item"
                              data-gap-id={gap.id}
                              data-gap-status="dismissed"
                            >
                              <span className="lite-gap-history-title">{gap.projectTitle}</span>
                              <span className={classNames(['lite-badge', 'lite-gap-history-badge', 'is-dismissed'])}>
                                {t.lite2.gapDismissedBadge}
                              </span>
                              <button type="button" className="lite-btn lite-btn--ghost lite-gap-restore" onClick={() => restoreGap(gap.id)}>
                                {t.lite2.gapRestoreLabel}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </section>
                  ) : null}
                </>
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
                    <ul className="lite-home-gap-list" key={gapFilter}>
                      {/* 摘要只列前三条，细节在「多看一眼」屏。 */}
                      {/* key=gapFilter：换态即重挂，重放 lite-home-gap-list-in 淡入（动效债·三态切换）。 */}
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
  // B2b（#56）· 冲突命中的「可能只是叫法不同」出口。🔴 零新状态机制：直接复用 gapMarks 那本
  // 分桶账（flowStore 的 dismiss/restore + resetFlowCompanyScope 清扫全部免费继承）；
  // 键带 `conflict_` 前缀，与差距卡的 `gap_` 前缀天然不撞。
  const gapMarks = useFlow((s) => s.gapMarks)
  const dismissGap = useFlow((s) => s.dismissGap)
  const restoreGap = useFlow((s) => s.restoreGap)

  // 机器键 → 中文/英文字段名。后端 unknown_fields / unparsed_fields 只发机器键
  // （'status'|'progress'|'dueDate'|'blockers'）；认不出的键原样显示
  // （宁可露出机器键，也不假装认识它——编一个字段名比露出 camelCase 难看得多）。
  const fieldLabel = (field: string): string => fieldLabelOf(t, field)

  // ADR-0033：规则版的那句话在这里成形。后端只发结构化事实（grade + 命中规则），
  // 句子由 i18n 模板拼——同一句话两种语言，一个事实源。
  // Avery 自己写的那句（reason_source==='avery'）原样显示：它的语言由请求 locale 决定，
  // 已经写进 prompt 了（avery/locale.py::language_instruction）。
  const reasonText =
    card.reason_source === 'avery' && card.reason
      ? card.reason
      : composeRuleReason(t, card)

  return (
    <li
      className={classNames(['lite-card', 'lite-home-decision', `home-tone-${gradeTone(card.grade)}`])}
      data-decision-grade={card.grade}
      data-decision-severity={card.severity}
    >
      <div className="lite-home-decision-head">
        {/* 用户面只显示档位词，不显示 high_risk 这类机器键。ADR-0033 后词由 i18n 表出。 */}
        <span className="lite-home-decision-grade">{gradeLabelOf(t, card.grade)}</span>
        <h3 className="lite-home-decision-title">{card.subject_title}</h3>
        {card.owner_name ? (
          <span className="lite-home-decision-owner">
            {t.lite2.homeDecisionOwner} {card.owner_name}
          </span>
        ) : null}
      </div>

      <p className="lite-home-decision-reason">{reasonText}</p>
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
          {t.lite2.homeDecisionUnknownLabel}
          {t.lite2.labelSep}
          {card.unknown_fields.map(fieldLabel).join(t.lite2.listJoin)}
        </p>
      ) : null}
      {card.unparsed_fields.length > 0 ? (
        <ul className="lite-home-decision-unparsed">
          {card.unparsed_fields.map((item) => (
            <li key={item.field}>
              {/* ADR-0033：字段名从 i18n 表出（后端不再发 field_label）；
                  `raw` 是文档原文，**永远原样**，不翻译。 */}
              {fill(t.lite2.homeDecisionUnparsed, {
                field: fieldLabel(item.field),
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
          {card.matched_rules.map((hit) => {
            /* ADR-0033：规则的标题/依据由 i18n 表按 rule_id 出，阈值占位符用命中自带的 params 填。
               `rule_id` 本身仍原样露出——它是给经理引用的编号，不是文案。 */
            const ruleText = ruleTextOf(t, hit)
            /* B2b（#56）· 冲突类命中：证据行是「每个读数一行」（verbatim 原值 + 文件名 + 上传日，
               后端按上传日旧→新排好），渲染成双栏对照——照抄差距卡 claim/observed 的双栏语法，
               不发明新载荷形状（数据仍走 LiveDecisionRuleHit.evidence: string[]）。
               dismiss 键从证据内容派生：读数真变了（新上传改了说法）键就变，冲突自动重新浮出——
               与 gapDerive 的 id 纪律同款（"reappears if the source material genuinely changed"）。 */
            const isConflict = CONFLICT_RULE_IDS.has(hit.rule_id)
            const conflictKey = isConflict
              ? `conflict_${card.subject_id}_${hit.rule_id}_${hit.evidence.join('|')}`
              : ''
            const conflictSetAside = isConflict && gapMarks[conflictKey] === 'dismissed'
            return (
            <li key={hit.rule_id} className="lite-home-rule">
              <div className="lite-home-rule-head">
                <span className="lite-home-rule-id">{hit.rule_id}</span>
                <span className="lite-home-rule-title">{ruleText.title}</span>
                <span className="lite-home-rule-grade">{gradeLabelOf(t, hit.grade)}</span>
              </div>
              <p className="lite-home-rule-basis">
                {t.lite2.homeDecisionRuleBasis}
                {t.lite2.labelSep}
                {ruleText.basis}
              </p>
              {hit.evidence.length > 0 && !conflictSetAside ? (
                <>
                  {/* 证据必须自报出处：下面这几行是文档原文，不是 Avery 的话。
                      🔴 原文语言 ≠ 界面语言：中文文档在英文界面下仍是中文原样，永不翻译
                      （ADR-0033 决定 4 ← ADR-0018 可溯源红线）。 */}
                  <p className="lite-home-evidence-label">{t.lite2.homeDecisionEvidenceLabel}</p>
                  <ul
                    className={classNames([
                      'lite-home-rule-evidence',
                      isConflict && 'lite-home-rule-evidence--split',
                    ])}
                  >
                    {hit.evidence.map((line, idx) => (
                      <li key={`${hit.rule_id}_${idx}`}>{line}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {isConflict ? (
                conflictSetAside ? (
                  /* 收起 ≠ 消灭：等级是后端规则算的，前端绝不因此改档（下调无门，含前门）。
                     这里只收起证据面 + 记一笔经理的判断，原文一字未动、随时可恢复。 */
                  <p className="lite-home-conflict-setaside">
                    {t.lite2.homeConflictDismissedNote}
                    <button
                      type="button"
                      className="lite-btn lite-btn--ghost lite-home-conflict-restore"
                      onClick={() => restoreGap(conflictKey)}
                    >
                      {t.lite2.homeConflictRestore}
                    </button>
                  </p>
                ) : (
                  /* ADR-0018 措辞：这不是错误提示，是请经理确认——绝不说「你写错了」。 */
                  <button
                    type="button"
                    className="lite-btn lite-btn--ghost lite-home-conflict-dismiss"
                    onClick={() => dismissGap(conflictKey)}
                  >
                    {t.lite2.homeConflictDismiss}
                  </button>
                )
              ) : null}
            </li>
            )
          })}
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
