import type { LiveFieldProvenance, LivePersonCard, LiveProjectCard } from './transport'
import type { Dict } from '../shared/i18n'

// feat-055（PRD G9）· 项目屏的「已知 / 文档未提及」派生层。
//
// ## 为什么需要这一层
// 实测真 payload 的字段覆盖率极不均匀：title/summary 17/17 · owner 16/17 ·
// status/blockers 13/17 · **dueDate 7/17 · progress 6/17**。进度和到期只有三分之一有值。
// 🔴 把缺失渲染成 `0%` 或空白，等于把「文档没说」错报成「没有进展」——在客户自己的文档
// 面前当场自证不可信。所以本模块把「后端没发这个键」提升成一个**显式的 null**，UI 只能
// 二选一：要么显真值，要么显「文档未提及」，没有第三条路。
//
// ## 为什么读 rawTeam 而不是 team
// `teamData.ts` 的 `liteTeamFromPayload()` 曾经给缺失字段填了兜底默认值
//（`status ?? 'on-track'` · `ownerName ?? 'Unassigned'`）——那两个默认值一旦落地就再也
// 分不出「文档说在推进」和「文档没写状态」。后端的 `project_cards()` 是**缺就不发这个键**
//（registry.py：`if pr.status: card["status"] = ...`），所以原始 payload 才是唯一能分辨
// 已知与未知的地方。本模块因此只吃 `LiveProjectCard`，不吃 `LiteProject`。
//
// 07-19 更新：那两个兜底都已经改掉了（各自留了 `statusRaw` / `ownerNameRaw` 作判据）。
// 07-20 再更新（Blockers 5c）：`LiteProject` 上的 `status`/`ownerName` 一度装的是**已本地化的
// 渲染文案**，拿它当判据一样错——只是错法从「谎称正常」变成「把一句兜底文案当值」；语言开关
// 上线后更暴露出第三种错法：那句文案在取数期就焊死了语言，切语言后不跟着变。现在它们已经
// 降级成「原值或空串」，兜底文案归渲染层。
// **本模块的存在理由不变**：判已知/未知仍然只认原始 payload——空串虽然比一句兜底文案好读，
// 但 `''` 与「文档确实写了空状态」在 LiteProject 这一层依旧分不开，只有原始 payload 分得开。

/** 后端归一化后的状态词表（extract.py `_normalize_status` / llm_extract `_ALLOWED_STATUS`）。 */
export type ProjectStatusKey = 'blocked' | 'at-risk' | 'on-track' | 'done' | 'other' | 'unknown'

/** 看板分组。只渲染非空的组——1 个项目也不会剩下一排空栏（PRD G9「极少态要体面」）。 */
export type ProjectGroupKey = 'needsYou' | 'moving' | 'done' | 'other' | 'unknown'

/**
 * 一个项目在 UI 侧的完整事实。
 * 🔴 口径：`null` 一律读作「文档未提及」，**绝不是 0、不是空、不是默认值**。
 * `blockers` 用空数组而不是 null —— 后端只在 `pr.blockers` 非空时才发这个键，缺席与空列表
 * 无法区分，所以这里统一按「没有列出卡点」呈现，不谎称「文档没写」。
 */
/** 项目级风险等级（PRD A1，rich-align-0722/01）。词表外由后端整行不抽，这里只认三档。 */
export type RiskLevelKey = 'high' | 'medium' | 'low'

/** 里程碑状态（PRD A1，rich-align-0722/02）。四态 + other（词表外，statusRaw 回显原词）。 */
export type MilestoneStatusKey = 'done' | 'active' | 'blocked' | 'upcoming' | 'other'

export interface MilestoneView {
  name: string
  status: MilestoneStatusKey
  /** 仅 status==='other' 时非空：文档原状态词，原样回显。 */
  statusRaw: string | null
}

