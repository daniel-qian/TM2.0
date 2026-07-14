import type { LiteTeam } from './teamData'

// feat-044 · lite2 "A closer look" comparison-card derivation (PRD F4 / decisions.md 拍板#4).
// Pure function: LiteTeam -> GapCard[]. Only project-level fields — never touches LitePerson
// beyond reading its name for the `ownerName` label. No LLM call, no network, no randomness:
// same LiteTeam in, same GapCard[] out, every time (same discipline as teamData.ts liveHandoffs()).
//
// 🔴 红线 (decisions.md 拍板#4 约束):
//   ① 卡的主语必须是项目——claim/evidence 都是关于项目的句子，人只以 owner 身份附带出现。
//   ② claim 引项目自述原文（summary，读起来"没事"）、evidence 引 blocker 原文行——可溯源，零捏造。
//   ③ 点名类矛盾（沉默成员等）本期不做——本函数结构上就够不到人身级别的信号，只读项目字段。
//   ④ 命名/文案层（screen 组件 + i18n）避免"gap/差距/现实差距/Nexus"字样；本文件内部命名可以
//      用"gap"（内部领域概念名，ADR-0015 只管 user-facing 标签，不管内部 id/类型名）。
//
// The heuristic: a project's own status reads STEADY (on-track / steady family — the project is
// "supposed to be fine" per its own self-report), but it carries >=1 blocker line saying
// otherwise. That mismatch — not "any project with a blocker" (that's teamData.ts's broader
// liveHandoffs() morning-triage heuristic) — is what makes it worth a closer look. A project
// that's already self-reporting at-risk/blocked is NOT a gap: its blockers are consistent with
// its own story, not a contradiction of it.
const STEADY_STATUSES = new Set(['on-track', 'steady'])

export interface GapCard {
  id: string
  projectId: string
  projectTitle: string
  ownerName: string
  claim: string // "What the files say" — the project's own self-report (verbatim summary)
  evidence: string // "What the signals show" — the blocker line that contradicts it (verbatim)
  evidenceTag: string
}

export function deriveGaps(team: LiteTeam | null): GapCard[] {
  if (!team) return []
  const out: GapCard[] = []
  for (const project of team.projects) {
    if (!STEADY_STATUSES.has(project.status)) continue
    const blockers = project.blockers ?? []
    if (blockers.length === 0) continue
    // claim 兜底（summary 为空时）：机械状态读出式，引号原样引 status 字段值——不自拟叙事句
    // （"X is reported fine." 读起来像语料里有人这么说过，但语料里没这句话；机械读出保证
    // 兜底文本也 100% 可溯源到字段本身。对抗验证 redline 路要求，2026-07-14）。
    const claim = project.summary?.trim() || `Reported status: "${project.status}"`
    blockers.forEach((blocker, idx) => {
      // Stable id derived from project id + blocker index (kickoff-dev.md §feat-044) — changes
      // only if the underlying corpus text changes, which is the intended "reappears if the
      // source material genuinely changed" behavior, not a bug.
      out.push({
        id: `gap_${project.id}_${idx}`,
        projectId: project.id,
        projectTitle: project.title,
        ownerName: project.ownerName,
        claim,
        evidence: blocker,
        evidenceTag: 'From your uploads',
      })
    })
  }
  return out
}
