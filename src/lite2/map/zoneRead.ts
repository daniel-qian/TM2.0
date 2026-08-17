// team-map-revival-0804 · B2 · 部门分区的**组级读数**（纯函数、locale-free）。
//
// PRD §3.3 最后一条：部门标签下一句定性短语，**前端从 selfReport 真派生**（liveHandoffs
// 同款零捏造纪律）；组内没有任何自述 → 不显示。
//
// ## 🔴 这里踩着两条红线之间的一条窄路，三个约束缺一不可
//
// ① **零计数**。「3 个人说吃紧」是跨人计数，ADR-0023 / PRD C 节明令禁止（`deriveMoodFacets`
//    的注释写得很直白：情绪 count 不可做徽章——跨人计数读作分数并列）。所以本模块**不返回
//    任何数字**，连「有几个人报了」都不返回。返回的是一个枚举键，文案层拼成「有人自述吃紧」。
//
// ② **不是系统判断，是本人的话**。屏幕上出现的那个词是员工自己在周报里写的（后端归一到
//    steady/stretched/strained，词表外原样回显 valueRaw）。所以文案是「**有人自述**吃紧」
//    而不是「这个部门吃紧」——后者是我们替这组人下的结论，正是红线要防的东西。
//
// ③ **必须带出处**。TeamScreen 的 `SelfReportRow` 立的规矩：每一处出现情绪词的元素都挂
//    `data-metric-source` 锚点（AFK 门 K6 相位据此判定：锚点外出现情绪词=红，见
//    `scripts/gates/live-frontend-gate.snippet.js` 的 `MOOD_VOCAB_RE` / `textOutsideAnchors`）。
//    所以本模块把**那一条自述的出处**一并返回——组级短语不是凭空的一句总结，它有一份文档。
//
// ## 为什么没有第二道「开关关」的闸
// `stripPersonNumbers`（teamData.ts）在开关关时把整个 `self_report` 剥掉，所以关世界里
// `person.selfReport` 恒为 undefined，本模块自然一条都取不到。**故意不再加一句
// `if (!scoringEnabled) return null`**：两把锁锁同一扇门的下场是内层那把永远变异不掉
// （门电池里那条「一条变异只能红一把锁」的老账）。开关关的世界由**验收脚本真跑一遍**
// 来钉（B2 的 check 跑了开/关两世界），不是由这里再抄一遍判断来钉。

import type { LitePerson } from '../teamData'

/**
 * 一条组级读数。**locale-free**：只装枚举键 + 出处，一个成句的文案都不装
 * （feat-068 立的派生层纪律——成句是文案层的事，写死在这里的话中文构建再也救不回来）。
 */
export interface ZoneRead {
  /** 归一情绪键：steady / stretched / strained / other。 */
  mood: string
  /** 仅 `other`（词表外）时非空：文档原词，原样回显不改写。 */
  moodRaw: string | null
  /** 这一条自述的出处 `<文档名>:<行>`。渲染层拿它当 `data-metric-source` 锚点值。 */
  source: string
  /** 口径（恒『本人自述』）。渲染层挂 `data-metric-caliber`，与人卡逐字同源。 */
  caliber: string
}

/**
 * 该说哪一条：**先说要你留意的**。
 *
 * 这不是给人打分排序（那是红线），是「一句话只能说一件事，该说哪件」——与项目屏
 * `GROUP_ORDER` 把「需要你出手」排在最前是同一条产品口径。
 *
 * `other`（词表外的原词）排在 `steady` **之前**：我们没能把它归一，就没资格断定它是好消息，
 * 拿一句「有人自述如常」把它盖掉是往更肯定的方向编（`lookKind` 那条「宁可少说一个词、
 * 不可多点一个不存在的项目」的同一个方向）。
 */
const MOOD_NOTABILITY = ['strained', 'stretched', 'other', 'steady'] as const

/**
 * 一组人 → 一条组级读数。没有任何人报过情绪 → **null**（整段不渲染）。
 *
 * 挑中的那一条**原样**带着自己的 source/caliber 回去：屏幕上那句话背后有一份具体的文档，
 * 而不是一个跨人汇总出来的印象。同一档里有多人时取花名册序的第一条（`deriveGroupFacets` /
 * `filterDirectory` 保的就是 payload 序——本模块不自己排人）。
 */
export function deriveZoneRead(members: readonly LitePerson[]): ZoneRead | null {
  const reads: ZoneRead[] = []
  for (const person of members) {
    const mood = person.selfReport?.mood
    if (!mood) continue
    const value = (mood.value ?? '').trim()
    const source = (mood.source ?? '').trim()
    // 🔴 没有出处就不显示：一个挂不上 data-metric-source 的情绪词，在这个仓库里的定义
    // 就是一次泄漏（见文件头③）。宁可这一组不显示读数，也不摆一句无从追溯的话。
    if (!value || !source) continue
    reads.push({
      mood: value,
      moodRaw: value === 'other' ? mood.valueRaw?.trim() || null : null,
      source,
      caliber: (mood.caliber ?? '').trim(),
    })
  }
  if (reads.length === 0) return null

  for (const key of MOOD_NOTABILITY) {
    const hit = reads.find((read) => read.mood === key)
    if (hit) return hit
  }
  // 归一词表之外、又不是 'other' 的值（后端不该发，防御）：照第一条原样回去，不吞掉。
  return reads[0]
}
