// P5 ⑦ (ADR-0012 修订 5)：Dashboard 结构化双列（bipartite），取代修订 2 的软团队聚簇。
// 左 = 名册列：avatar 圆点按 team 分组排紧凑网格，team 标签 = 组上方的安静小字。
// 右 = 项目列：统一尺寸横条，按 owner 所属 team 的组序排列（focus 连线短而水平）。
// 连线 calm 隐藏、focus 才出现（SvgEdgeLayer）。坐标全是公式常量（行列步距），
// 不逐节点手摆（memory: prefer-runtime-navigation-over-handtuned-layout）。

import { PEOPLE, PROJECTS, type Person, type Project } from './fixtures'
import type { Pos } from './board'

export type { Pos }

export interface TeamZone {
  team: string
  label: string
  labelPos: Pos // 组标签锚点：该组网格上方居中
}

const TEAM_ORDER: Array<Person['team']> = ['Founders', 'Eng', 'Product', 'Design', 'GTM', 'Ops']

const ZONE_LABEL: Record<string, string> = {
  Founders: 'Founders',
  Eng: 'Engineering',
  Product: 'Product',
  Design: 'Design',
  GTM: 'Go-to-market',
  Ops: 'Operations',
}

// ── 名册网格常量（board px）──
const ROSTER_TOP = 160 // 第一组标签 y
const ROSTER_LEFT = 430 // 第一列圆点中心 x
const ROSTER_COLS = 3
const COL_STEP = 220
const ROW_STEP = 140
const LABEL_H = 50 // 标签行高（标签 → 首行圆点的间距）
const GROUP_GAP = 36 // 组与组之间

// ── 项目条列常量（board px）──
// 修订 6：两列间距减半（1810→1560），内容变窄 → calm fit-width 进一步放大。
const PROJECT_X = 1560 // 条中心 x
const PROJECT_STEP = 190 // calm 即全卡（summary+进度+meta）后卡更高，加大步距

const byTeam: Partial<Record<Person['team'], Person[]>> = {}
for (const p of PEOPLE) (byTeam[p.team] ??= []).push(p)

export const PERSON_POS: Record<string, Pos> = {}
export const TEAM_ZONES: TeamZone[] = []

let cursorY = ROSTER_TOP
for (const team of TEAM_ORDER) {
  const members = byTeam[team] ?? []
  if (members.length === 0) continue
  const cols = Math.min(ROSTER_COLS, members.length)
  const gridCenterX = ROSTER_LEFT + ((cols - 1) * COL_STEP) / 2
  TEAM_ZONES.push({
    team,
    label: ZONE_LABEL[team] ?? team,
    labelPos: { x: gridCenterX, y: cursorY },
  })
  members.forEach((person, i) => {
    const row = Math.floor(i / ROSTER_COLS)
    const col = i % ROSTER_COLS
    PERSON_POS[person.id] = {
      x: ROSTER_LEFT + col * COL_STEP,
      y: cursorY + LABEL_H + ROW_STEP / 2 + row * ROW_STEP,
    }
  })
  cursorY += LABEL_H + Math.ceil(members.length / ROSTER_COLS) * ROW_STEP + GROUP_GAP
}

const rosterBottom = cursorY - GROUP_GAP

// 项目条按 owner 的 team 组序排（同组内保 fixtures 顺序），整列对名册垂直居中。
function teamIndexOf(project: Project): number {
  const owner = PEOPLE.find((p) => p.id === project.ownerId)
  const idx = owner ? TEAM_ORDER.indexOf(owner.team) : -1
  return idx === -1 ? TEAM_ORDER.length : idx
}

export const PROJECT_ORDER: Project[] = [...PROJECTS].sort(
  (a, b) => teamIndexOf(a) - teamIndexOf(b) || PROJECTS.indexOf(a) - PROJECTS.indexOf(b),
)

const projectSpan = (PROJECT_ORDER.length - 1) * PROJECT_STEP
const projectTop = (ROSTER_TOP + rosterBottom) / 2 - projectSpan / 2

export const PROJECT_POS: Record<string, Pos> = {}
PROJECT_ORDER.forEach((project, i) => {
  PROJECT_POS[project.id] = { x: PROJECT_X, y: projectTop + i * PROJECT_STEP }
})
