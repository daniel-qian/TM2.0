// rich-align-0722/04 · team 屏目录形态的筛选派生（纯函数、locale-free）。
//
// 🔴 判据吃 raw 键，不吃渲染文案（同 statusRaw/ownerNameRaw 一贯纪律）：
//   · 组别筛选取 `person.team`（文档自述的部门原文）——空/缺席归「未分组」桶，key 用原文本身。
//   · 情绪筛选取 `person.selfReport?.mood?.value`（归一枚举 steady/stretched/strained/other）——
//     只有开关开、后端投影了 self_report 时人卡才带 mood；开关关整个情绪 facet 不产生（调用方据
//     scoringEnabled 决定渲不渲染 mood chip 行）。
//
// 裁决（PRD C 节 / ADR-0023）：chip 是**筛选**不是**横向比较**——facet 只回 key+count，
// 不排序、不打分。组别 count 可做徽章；情绪 count **不可**做徽章（跨人计数读作分数并列），
// 所以 MoodFacet 也带 count 只为调用方判空，渲染层不得把它印成徽章。

import type { LitePerson } from './teamData'

export const GROUP_ALL = 'all'
export const GROUP_UNGROUPED = '__ungrouped__'
export const MOOD_ALL = 'all'

export interface GroupFacet {
  // 'all' | '__ungrouped__' | <部门原文>。label 由调用方按当前字典成句（all/ungrouped 走 i18n，
  // 部门桶 label 即 key 本身——文档原文，不翻译）。
  key: string
  count: number
}

export interface MoodFacet {
  // 'steady' | 'stretched' | 'strained' | 'other'。label 走 i18n mood 词表（渲染层）。
  key: string
  count: number
}

function teamKey(person: LitePerson): string {
  const t = person.team?.trim()
  return t ? t : GROUP_UNGROUPED
}

// 组别 facet：全部桶恒在（count=总人数）+ 各部门桶（首次出现次序）+ 未分组桶沉底。
export function deriveGroupFacets(people: LitePerson[]): GroupFacet[] {
  const counts = new Map<string, number>()
  const order: string[] = []
  for (const p of people) {
    const k = teamKey(p)
    if (!counts.has(k)) {
      counts.set(k, 0)
      order.push(k)
    }
    counts.set(k, (counts.get(k) as number) + 1)
  }
  // 未分组桶沉底（有名分的组在前，同 teamGroups 的兜底沉底纪律）。
  order.sort((a, b) => {
    const au = a === GROUP_UNGROUPED ? 1 : 0
    const bu = b === GROUP_UNGROUPED ? 1 : 0
    return au - bu
  })
  const facets: GroupFacet[] = [{ key: GROUP_ALL, count: people.length }]
  for (const k of order) facets.push({ key: k, count: counts.get(k) as number })
  return facets
}

// 情绪 facet：只有开关开（scoringEnabled）且有人报了 mood 才产生。全部桶恒在（count=有 mood 的人数），
// 其余按 steady/stretched/strained/other 的稳定词表序（other 沉底）。开关关一律返回空数组。
const MOOD_ORDER = ['steady', 'stretched', 'strained', 'other']

export function deriveMoodFacets(people: LitePerson[], scoringEnabled: boolean): MoodFacet[] {
  if (!scoringEnabled) return []
  const counts = new Map<string, number>()
  let total = 0
  for (const p of people) {
    const m = p.selfReport?.mood?.value
    if (!m) continue
    counts.set(m, (counts.get(m) ?? 0) + 1)
    total += 1
  }
  if (total === 0) return []
  const facets: MoodFacet[] = [{ key: MOOD_ALL, count: total }]
  for (const m of MOOD_ORDER) {
    if (counts.has(m)) facets.push({ key: m, count: counts.get(m) as number })
  }
  return facets
}

// 双筛选（组别 ∧ 情绪）。不排序——保序即 payload 序（红线：目录不做跨人排序/计分）。
export function filterDirectory(
  people: LitePerson[],
  groupFilter: string,
  moodFilter: string,
): LitePerson[] {
  return people.filter((p) => {
    if (groupFilter !== GROUP_ALL) {
      if (groupFilter === GROUP_UNGROUPED) {
        if (p.team?.trim()) return false
      } else if (p.team?.trim() !== groupFilter) {
        return false
      }
    }
    if (moodFilter !== MOOD_ALL) {
      if (p.selfReport?.mood?.value !== moodFilter) return false
    }
    return true
  })
}