export interface ProjectView {
  id: string
  title: string
  summary: string | null
  ownerName: string | null
  statusKey: ProjectStatusKey
  /** 状态原文。只在 statusKey==='other'（词表外的值）时用来照原样显示，不改写文档用词。 */
  statusRaw: string | null
  progress: number | null
  dueDate: string | null
  blockers: string[]
  /** 🔴 null = 文档未提及风险 = 整个风险徽章收起（absent≠none）。绝不渲染成「无风险 / low」。 */
  riskLevel: RiskLevelKey | null
  /** 风险原因原文（文档原句，原样回显）；null = 文档没给原因（等级仍可单独显示）。 */
  riskReason: string | null
  /** 🔴 空数组 = 文档没写里程碑 = chips 行与详情段整体收起（absent≠none）。 */
  milestones: MilestoneView[]
  /**
   * rich-align-0722/05a：字段级出处 side-car（key=字段名 title/ownerName/status/dueDate/summary/
   * progress/blockers/risk/milestones）。缺席=纯文档抽取卡（provenanceOf 返回 undefined → 不挂角标）。
   * 🔴 只用于详情浮层逐字段「手动编辑」角标；判据不进 riskLevel/progress 等真值派生（那些仍只认原始值）。
   */
  provenance: Record<string, LiveFieldProvenance>
}

/** 某字段是否为人手编（origin==='manual'）。缺席/doc/form 出处 → false（不替文档冒充手编）。 */
export function isManualField(view: ProjectView, field: string): boolean {
  return view.provenance[field]?.origin === 'manual'
}

/**
 * 这一格该挂哪种出处角标 —— 只有**不是**「我们从资料里读到的」时候才挂。
 *
 * T5/A2 加了 'form' 之后，`isManualField` 那种二值判断不够用了：`origin==='form'` 既不满足
 * manual、也不该被当成 doc 静默无标——那会让「员工本人这周填的」跟「八周前那份文档里读到的」
 * 在屏幕上长得一模一样。三态显式列出来，新增第四种取值时 TypeScript 会在这里报错，而不是
 * 悄悄落进 `null` 分支。
 */
export function provenanceBadgeKind(
  provenance: Record<string, LiveFieldProvenance> | undefined,
  field: string,
): 'manual' | 'form' | 'doc' | null {
  const origin = provenance?.[field]?.origin
  if (origin === 'manual' || origin === 'form') return origin
  // T10 · 'doc' 出处只有在**补资料**把这一格改写过之后才会存在（首次上传的格子不写侧车），
  // 所以它出现的地方恰好就是「这个读数被一份更新的资料顶掉过」。拍板③ 的后半句「出处指新资料」
  // 就落在这里——不指出来的话，卡上是新值、屏幕上却没有任何东西说明它从哪儿变来的。
  // 🔴 要有 `source` 才挂：没有指针的角标只是一句「来自某份文档」的废话。
  return origin === 'doc' && provenance?.[field]?.source ? 'doc' : null
}

const KNOWN_STATUS = new Set(['blocked', 'at-risk', 'on-track', 'done'])

function statusKeyOf(raw: string | undefined): ProjectStatusKey {
  const value = (raw ?? '').trim().toLowerCase()
  if (!value) return 'unknown'
  if (KNOWN_STATUS.has(value)) return value as ProjectStatusKey
  return 'other'
}

/**
 * 进度：只接受 0–100 的有限数。
 * `0` 是**合法的已知值**（文档真写了 0%）——所以判据是 `typeof === 'number'`，不是真值性。
 * 反过来，NaN / Infinity / 负数 / >100 这类坏值宁可当未知，也不画一条骗人的条。
 */
function progressOf(raw: number | undefined): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  if (raw < 0 || raw > 100) return null
  return raw
}

function trimmedOrNull(raw: string | undefined): string | null {
  const value = (raw ?? '').trim()
  return value ? value : null
}

const KNOWN_RISK = new Set<RiskLevelKey>(['high', 'medium', 'low'])

/**
 * 风险等级：只认 high/medium/low（后端已按 A2 词表归一并对词表外整行不抽）。
 * 拿到别的值宁可当「文档未提及」也不画一个骗人的徽章——与 progressOf 同哲学。
 */
function riskLevelOf(raw: string | undefined): RiskLevelKey | null {
  const value = (raw ?? '').trim().toLowerCase()
  return KNOWN_RISK.has(value as RiskLevelKey) ? (value as RiskLevelKey) : null
}

const KNOWN_MILESTONE = new Set<MilestoneStatusKey>(['done', 'active', 'blocked', 'upcoming', 'other'])

