// #85 ·「这次补料改了什么」—— 只读流水的**派生层**（Danny 拍板 B 的前半）。
//
// 拍板③（2026-08-07）说的是「补传后**安静更新**、不打扰」，B 说的是「事后查得到」。
// 2026-08-10 定的共存形状：**不弹通知、不占今天页**，只在资料库里有一处可查。本模块就是
// 那一处的数据面——它不产生任何提醒、不参与任何计数徽章之外的东西。
//
// ── 数据从哪儿来：两本 side-car 各答一半，缺一不可 ──────────────────────────────────────
//   · `provenance[f].origin` 答「**这一格现在归谁**」（doc / manual / form，手编赢）。
//     🔴 `stamp()` 只在补传 / 手编 / 表单回流三处开火，**首次 `/ingest` 一个都不写**——所以
//     `origin === 'doc'` 出现的地方精确等于「这个读数被一份更新的资料改过」。这就是本票便宜
//     的全部理由，也是它唯一的入场判据。
//   · `lineage.fields[f]`（#87 建的）答「**它的文档血缘**」：`source` 是引文，`prev.value` 是
//     被顶掉的那个旧读数——「从 X 改成 Y」的前一半。
//   · `lineage.added_in`（#85 加的）答「**这张卡是哪一批补传新建的**」。新卡一格都没被顶掉，
//     provenance 恒空，不靠它就彻底看不见。
//
// ⚠ 票面写的是「加一个 additive 的 `payload["conflicts"]`，旧值只覆盖 3/10 个字段」。#87 在
//   同一天落地了血缘，`prev` 覆盖**全部**文档可写的格子——票面自己写着「要全部字段都给前后值
//   就得等 #87」。所以这里走血缘，不走 conflicts。（另：conflicts 到前端时已经被
//   `_conflict_evidence` 拍平成不带行号的 `string[]`，本来也接不住「可点击引文」。）
//
// ── 三条刻意的边界（都是「宁可不显示，也不显示一句假话」）───────────────────────────────
//  ① **卡上读不出现值的格子不出现**。`dependsOn` 在血缘里跟着，但 `_one_project_card` 从不投
//     它——渲一行「依赖 改成了 X」，用户在任何一块屏上都找不到那个 X。
//  ② **经理手编过的格子掉出清单**（`origin === 'manual'`）。屏上那个值是他自己写的，说成
//     「《某文件》把它改成了 Y」是假话。血缘里的 `prev` 照旧留着（票 7 撤回要用）。
//  ③ **一格只留最近一次**。同一格被两份资料先后改过时，`lineage.fields[f]` 指向最新那份，更早
//     那几次躺在 `prev.prev` 链里。这条流水是「这一格现在为什么是这个值」，不是完整日志——
//     完整日志是票 7（逐条撤回）的形状。
//
// 归档的卡（`archived_people` / `archived_projects`）不进：经理自己收起来的东西不该在别的屏上
// 再冒出来。它们是 payload 上另外两个键，这里不读，就是这条边界的落点。

import type { Dict } from '../shared/i18n'
import { statusTextLabel } from './projectView'
import type { LiveTeamPayload, LivePersonCard, LiveProjectCard } from './transport'

export type ChangeKind = 'updated' | 'filled' | 'added'
export type ChangeSubjectKind = 'person' | 'project'

export interface ChangeRow {
  /** 稳定 id —— 「已查阅」标记按它落 localStorage，必须跨刷新、跨再次上传都算同一条。
   *  🔴 docKey 是 id 的一部分：同一格被**另一份**资料再改一次时，它是**一条新的改动**，
   *  该重新回到未查阅。上一条随 `lineage.fields[f]` 指针一起消失（边界③）。 */
  id: string
  subjectKind: ChangeSubjectKind
  subjectId: string
  subjectName: string
  /** 原始字段名（`ownerName` / `team` / …）。`added` 行没有单格，为空串。 */
  field: string
  kind: ChangeKind
  /** 现值 / 旧值都是 payload 里的**原始**形状（string / number / string[] / 对象）。
   *  🔴 刻意不在派生层成句：拼句要按语言决定顿号与语序（teamData.ts 那条老碑——
   *  `Owns ${...}` 当年把英文烧死进数据，中文构建再也救不回来）。成句在 `changeValueText`。 */
  value: unknown
  prevValue?: unknown
  /** 引文 `<文件名>:<行>`（原样，可点）。 */
  source: string
  docKey: string
  /** 行号；空串 = 这条出处没带行号（不编一个）。 */
  line: string
}

