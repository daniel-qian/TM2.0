import type { LiteTeam } from './teamData'
import { projectStatusText, type ProjectStatusCopy } from '../shared/projectStatus'

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
//
// 🔴 And a project that self-reported NOTHING is not a gap either — read `statusRaw`, never
// `status`. Until 2026-07-18 this read `project.status`, which teamData.ts was filling with a
// hard-coded 'on-track' whenever the documents stated no status (~a quarter of real projects).
// Every one of those landed in this branch and produced a comparison card whose 「文件里的说法」
// column was a self-report that never happened: with no summary it quoted a status the front end
// had invented, and — the higher-frequency harm — WITH a summary it put the document's first line
// (e.g.「负责人：李娜」, not a status statement at all) opposite「实际信号」as if the customer had
// claimed everything was fine. `statusRaw` is absent exactly when nothing was read, so this
// function can no longer manufacture a self-report to contradict.
//
// 🔴 B-2 (棒D, 2026-07-22): the 2026-07-18 fix above closed only HALF of that door. It stopped the
// FRONT END inventing a status, but the `summary` half stayed open — the extractor fills `summary`
// with the project block's FIRST line, which for real corpora is a metadata line
// (「项目：销售 FAQ 梳理」= a title, or「负责人：李娜」= an owner), not a self-report sentence. No
// corpus had ever satisfied BOTH gap triggers (steady status + a blocker) at once, so nobody saw
// it — until this battle promoted the panel to the home rail's golden slot (panel-firing-truth.md
// reproduced it: a title line sitting in 「文件里的说法」opposite the observed blocker). Fix (下限
// only): before trusting `summary` as the claim, run it past `isStructuralLine`; a metadata line
// falls back to the mechanical status readout (localized at the render layer via `gapClaimText`,
// same as everywhere else — the pure layer stays i18n-free and deterministic). The UPPER fix
// (make the extractor prefer the self-report sentence over the block's first line) is out of scope
// (blast radius > this battle) and left as debt. Same discipline as always: 显示值与判据值分开.
const STEADY_STATUSES = new Set(['on-track', 'steady'])

// 「像不像自述」闸（B-2）：summary 若是**元信息行**（标题 / 负责人 / 名称这类结构行，而非陈述
// 句），返回 true → claim 退回机械状态读出，绝不让一句标题冒充「文件里的说法」。锚定行首的
// 字段名 + 冒号（中英双写、大小写不敏感），只认结构行、不误伤真陈述句（「本周完成…」不匹配）。
const STRUCTURAL_LINE = /^\s*(项目|Project|负责人|Owner|标题|Title|名称|Name)\s*[:：]/i
function isStructuralLine(text: string): boolean {
  return STRUCTURAL_LINE.test(text)
}

export interface GapCard {
  id: string
  projectId: string
  projectTitle: string
  ownerName: string
  // "What the files say" — the project's own self-report (verbatim summary). Empty string when the
  // summary was absent or a structural/metadata line (B-2): the render layer then localizes a
  // mechanical status readout from `claimStatusRaw` via gapClaimText(). 🔴 Never bake a display
  // string here — the pure layer has no dictionary, and an English literal would surface raw on
  // the ZH home rail (verify-zh-purity).
  claim: string
  // The self-reported status enum (statusRaw) behind this gap — the render-layer fallback for the
  // claim column when `claim` is empty. Machine key; localized at render.
  claimStatusRaw: string
  evidence: string // "What the signals show" — the blocker line that contradicts it (verbatim)
}

// Render-layer helper: the claim column's display text. Genuine self-report → verbatim summary;
// otherwise → a localized, mechanical readout of the self-reported status (B-2 fallback). Kept out
// of deriveGaps so the derivation stays i18n-free; `copy` = t.lite / t.lite2 (both satisfy
// ProjectStatusCopy). Used by CloserLookScreen (/gaps) and the home gap rail alike.
export function gapClaimText(gap: GapCard, copy: ProjectStatusCopy): string {
  return gap.claim || projectStatusText(gap.claimStatusRaw, copy)
}

export function deriveGaps(team: LiteTeam | null): GapCard[] {
  if (!team) return []
  const out: GapCard[] = []
  for (const project of team.projects) {
    // 没自述过状态 → 无从「与自述矛盾」，直接跳过（project.status 是渲染文案，判据只认 statusRaw）。
    const selfReported = project.statusRaw?.trim()
    if (!selfReported || !STEADY_STATUSES.has(selfReported)) continue
    const blockers = project.blockers ?? []
    if (blockers.length === 0) continue
    // claim（「文件里的说法」列）：只有当 summary 是**真自述句**时才逐字引用它。summary 为空、
    // 或是元信息结构行（B-2：标题「项目：X」/ 负责人行 —— 抽取层拿项目块首行当 summary 的产物），
    // 就退回机械状态读出。这里存的是**判据/原文**，不存显示串：claim 留空时由 gapClaimText() 在
    // 渲染层按当前字典把 claimStatusRaw 本地化成状态词（「按计划推进」）。绝不在纯函数里写英文
    // 兜底串——那会在中文主页右轨裸奔（verify-zh-purity）。同一条纪律：显示值与判据值分开。
    const summary = project.summary?.trim() ?? ''
    const claim = summary && !isStructuralLine(summary) ? summary : ''
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
        claimStatusRaw: selfReported,
        evidence: blocker,
      })
    })
  }
  return out
}
