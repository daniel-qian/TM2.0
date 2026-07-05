// feat-017 · TeamDataSource seam（Your team：人卡 / 项目卡 / briefing / handoffs）——ADR-0020 决策 2。
//
// HomeScene 经这个接口取"今天该把心思花在哪"的数据；两实现：
//   * ScriptedTeamSource —— fixtures.home.ts + fixtures.ts（story mode），原样，rail 不动。
//   * LiveTeamSource     —— feat-016 ingestion 产出（live mode）：上传文件解析出的实体 + agent
//                            生成的定性读数 / briefing。
//
// 🔴 红线（施工图 §5 / ADR-0021 §4）：
//   ① live 人卡只走定性读数——moodPct / capacityPct / 任何人评分永不渲染、永不填。
//      TeamDataSource 暴露的 TeamPerson **不含**这些字段（结构性护栏）；LiveTeamSource 再运行时剥离兜底。
//   ② 指向人的信号停在"情境"（她在扛什么），不变成对人的负面标签——signal 透传，UI 只当情境呈现。
//   ③ 聚合数字 R2：真算或不显示，绝不编——briefing.metrics 直接来自 ingestion（人数/项目数真数）。

import { PEOPLE, PROJECTS, type Briefing, type Person, type Project } from '../data/fixtures'
import {
  HOME_PEOPLE_IDS,
  HOME_PROJECT_IDS,
  homeHandoffs,
  homePersonRead,
  type HomeHandoff,
  type HomePersonRead,
  type HomeTone,
} from '../data/fixtures.home'
import type { DetailPhase } from '../data/fixtures.p3'
import type { LivePersonCard, LiveProjectCard, LiveTeamPayload } from './transport'

// TeamDataSource 对外暴露的人卡形状——定性 ONLY，**没有** moodPct/capacityPct 键（红线结构护栏）。
// HomeScene 的 live 路径只读它；story 路径继续直读 fixtures 的 Person（story 的 moodPct 只喂
// 已存在的 story 视觉，从不上 home 卡面——feat-014 已守）。
export interface TeamPerson {
  id: string
  name: string
  role: string
  team?: string
  read: string // 定性读数（story：homePersonRead；live：ingestion collaboration / 缺省句）
  tone: HomeTone
  tenure?: string
  owns?: string[]
}

export interface TeamProject {
  id: string
  title: string
  ownerName: string
  status: string
  progress?: number // 可量化（有就显）——项目可硬
  dueDate?: string
  summary?: string
}

export interface TeamDataSource {
  readonly kind: 'scripted' | 'live'
  people: (phase: DetailPhase) => TeamPerson[]
  projects: (phase: DetailPhase) => TeamProject[]
  handoffs: (phase: DetailPhase) => HomeHandoff[]
  briefing: (phase: DetailPhase) => Briefing
  // live 才有：上传产出的来源文件（UI 显"从这几份长出来"）。story 返回 undefined。
  sourceFiles?: () => string[] | undefined
}

// ════════════════════════════════════════════════════════════════════════════
// ScriptedTeamSource —— story mode。纯读现有 fixtures，零行为变化。
// ════════════════════════════════════════════════════════════════════════════

const STORY_BRIEFING_V1_ID = 'b_v1'

function personDisplayName(p: Person): string {
  return p.lastInitial ? `${p.name} ${p.lastInitial}.` : p.name
}

