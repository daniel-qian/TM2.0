import type { LiteTeam } from './teamData'
import type { LiveDecisionCard, LiveDecisionGrade, LiveTeamPayload } from './transport'

// feat-057（PRD G4）· 聚合首屏的派生层。纯函数：(LiteTeam, LiveTeamPayload) → 摘要结构。
// 零网络、零随机、零 LLM —— 同一份 payload 进，同一份结果出（与 gapDerive.ts / teamData.ts
// 同一条纪律）。
//
// 🔴 本文件的存在理由就是「首屏上每个数字都能追到真数据来源」：屏幕上出现的每一个数，
// 都必须是这里从真 payload 里**数出来的**，并且屏幕上要写清楚数的是什么。
// 参考库那边的问候统计句（"扫描了 186 条信号""距国庆还有 83 天"）是硬编码的假数字——
// 我们一个都不搬。缺信号就显示空态，绝不补一个好看的数。
//
// 🔴 红线（继承 teamData.ts §红线 ①②）：
//   · 这里数出来的计数描述的是**文件里的事**（几条信号提到、名下几条卡点），
//     不是对人的评分/排名/画像。永不产出 score/rank/percentile 这类量。
//   · 指向人的条目一律带着**原文证据**出场（verbatim），让经理自己判断，
//     而不是给他一个无从解释的名单。

// ── ① 今天要决策的：分级计数 ────────────────────────────────────────────────
// 🔴 decisions 数组的**顺序归后端**（feat-056 已按严重度排好序），这里只数数、不重排。
// label 也一律取自 payload 自带的 `grade_label` —— 前端不硬编码「高风险/需确认/可推进」
// 这三个词，后端换了措辞或换了语言，屏幕上跟着变，不会两处对不上。
export interface DecisionBucket {
  grade: LiveDecisionGrade
  label: string // 取自 payload 的 grade_label，前端不自拟
  severity: number
  count: number
}

export interface DecisionSummary {
  total: number
  buckets: DecisionBucket[] // 严重度高 → 低
}

export function summarizeDecisions(decisions: LiveDecisionCard[] | undefined): DecisionSummary {
  if (!decisions || decisions.length === 0) return { total: 0, buckets: [] }
  const byGrade = new Map<LiveDecisionGrade, DecisionBucket>()
  for (const card of decisions) {
    const existing = byGrade.get(card.grade)
    if (existing) {
      existing.count += 1
      continue
    }
    byGrade.set(card.grade, {
      grade: card.grade,
      label: card.grade_label,
      severity: card.severity,
      count: 1,
    })
  }
  const buckets = [...byGrade.values()].sort((a, b) => b.severity - a.severity)
  return { total: decisions.length, buckets }
}

// ── ② 需关注的人 ────────────────────────────────────────────────────────────
// 🔴 口径（kickoff-dev.md §feat-057 明文）：参考库用 `load>=90 或 sentiment=strained`
// 挑人——**这两个字段我们一个都没有**（LivePersonCard 只有 role/team/tenure/owns/
// collaboration，且红线禁止任何人身数值）。所以本波只用**手上真有的信号**：
//   ① 这个人被几条 signals 提到（subjectType==='person' 直接命中，或信号原文里出现她的名字）
//   ② 她名下的项目挂着几条 blockers
// 两个数都是「文件里的事」的条数，不是对人的评价。界面必须把口径写出来
// （"因为出现在 N 条信号里"），并把命中的原文摆出来——名单可解释才敢给人看。
//
// feat-066/067（KPI 推导 / 人卡分数）落地后再换真口径，那之前这里就是全部可得依据。
export interface AttentionPerson {
  id: string
  name: string
  role: string
  signalCount: number // 提到这个人的信号条数
  blockerCount: number // 名下项目挂着的卡点条数
  projectCount: number // 名下有卡点的项目数
  projectTitles: string[] // 那些项目的标题（可点进详情）
  evidence: string[] // 原文，verbatim —— 信号原句优先，其次卡点原句
}

// 名字命中判定：只认 2 个字符以上的名字。单字名/首字母在一段中文里几乎必然假阳性
// （"李" 会命中 "李子"、"A" 会命中任何一句英文），宁可漏也不能给经理一个错的名单。
function nameMentioned(name: string, text: string): boolean {
  const trimmed = name.trim()
  if (trimmed.length < 2) return false
  return text.includes(trimmed)
}

export function deriveAttentionPeople(
  team: LiteTeam | null,
  rawTeam: LiveTeamPayload | null,
): AttentionPerson[] {
  if (!team) return []
  const signals = rawTeam?.signals ?? []
  // ownerId 只活在原始 payload 里（LiteProject 只留了 ownerName）。两条路都走：
  // 有 ownerId 就按 id 认领（稳），没有就退回 ownerName 字面相等（抽取层没给 id 时的兜底）。
  const ownerIdByProject = new Map<string, string | undefined>()
  for (const pr of rawTeam?.projects ?? []) ownerIdByProject.set(pr.id, pr.ownerId)

  const out: AttentionPerson[] = []
  for (const person of team.people) {
    const owned = team.projects.filter((pr) => {
      const ownerId = ownerIdByProject.get(pr.id)
      if (ownerId) return ownerId === person.id
      // 🔴 认人只认 ownerNameRaw（文档自述的名字）。ownerName 是渲染文案，缺失时是
      // 「文档未提及」这句话——拿它做字面比对等于让一句兜底文案有机会冒充某个人的名字。
      const raw = pr.ownerNameRaw?.trim()
      return !!raw && raw === person.name.trim()
    })
    const blockerLines: string[] = []
    const projectTitles: string[] = []
    for (const pr of owned) {
      const blockers = (pr.blockers ?? []).map((b) => b.trim()).filter(Boolean)
      if (blockers.length === 0) continue
      projectTitles.push(pr.title)
      for (const line of blockers) blockerLines.push(line)
    }

    // 「被信号提到」只认两种命中，别的一概不算：
    //   ① 信号本身就挂在这个人身上（subjectType==='person' 且 id 相等）
    //   ② 信号原文里真的写了她的名字
    // 🔴 刻意**不**把"她是这个项目的 owner"当成提到她 —— 那是替文件说话，
    // 会把一句关于项目的话变成一条指向人的记录。
    let signalCount = 0
    const signalLines: string[] = []
    for (const sig of signals) {
      const summary = (sig.summary ?? '').trim()
      const direct = sig.subjectType === 'person' && sig.subjectId === person.id
      if (!direct && !nameMentioned(person.name, summary)) continue
      signalCount += 1
      if (summary) signalLines.push(summary)
    }
    const blockerCount = blockerLines.length
    if (signalCount + blockerCount === 0) continue

    out.push({
      id: person.id,
      name: person.name,
      role: person.role,
      signalCount,
      blockerCount,
      projectCount: projectTitles.length,
      projectTitles,
      // 信号原句优先（它是"文件里怎么说这个人"最直接的一句），不够再补卡点原句。
      // 🔴 verbatim：原样摆出来，不转述、不改写。
      evidence: [...signalLines, ...blockerLines].slice(0, 2),
    })
  }

  // 排序 = 关联条数多的在前；同数按名字排，保证同一份 payload 每次顺序一致（可复现）。
  // 🔴 这是「文件里提到的次数」排序，不是人的排名——界面上必须把这句口径写出来。
  return out.sort((a, b) => {
    const byCount = b.signalCount + b.blockerCount - (a.signalCount + a.blockerCount)
    if (byCount !== 0) return byCount
    return a.name.localeCompare(b.name)
  })
}