/** 里程碑状态归一：后端已归一到五键，前端只校验；未知一律 other（不猜四态，不改写文档词）。 */
function milestoneStatusKeyOf(raw: string | undefined): MilestoneStatusKey {
  const value = (raw ?? '').trim().toLowerCase()
  return KNOWN_MILESTONE.has(value as MilestoneStatusKey) ? (value as MilestoneStatusKey) : 'other'
}

function milestoneViewsOf(
  raw: readonly { name: string; status: string; statusRaw?: string }[] | undefined,
): MilestoneView[] {
  return (raw ?? [])
    .map((m) => {
      const status = milestoneStatusKeyOf(m.status)
      return {
        name: (m.name ?? '').trim(),
        status,
        // statusRaw 只在 other 时有意义（回显文档原词）；四态里带了也丢掉。
        statusRaw: status === 'other' ? trimmedOrNull(m.statusRaw) : null,
      }
    })
    .filter((m) => m.name)
}

/**
 * 原始项目卡 → UI 事实。`people` 只用来把 `ownerId` 翻成人名（与 teamData 同口径），
 * 查不到就是 null（「文档没说是谁」），绝不写「未分配」这种听起来像管理判断的词。
 */
export function buildProjectViews(
  cards: readonly LiveProjectCard[] | null | undefined,
  people: readonly LivePersonCard[] | null | undefined,
): ProjectView[] {
  const nameById = new Map<string, string>()
  for (const person of people ?? []) {
    const name = trimmedOrNull(person.name)
    if (person.id && name) nameById.set(person.id, name)
  }

  return (cards ?? []).map((card) => ({
    id: card.id,
    title: trimmedOrNull(card.title) ?? card.id,
    summary: trimmedOrNull(card.summary),
    ownerName:
      trimmedOrNull(card.ownerName) ??
      (card.ownerId ? nameById.get(card.ownerId) ?? null : null),
    statusKey: statusKeyOf(card.status),
    statusRaw: trimmedOrNull(card.status),
    progress: progressOf(card.progress),
    dueDate: trimmedOrNull(card.dueDate),
    blockers: (card.blockers ?? []).map((b) => b.trim()).filter(Boolean),
    // 🔴 缺席=文档未提及=徽章收起：只有 card.risk 存在且 level 在词表内才给 riskLevel，禁 ?? 默认。
    riskLevel: riskLevelOf(card.risk?.level),
    riskReason: trimmedOrNull(card.risk?.reason),
    milestones: milestoneViewsOf(card.milestones),
    // rich-align-0722/05a：出处 side-car 原样透传（缺席=空 dict → isManualField 恒 false）。
    provenance: card.provenance ?? {},
  }))
}

/** 里程碑状态 → 人话标签。other 回显文档原词（不改写）。卡面 chips 与详情清单共用一份口径。 */
export function milestoneStatusLabel(m: MilestoneView, l: Dict['lite2']): string {
  switch (m.status) {
    case 'done':
      return l.projectsMilestoneDone
    case 'active':
      return l.projectsMilestoneActive
    case 'blocked':
      return l.projectsMilestoneBlocked
    case 'upcoming':
      return l.projectsMilestoneUpcoming
    default:
      return m.statusRaw ?? l.projectsMilestoneOther
  }
}

/** 风险等级 → 人话标签。项目屏卡面与详情浮层共用一份口径。 */
export function projectRiskLabel(level: RiskLevelKey, l: Dict['lite2']): string {
  switch (level) {
    case 'high':
      return l.projectsRiskHigh
    case 'medium':
      return l.projectsRiskMedium
    case 'low':
      return l.projectsRiskLow
  }
}

/**
 * 状态 → 人话标签。项目屏和项目详情浮层共用同一份口径（两处显示同一个项目时不许说法不一致）。
 * 词表外的值（statusKey==='other'）照原样回显文档用词——不替客户的文档改写措辞。
 * 只吃 `t.lite2` 这一段字典，是普通属性读取；本模块不 import 任何组件/store。
 */
export function projectStatusLabel(view: ProjectView, l: Dict['lite2']): string {
  return statusTokenLabel(view.statusKey, l, view.statusRaw)
}