export interface ChangeGroup {
  docKey: string
  rows: ChangeRow[]
}

interface LineageRecord {
  source?: string
  batch_id?: string
  seeded?: boolean
  prev?: { value?: unknown; source?: string; prev?: unknown; truncated?: boolean }
}

interface Lineage {
  docs?: string[]
  fields?: Record<string, LineageRecord>
  added_in?: string
}

/** 与后端 `doc_key_of` 同一把尺：出处串 `<文件名>:<行>` 切出文件名。行号可以没有。 */
export function docKeyOf(source: string): { docKey: string; line: string } {
  const raw = (source ?? '').trim()
  if (!raw) return { docKey: '', line: '' }
  const cut = raw.lastIndexOf(':')
  if (cut <= 0) return { docKey: raw, line: '' }
  const tail = raw.slice(cut + 1).trim()
  if (!/^\d+$/.test(tail)) return { docKey: raw, line: '' }
  return { docKey: raw.slice(0, cut).trim(), line: tail }
}

/**
 * 这一格现在有值吗 —— 「卡上读不出现值就不出现」（边界①）的判据。
 * 🔴 `0` 是合法读数（文档真写了 0%），所以判的是逐类型的空，不是真值性
 * （`progressOf` 那条同族纪律；`!0` 为真会把一条真读数当成缺席）。
 */
