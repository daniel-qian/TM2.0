import type { LivePersonCard, LiveProjectCard } from './transport'
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
// `teamData.ts` 的 `liteTeamFromPayload()` 给缺失字段填了兜底默认值
//（`status ?? 'on-track'` · `ownerName ?? 'Unassigned'`）——那两个默认值一旦落地就再也
// 分不出「文档说在推进」和「文档没写状态」。后端的 `project_cards()` 是**缺就不发这个键**
//（registry.py：`if pr.status: card["status"] = ...`），所以原始 payload 才是唯一能分辨
// 已知与未知的地方。本模块因此只吃 `LiveProjectCard`，不吃 `LiteProject`。
// （teamData 的默认值属于既有行为，别的屏还在用，本条不动它——只是不经过它。）

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
  }))
}

/**
 * 状态 → 人话标签。项目屏和项目详情浮层共用同一份口径（两处显示同一个项目时不许说法不一致）。
 * 词表外的值（statusKey==='other'）照原样回显文档用词——不替客户的文档改写措辞。
 * 只吃 `t.lite2` 这一段字典，是普通属性读取；本模块不 import 任何组件/store。
 */
export function projectStatusLabel(view: ProjectView, l: Dict['lite2']): string {
  switch (view.statusKey) {
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
      return view.statusRaw ?? l.projectsStatusUnknown
  }
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