/**
 * 归一化状态词 → 屏幕文案。#85 的补料流水要给**旧值**（`lineage.prev.value`，一个裸 token
 * 如 `'on-track'`）配文案，而它手上没有 `ProjectView`。
 *
 * 🔴 抽出来是为了**只留一把尺**：流水里那句「从 进行中 改成 受阻」与项目卡上那枚状态标必须
 * 逐字同词。各写一份的下场是同一个 token 在两块屏上叫两个名字。
 * `raw` 只在词表外（`other`）时用来照原样回显文档用词，与 `statusRaw` 同一条口径。
 */
export function statusTokenLabel(
  key: ProjectStatusKey, l: Dict['lite2'], raw?: string | null,
): string {
  switch (key) {
    case 'blocked':
      return l.projectsStatusBlocked
    case 'at-risk':
      return l.projectsStatusAtRisk
    case 'on-track':
      return l.projectsStatusOnTrack
    case 'done':
      return l.projectsStatusDone
    case 'unknown':
      return l.projectsStatusUnknown
    default:
      return raw ?? l.projectsStatusUnknown
  }
}

/** 裸状态串（payload 或 `lineage.prev.value` 里那个）→ 屏幕文案。空串按「未知」。 */
export function statusTextLabel(raw: string | undefined | null, l: Dict['lite2']): string {
  return statusTokenLabel(statusKeyOf(raw ?? undefined), l, (raw ?? '').trim() || null)
}

export function groupKeyOf(view: ProjectView): ProjectGroupKey {
  switch (view.statusKey) {
    case 'blocked':
    case 'at-risk':
      return 'needsYou'
    case 'on-track':
      return 'moving'
    case 'done':
      return 'done'
    case 'unknown':
      return 'unknown'
    default:
      // 词表外的状态原样单列——塞进「进行中」等于替文档下了个它没下的判断。
      return 'other'
  }
}

/** 组的展示顺序：先要你管的，最后才是「文档没写状态」的那堆。 */
export const GROUP_ORDER: readonly ProjectGroupKey[] = [
  'needsYou',
  'moving',
  'other',
  'unknown',
  'done',
]

export function groupProjects(views: readonly ProjectView[]): { key: ProjectGroupKey; views: ProjectView[] }[] {
  const buckets = new Map<ProjectGroupKey, ProjectView[]>()
  for (const view of views) {
    const key = groupKeyOf(view)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(view)
    else buckets.set(key, [view])
  }
  // 只吐非空组——空组不占版面，也就不存在「必须有一屏卡片才好看」的布局。
  return GROUP_ORDER.filter((key) => (buckets.get(key)?.length ?? 0) > 0).map((key) => ({
    key,
    views: buckets.get(key) ?? [],
  }))
}

/**
 * 覆盖率实况：这批项目里有多少条「文档没写进度 / 没写到期 / 没写状态」。
 * 屏头那句说明直接用这三个数——**真算的，不是写死的**（合伙人参考库那套"扫描了 186 条
 * 信号"式硬编码正是本波明令禁止的）。
 */
export interface ProjectCoverage {
  total: number
  missingProgress: number
  missingDueDate: number
  missingStatus: number
}

export function projectCoverage(views: readonly ProjectView[]): ProjectCoverage {
  return {
    total: views.length,
    missingProgress: views.filter((v) => v.progress === null).length,
    missingDueDate: views.filter((v) => v.dueDate === null).length,
    missingStatus: views.filter((v) => v.statusKey === 'unknown').length,
  }
}

/**
 * #48 · 「带着这个项目去问 Avery」的预填文本。🔴 只拼文档真值（标题 + 第一条阻塞/
 * 风险原因/摘要，按信息量取第一个有的），什么都没有就只带标题——零编造。分隔符必须
 * " — " 而非换行：composer 是 <input type="text">（feat-044 同根 bug）。
 * 项目屏卡面与详情浮层共用这一份——同一个项目两处预填必须一致。
 */
export function projectAskPrefill(view: ProjectView): string {
  const detailBit = view.blockers[0] ?? view.riskReason ?? view.summary ?? ''
  return detailBit ? `${view.title} — ${detailBit}` : view.title
}