function hasReading(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

function lineageOf(card: { lineage?: unknown }): Lineage {
  const lin = card.lineage
  return lin && typeof lin === 'object' && !Array.isArray(lin) ? (lin as Lineage) : {}
}

function originOf(card: { provenance?: Record<string, { origin?: string }> }, field: string): string {
  return card.provenance?.[field]?.origin ?? ''
}

function rowsForCard(
  card: LivePersonCard | LiveProjectCard,
  subjectKind: ChangeSubjectKind,
  subjectName: string,
): ChangeRow[] {
  const lin = lineageOf(card)
  const out: ChangeRow[] = []

  // ① 新建的整张卡。放在逐格之前：它是「这批资料带来了一个新主体」，比某一格改了什么更该先读到。
  if (lin.added_in) {
    // 出处优先取任意一格的血缘记录（那里带行号），退回来源文档集合的第一条（只有文件名）。
    const seeded = Object.values(lin.fields ?? {}).find((rec) => (rec?.source ?? '').trim())
    const source = (seeded?.source ?? lin.docs?.[0] ?? '').trim()
    const { docKey, line } = docKeyOf(source)
    if (docKey) {
      out.push({
        id: `${subjectKind}:${card.id}:+:${docKey}`,
        subjectKind, subjectId: card.id, subjectName, field: '', kind: 'added',
        value: undefined, source, docKey, line,
      })
    }
  }

  for (const [field, rec] of Object.entries(lin.fields ?? {})) {
    // 入场判据：这一格现在由**文档**说了算。首次上传（没有 provenance）与手编/表单（另一种
    // origin）都在这里掉出去——两种掉法的理由不同，见文件头边界②与「便宜的全部理由」。
    if (originOf(card, field) !== 'doc') continue
    const value = (card as unknown as Record<string, unknown>)[field]
    if (!hasReading(value)) continue                       // 边界①
    const { docKey, line } = docKeyOf(rec?.source ?? '')
    if (!docKey) continue                                  // 没有文件名的行只能挂在空标题下
    const prev = rec?.prev
    const hasPrev = !!prev && hasReading(prev.value)
    out.push({
      id: `${subjectKind}:${card.id}:${field}:${docKey}`,
      subjectKind, subjectId: card.id, subjectName, field,
      kind: hasPrev ? 'updated' : 'filled',
      value,
      ...(hasPrev ? { prevValue: prev!.value } : {}),
      source: rec?.source ?? '', docKey, line,
    })
  }
  return out
}

/**
 * 一份 `/team` 载荷 → 按**文件**分组的补料流水。
 *
 * 分组单位是文件而不是批次：引文本来就是逐文件的，而经理心里的单位是「我传的那份纪要」，
 * 不是一个哈希出来的批次号。组的先后由调用方按文件清单的上传时间排（本模块不读文件清单，
 * 免得一条流水的存在与否要等第二个请求回来）。
 */
export function deriveChanges(payload: LiveTeamPayload | null | undefined): ChangeGroup[] {
  if (!payload) return []
  const rows: ChangeRow[] = []
  for (const card of payload.projects ?? []) {
    rows.push(...rowsForCard(card, 'project', card.title))
  }
  for (const card of payload.people ?? []) {
    rows.push(...rowsForCard(card, 'person', card.name))
  }
  const groups = new Map<string, ChangeGroup>()
  for (const row of rows) {
    const hit = groups.get(row.docKey)
    if (hit) hit.rows.push(row)
    else groups.set(row.docKey, { docKey: row.docKey, rows: [row] })
  }
  return [...groups.values()]
}

/** 这条流水一共多少行（左栏那颗计数用；分组只是展示形状，不是计数单位）。 */
export function countChanges(groups: ChangeGroup[]): number {
  return groups.reduce((n, g) => n + g.rows.length, 0)
}

// ── 文案层：raw → 屏幕上的字。派生层一个字都不成句（见 ChangeRow.value 上那条 🔴）─────────

/** 字段名 → 屏幕上叫什么。词表外的字段**回显原始键名**：编一个好看的中文名会让经理去卡上找
 *  一个不存在的栏目。后端加了新的可写字段而这里没跟上时，它长这个样子就是提示。 */
export function changeFieldLabel(field: string, l: Dict['lite2']): string {
  const table: Record<string, string> = {
    role: l.changeFieldRole,
    team: l.changeFieldTeam,
    tenure: l.changeFieldTenure,
    owns: l.changeFieldOwns,
    collaboration: l.changeFieldCollaboration,
    ownerName: l.changeFieldOwner,
    status: l.changeFieldStatus,
    dueDate: l.changeFieldDueDate,
    summary: l.changeFieldSummary,
    progress: l.changeFieldProgress,
    risk: l.changeFieldRisk,
    milestones: l.changeFieldMilestones,
    blockers: l.changeFieldBlockers,
  }
  return table[field] ?? field
}

function riskLabel(level: unknown, l: Dict['lite2']): string {
  switch (String(level ?? '').trim().toLowerCase()) {
    case 'high': return l.projectsRiskHigh
    case 'medium': return l.projectsRiskMedium
    case 'low': return l.projectsRiskLow
    default: return String(level ?? '')
  }
}

function milestoneLabel(item: Record<string, unknown>, l: Dict['lite2']): string {
  const name = String(item.name ?? '').trim()
  const table: Record<string, string> = {
    done: l.projectsMilestoneDone,
    active: l.projectsMilestoneActive,
    blocked: l.projectsMilestoneBlocked,
    upcoming: l.projectsMilestoneUpcoming,
  }
  const raw = String(item.statusRaw ?? '').trim()
  const state = table[String(item.status ?? '')] ?? raw ?? ''
  return state ? `${name}（${state}）` : name
}

/**
 * 一个格子的值（现值或旧值）→ 屏幕上那串字。
 *
 * 🔴 词表字段（`status` / `risk` / `milestones`）必须走**卡片上同一把尺**：旧值在血缘里存的是
 * 归一化后的 token（实测：`prev.value === 'on-track'`）。直接印出来，经理会在流水里读到
 * 「从 on-track 改成 blocked」，而项目卡上写的是「进行中 / 受阻」——同一件事两个说法。
 */
export function changeValueText(field: string, value: unknown, l: Dict['lite2']): string {
  if (value === null || value === undefined) return ''
  if (field === 'status') return statusTextLabel(String(value), l)
  if (field === 'risk' && typeof value === 'object' && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>
    const reason = String(rec.reason ?? '').trim()
    const level = riskLabel(rec.level, l)
    return reason ? `${level} · ${reason}` : level
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) => (
      item && typeof item === 'object'
        ? milestoneLabel(item as Record<string, unknown>, l)
        : String(item ?? '').trim()
    )).filter(Boolean)
    return parts.join(l.changeListJoin)
  }
  if (typeof value === 'number') return field === 'progress' ? `${value}%` : String(value)
  return String(value).trim()
}

/**
 * 显示用截断 —— **按显示宽度**，不按 `.length`。
 * 40 个汉字和 40 个字母在屏幕上差着一倍宽（#69 实收），按 `.length` 截会让中文那一行溢出、
 * 英文那一行早早断掉。CJK/全角按 2 算，其余按 1。
 */
export function clampWidth(text: string, budget = 56): string {
  let used = 0
  let out = ''
  for (const ch of text) {
    const w = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/
      .test(ch) ? 2 : 1
    if (used + w > budget) return `${out}…`
    used += w
    out += ch
  }
  return out
}
