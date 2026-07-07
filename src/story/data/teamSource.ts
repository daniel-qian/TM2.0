// feat-017 · TeamDataSource seam（Your team：人卡 / 项目卡 / briefing / handoffs）——ADR-0020 决策 2。
// feat-024（ADR-0022 决策 1）：立墙后 story 侧只剩 ScriptedTeamSource——live 版随 lite 壳
// 搬进 src/lite/teamData.ts（纯 live payload 映射，零 fixtures）。story HomeScene 只读这里。
//
// 🔴 红线（施工图 §5 / ADR-0021 §4）：
//   ① 人卡只走定性读数——moodPct / capacityPct / 任何人评分永不渲染、永不填。
//      TeamPerson **不含**这些字段（结构性护栏）。
//   ② 指向人的信号停在"情境"（她在扛什么），不变成对人的负面标签。

import { PEOPLE, PROJECTS, type Briefing, type Person, type Project } from './fixtures'
import {
  HOME_PEOPLE_IDS,
  HOME_PROJECT_IDS,
  homeHandoffs,
  homePersonRead,
  type HomeHandoff,
  type HomeTone,
} from './fixtures.home'
import type { DetailPhase } from './fixtures.p3'

// 对外暴露的人卡形状——定性 ONLY，**没有** moodPct/capacityPct 键（红线结构护栏）。
// story 的 moodPct 只喂已存在的 story 视觉，从不上 home 卡面——feat-014 已守。
export interface TeamPerson {
  id: string
  name: string
  role: string
  team?: string
  read: string // 定性读数（homePersonRead）
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
  readonly kind: 'scripted'
  people: (phase: DetailPhase) => TeamPerson[]
  projects: (phase: DetailPhase) => TeamProject[]
  handoffs: (phase: DetailPhase) => HomeHandoff[]
  briefing: (phase: DetailPhase) => Briefing
}

// ════════════════════════════════════════════════════════════════════════════
// ScriptedTeamSource —— story mode。纯读现有 fixtures，零行为变化。
// ════════════════════════════════════════════════════════════════════════════

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
  }
}
