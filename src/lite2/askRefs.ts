// #64 · 议事室 @ 引用——候选检索 / 织文兜底 / 中继编解码（纯函数层，零 React 零网络）。
//
// 交互考古自 7b03982^ 的 LiteComposer（feat-024 正版替身，#47 退役时没搬进悬浮胶囊，
// 功能自 2026-07-22 丢失）——**抄交互不抄提交层**：旧提交层只把引用织进 situation 文字；
// 本票拍板「一步到位结构化」，refs 以 `AdviseRequest.references[]` 进契约，织文降级为
// 「新前端 + 旧后端」窗口期的兜底（旧后端静默忽略 references，答案不比今天差）。
//
// 🔴 三条纪律（沿 searchDerive.ts 那三条，逐字适用）：
//   ① 判据吃**原值**（ownerNameRaw 由 searchTeam 内部处理），本地化兜底归渲染层；
//   ② absent≠none：缺失字段贡献空串，不是默认文案；
//   ③ 结果零数字：label/meta 只有名字与定性词。

import type { LiteTeam } from './teamData'
import type { AdviseReference, AdviseReferenceKind, LiveFileEntry, LivePlaybookCard } from './transport'
import { searchTeam } from './searchDerive'

export type AskRefKind = AdviseReferenceKind
export type AskRefFilter = 'all' | AskRefKind

export interface AskRef {
  kind: AskRefKind
  // person/project = 实体 id；file = 文件名（source_documents 的展示键）；playbook = 标题
  //（方法卡契约里没有 id，标题就是它的稳定键——同 PlaybooksScreen 的 key 口径）。
  id: string
  label: string
  // 展示次串（原值，可空串）：人=角色、项目=负责人原值、方法=适用行。渲染层对空串自己兜底。
  meta: string
  // 重名消歧：仅当**真有重名**时 = 部门原值（FilesScreen dupeNames 口径——不重名补了只是噪音）。
  dupeTeam: string
}

// 候选上限：与 LiteSearch 的 MAX_RESULTS 同一个量级——引用菜单是挑一个，不是浏览全库。
export const MAX_REF_OPTIONS = 8

/**
 * 四类 @ 候选的统一检索。空 query = 返回全量（浏览语义，旧引用菜单的既有行为）。
 * person/project 走公共 selector `searchTeam`（顶栏搜索同源——同一个词两处同一个结果）；
 * file/playbook 是新增轴，同一套 `includes` 口径。
 */
export function searchAskRefs(
  team: LiteTeam | null,
  files: LiveFileEntry[],
  playbooks: LivePlaybookCard[],
  query: string,
  filter: AskRefFilter = 'all',
): AskRef[] {
  const q = query.trim().toLowerCase()
  const out: AskRef[] = []

  if (filter === 'all' || filter === 'person' || filter === 'project') {
    // 重名集合按**全量花名册**算，不按检索结果算——搜"林"只出一个林小满时，
    // 部门照样要挂（另一个林小满只是没被这次搜出来，重名这个事实没变）。
    const dupeNames = new Set(
      (team?.people ?? []).map((p) => p.name).filter((n, i, all) => all.indexOf(n) !== i),
    )
    const teamKind = filter === 'all' ? 'all' : filter
    for (const r of searchTeam(team, q, teamKind)) {
      const person = r.kind === 'person' ? (team?.people ?? []).find((p) => p.id === r.id) : undefined
      out.push({
        kind: r.kind,
        id: r.id,
        label: r.label,
        meta: r.meta,
        dupeTeam: person && dupeNames.has(person.name) ? (person.team ?? '') : '',
      })
    }
  }

  if (filter === 'all' || filter === 'file') {
    for (const f of files) {
      if (!q || f.filename.toLowerCase().includes(q)) {
        out.push({ kind: 'file', id: f.filename, label: f.filename, meta: '', dupeTeam: '' })
      }
    }
  }

  if (filter === 'all' || filter === 'playbook') {
    for (const pb of playbooks) {
      const hay = `${pb.title} ${pb.description ?? ''} ${(pb.tags ?? []).join(' ')}`.toLowerCase()
      if (!q || hay.includes(q)) {
        out.push({
          kind: 'playbook',
          id: pb.title,
          label: pb.title,
          meta: pb.description ?? '',
          dupeTeam: '',
        })
      }
    }
  }

  return out
}

/**
 * 织文兜底（与旧 LiteComposer 同构）：引用标签接在问题文字后面。
 * 🔴 这不是装饰——「新前端 + 旧后端」的窗口里 references[] 会被静默忽略，这几个字就是
 * 具名实体帮 recall 命中语料行的全部机制；同时它进 advise_runs.question，历史里能看见
 * 这次问题带了谁。prefix/separator 走 i18n（它是用户可见文本，不是协议字段）。
 */
export function weaveRefs(text: string, refs: AskRef[], prefix: string, separator: string): string {
  if (refs.length === 0) return text
  return `${text}\n\n${prefix}${refs.map((r) => r.label).join(separator)}`
}

/** 提交层的契约投影：只送 {kind,id,label} 三键——meta/dupeTeam 是展示态，不进请求体。 */
export function toWireRefs(refs: AskRef[]): AdviseReference[] {
  return refs.map((r) => ({ kind: r.kind, id: r.id, label: r.label }))
}

// ── 悬浮胶囊 → 议事室的中继编解码（`/room?q=<问题>&refs=<JSON>`，两个都是一次性接力参数）──
const REF_KINDS: readonly string[] = ['person', 'project', 'file', 'playbook']

export function encodeRefsParam(refs: AskRef[]): string {
  return JSON.stringify(refs.map((r) => ({ k: r.kind, i: r.id, l: r.label, t: r.dupeTeam || undefined })))
}

/** 解不出来 = 空数组（URL 是用户可改的输入，坏形状静默丢弃，绝不炸中继）。 */
export function decodeRefsParam(raw: string | null): AskRef[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: AskRef[] = []
    for (const item of parsed) {
      const o = item as { k?: unknown; i?: unknown; l?: unknown; t?: unknown }
      if (
        typeof o?.k === 'string' && REF_KINDS.includes(o.k) &&
        typeof o.i === 'string' && o.i !== '' &&
        typeof o.l === 'string' && o.l !== ''
      ) {
        out.push({
          kind: o.k as AskRefKind,
          id: o.i,
          label: o.l,
          meta: '',
          dupeTeam: typeof o.t === 'string' ? o.t : '',
        })
      }
    }
    return out
  } catch {
    return []
  }
}
