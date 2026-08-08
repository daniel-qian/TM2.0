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

// 四类的显示优先序 = `pickRefOptions` 轮转发牌的圈序（每圈按这个序各发一条）。
// 下面的中继解码白名单直接由它派生（一把尺——同一份四元组两处各写一份迟早漂）。
export const REF_KIND_ORDER: readonly AskRefKind[] = ['person', 'project', 'file', 'playbook']

// 重名集合按**全量花名册**算，不按检索结果算——搜"林"只出一个林小满时，部门照样要挂
//（另一个林小满只是没被这次搜出来，重名这个事实没变）。
function dupeNamesOf(team: LiteTeam | null): Set<string> {
  return new Set((team?.people ?? []).map((p) => p.name).filter((n, i, all) => all.indexOf(n) !== i))
}

// ── #67 · AskRef 构造的唯一一份尺 ─────────────────────────────────────────────
// 弹层候选（searchAskRefs）与所有预填入口（人卡/项目卡/差距卡/分诊卡/决策卡的「去问
// Avery」）都从这两个构造器拿五元组——label/meta/dupeTeam 的口径天然同源，调用点不许
// 手拼（一处拼错就是第二把尺）。按 id 查 store.team（弹层检索的同一份数据面）；查不到
//（归档/停用/悬空 id）返回 null：调用点退回纯文字预填，绝不硬造 chip——与后端对悬空
// 引用「诚实 not-found」同一条纪律。

export function refOfPerson(team: LiteTeam | null, personId: string): AskRef | null {
  const person = (team?.people ?? []).find((p) => p.id === personId)
  if (!person) return null
  return {
    kind: 'person',
    id: person.id,
    label: person.name,
    meta: person.role,
    dupeTeam: dupeNamesOf(team).has(person.name) ? (person.team ?? '') : '',
  }
}

export function refOfProject(team: LiteTeam | null, projectId: string): AskRef | null {
  const project = (team?.projects ?? []).find((p) => p.id === projectId)
  if (!project) return null
  // meta = ownerName（原值，缺失空串）——searchTeam 给候选的同一格（纪律①归渲染层兜底）。
  return { kind: 'project', id: project.id, label: project.title, meta: project.ownerName, dupeTeam: '' }
}

/**
 * 决策卡主体 → AskRef。kind 走映射不走字面量：transport 的 subject_type 今天恒 'project'
 *（LiveDecisionCard），将来长出新主体类型时这里返回 null（入口不带 chip）、后端对未知
 * kind 也是既有跳过逻辑——两层都不用改调用点。
 */
export function refOfSubject(team: LiteTeam | null, subjectType: string, subjectId: string): AskRef | null {
  if (subjectType === 'person') return refOfPerson(team, subjectId)
  if (subjectType === 'project') return refOfProject(team, subjectId)
  return null
}

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
    const teamKind = filter === 'all' ? 'all' : filter
    // 命中判定归 searchTeam（顶栏同源）；五元组构造归 refOf*（#67 起预填入口共用的那把尺，
    // 弹层候选走同一个构造器＝两处永不漂移）。
    for (const r of searchTeam(team, q, teamKind)) {
      const ref = r.kind === 'person' ? refOfPerson(team, r.id) : refOfProject(team, r.id)
      if (ref) out.push(ref)
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
 * #70 · 候选上限内的**公平露出**：把 `searchAskRefs` 的全量结果收敛到 `limit` 条。
 *
 * 🔴 病根（0808 演习实收）：`searchAskRefs` 的追加顺序是 person/project → file → playbook，
 * 调用点再 `slice(0, MAX_REF_OPTIONS)`。16 人 8 项目的真实团队里，8 个名额在第一类就被吃光——
 * 「全部」视图**永远看不到文件和方法卡**，只有点「文件」筛选 chip 才露头。Danny 演习里
 * 「提问的时候没办法引用文件对吧」问的就是这个：功能一直在，可发现性是零。
 *
 * 为什么不是「把 8 调大」：弹层高度有限（#66 刚为它做完可用空间感知 + 列表钳高），
 * 拉高上限只是把溢出问题换个地方长；名额稀缺是前提，要改的是**怎么分**。
 *
 * 分法 = 按 `REF_KIND_ORDER` **轮转**发牌：一圈每类各一条，某类发完就跳过它，名额自动回流给
 * 还有货的类目。只有一类有候选时（= 每个筛选 chip 视图）轮转退化成 slice，**逐条与旧行为相同**。
 *
 * 🔴 为什么是交错而不是「先算名额、再按类目成块吐」：弹层列表被 #66 钳在 240px（矮视口更狠，
 * 地板 72px），一屏只看得见 4–5 行。成块吐出时文件是第三块——名额给到了，人却还是要滚动才
 * 看得见，"可发现性"只修了一半。交错让**前四行就把四类都摆出来**，不滚即见。候选行在「全部」
 * 视图本来就带类目词（AskRefComposer 的 .lite-ref-option-kind），混排读得出来。
 *
 * 总数没超上限时原样返回：装得下就不该重排（旧行为逐条保持）。
 */
export function pickRefOptions(refs: AskRef[], limit: number = MAX_REF_OPTIONS): AskRef[] {
  if (limit <= 0) return []
  if (refs.length <= limit) return refs

  const buckets = REF_KIND_ORDER.map((kind) => refs.filter((r) => r.kind === kind))
  const out: AskRef[] = []
  for (let round = 0; out.length < limit; round += 1) {
    let dealt = false
    for (const bucket of buckets) {
      if (out.length >= limit) break
      if (round < bucket.length) {
        out.push(bucket[round])
        dealt = true
      }
    }
    // 一圈一条都发不出去 = 所有类目都发完了。refs.length > limit 时到不了这里，但没有这个
    // 出口，未知 kind（不在 REF_KIND_ORDER 里、被 buckets 漏掉）会让循环空转成死循环。
    if (!dealt) break
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
const REF_KINDS: readonly string[] = REF_KIND_ORDER

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