export function createScriptedTeamSource(getBriefing: () => Briefing): TeamDataSource {
  return {
    kind: 'scripted',
    people(phase) {
      return HOME_PEOPLE_IDS.map((id) => PEOPLE.find((p) => p.id === id))
        .filter((p): p is Person => Boolean(p))
        .map((p) => {
          const read = homePersonRead(p.id, phase)
          return {
            id: p.id,
            name: personDisplayName(p),
            role: p.role,
            team: p.team,
            read: read?.read ?? '',
            tone: read?.tone ?? 'sage',
          }
        })
    },
    projects(phase) {
      void phase
      return HOME_PROJECT_IDS.map((id) => PROJECTS.find((p) => p.id === id))
        .filter((p): p is Project => Boolean(p))
        .map((p) => ({
          id: p.id,
          title: p.title,
          ownerName: PEOPLE.find((person) => person.id === p.ownerId)?.name ?? 'Unassigned',
          status: p.status,
          progress: p.progress,
          dueDate: p.dueDate,
          summary: p.summary,
        }))
    },
    handoffs(phase) {
      return homeHandoffs(phase)
    },
    briefing() {
      return getBriefing()
    },
    sourceFiles() {
      return undefined
    },
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LiveTeamSource —— live mode。吃 feat-016 ingestion 产出（LiveTeamPayload），
// 映射成 HomeScene 认的形状。红线：人卡剥净数字。
// ════════════════════════════════════════════════════════════════════════════

// 🔴 红线运行时兜底：即便后端某天错吐了 moodPct/capacityPct/score/rank/rating/tier，
// 也在这里剥掉——live 人卡结构上永不携带任何血条/评分字段。
const BLOOD_BAR_KEYS = new Set([
  'moodPct',
  'capacityPct',
  'mood',
  'capacity',
  'score',
  'rank',
  'rating',
  'tier',
  'percentile',
])

export function stripPersonNumbers(card: LivePersonCard): LivePersonCard {
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(card)) {
    if (BLOOD_BAR_KEYS.has(k)) continue // 红线：丢弃
    if (typeof v === 'number') continue // 人卡上不留任何裸数字（防新血条字段偷渡）
    clean[k] = v
  }
  return clean as unknown as LivePersonCard
}

// ingestion 人卡 → 定性读数：优先 collaboration（她在跟谁协作/扛什么），否则 owns 情境，否则中性句。
function liveRead(card: LivePersonCard): { read: string; tone: HomeTone } {
  if (card.collaboration && card.collaboration.trim()) {
    return { read: card.collaboration.trim(), tone: 'sage' }
  }
  if (card.owns && card.owns.length > 0) {
    return { read: `Owns ${card.owns.slice(0, 2).join(', ')}`, tone: 'sage' } // ⚠ 待 Danny 审字
  }
  if (card.tenure && card.tenure.trim()) {
    return { read: card.tenure.trim(), tone: 'sage' }
  }
  return { read: 'On the team', tone: 'sage' } // ⚠ 待 Danny 审字（无信号时的中性读数）
}

function briefingFromPayload(payload: LiveTeamPayload): Briefing {
  const b = payload.briefing
  return {
    id: `live_${payload.context_id}`,
    version: 1,
    tone: b.tone === 'alert' ? 'alert' : 'calm',
    headline: b.headline,
    subhead: b.subhead,
    metrics: b.metrics ?? [],
  }
}

// 由 ingestion 项目卡派生"今天该做的一件事"——弱版 handoff（R1）：
// 只从项目 blocker（doc-derived 信号）生成"看一眼"类行动项；缺信号 → 不造。指向项目/情境，绝不点名评判人。
function liveHandoffs(payload: LiveTeamPayload): HomeHandoff[] {
  const out: HomeHandoff[] = []
  for (const pr of payload.projects) {
    const blockers = pr.blockers ?? []
    const atRisk = pr.status === 'at-risk' || pr.status === 'blocked'
    if (!atRisk && blockers.length === 0) continue
    const evidence =
      blockers.length > 0
        ? blockers[0]
        : `${pr.title} is flagged ${pr.status ?? 'worth a look'} in your uploads.` // ⚠ 待 Danny 审字
    out.push({
      id: `lh_${pr.id}`,
      tone: pr.status === 'blocked' ? 'terracotta' : 'honey',
      toneLabel: 'Worth a closer look', // ⚠ 待 Danny 审字（surface label per ADR-0015）
      action: `Take a look at ${pr.title}`, // ⚠ 待 Danny 审字
      evidence,
      personIds: pr.ownerId ? [pr.ownerId] : [],
      projectIds: [pr.id],
      evidenceTag: 'From your uploads', // ⚠ 待 Danny 审字
    })
  }
  return out
}

export function createLiveTeamSource(payload: LiveTeamPayload): TeamDataSource {
  // 红线：入口即剥净每张人卡的数字字段。
  const cleanPeople = payload.people.map(stripPersonNumbers)

  const people: TeamPerson[] = cleanPeople.map((card) => {
    const { read, tone } = liveRead(card)
    return {
      id: card.id,
      name: card.name,
      role: card.role ?? '',
      team: card.team,
      read,
      tone,
      tenure: card.tenure,
      owns: card.owns,
    }
  })

  const projects: TeamProject[] = payload.projects.map((card: LiveProjectCard) => ({
    id: card.id,
    title: card.title,
    ownerName:
      card.ownerName ??
      cleanPeople.find((p) => p.id === card.ownerId)?.name ??
      'Unassigned',
    status: card.status ?? 'on-track',
    progress: card.progress,
    dueDate: card.dueDate,
    summary: card.summary,
  }))

  const briefing = briefingFromPayload(payload)
  const handoffs = liveHandoffs(payload)

  return {
    kind: 'live',
    people: () => people,
    projects: () => projects,
    handoffs: () => handoffs,
    briefing: () => briefing,
    sourceFiles: () => payload.source_files,
  }
}
