import { PROJECTS, PEOPLE, TASKS, DASHBOARD_TAGS } from '../data/fixtures'
import type { Focus as FocusState } from '../store/canvasStore'

// 共享 focus 解析（ADR-0003：一套语义喂同一批 dumb 组件）。
// 三种选择器都在这里解析成 { projectIds, personIds, primary }，组件只读结果。
// 单点节点也点亮"关联集合"，不是只亮被点那一个（beat B2「相关亮/无关淡」）。

// ── 单点节点 → 关联集合 ────────────────────────────────────────────────
// project：owner + dependsOn 的项目 + 这些项目的 task assignee。
// person：他 own 的项目 + 他有 task 的项目 + 那些项目的 owner。
export function focusEntity(kind: 'person' | 'project', id: string): FocusState {
  const projectIds = new Set<string>()
  const personIds = new Set<string>()

  if (kind === 'project') {
    projectIds.add(id)
    const proj = PROJECTS.find((p) => p.id === id)
    if (proj) {
      personIds.add(proj.ownerId)
      proj.dependsOn?.forEach((dep) => projectIds.add(dep))
    }
    TASKS.filter((t) => projectIds.has(t.projectId)).forEach((t) => personIds.add(t.assigneeId))
  } else {
    personIds.add(id)
    PROJECTS.filter((p) => p.ownerId === id).forEach((p) => projectIds.add(p.id))
    TASKS.filter((t) => t.assigneeId === id).forEach((t) => projectIds.add(t.projectId))
    PROJECTS.filter((p) => projectIds.has(p.id)).forEach((p) => personIds.add(p.ownerId))
  }

  return {
    source: 'node',
    projectIds: [...projectIds],
    personIds: [...personIds],
    primary: { kind, id },
  }
}

// 根集合 → 用单点同一套 relatedness 展开并合并（一套 relatedness，零分叉）。
function expand(rootProjects: string[], rootPersons: string[]) {
  const projectIds = new Set<string>()
  const personIds = new Set<string>()
  const merge = (f: FocusState) => {
    f.projectIds.forEach((x) => projectIds.add(x))
    f.personIds.forEach((x) => personIds.add(x))
  }
  rootProjects.forEach((id) => merge(focusEntity('project', id)))
  rootPersons.forEach((id) => merge(focusEntity('person', id)))
  return { projectIds: [...projectIds], personIds: [...personIds] }
}

function isThisWeek(due?: string): boolean {
  // demo 的 dueDate 是叙事字符串：'Today' / 'This Friday' / 'This Thursday'…
  return !!due && (due === 'Today' || due.startsWith('This '))
}

// ── tag 选择 → 集合。多选 = 并集（OR）。──────────────────────────────────
export function focusTags(tagIds: string[]): FocusState {
  const rootProjects = new Set<string>()
  const rootPersons = new Set<string>()
  for (const tagId of tagIds) {
    const m = DASHBOARD_TAGS.find((t) => t.id === tagId)?.match
    if (!m) continue
    if (m.by === 'status') PROJECTS.filter((p) => p.status === m.status).forEach((p) => rootProjects.add(p.id))
    else if (m.by === 'due') PROJECTS.filter((p) => isThisWeek(p.dueDate)).forEach((p) => rootProjects.add(p.id))
    else if (m.by === 'project') rootProjects.add(m.projectId)
    else if (m.by === 'team') PEOPLE.filter((p) => p.team === m.team).forEach((p) => rootPersons.add(p.id))
    else if (m.by === 'hotspot') PROJECTS.filter((p) => p.hotspot).forEach((p) => rootProjects.add(p.id))
  }
  const { projectIds, personIds } = expand([...rootProjects], [...rootPersons])
  return { source: 'tag', projectIds, personIds, selector: { tags: tagIds } }
}

// ── search 输入 → 集合。substring 匹配 name/title（纯前端，不上搜索库）。──────
export function focusSearch(query: string): FocusState {
  const q = query.trim().toLowerCase()
  if (!q) return { source: 'search', projectIds: [], personIds: [], selector: { query } }
  const rootProjects = PROJECTS.filter((p) => p.title.toLowerCase().includes(q)).map((p) => p.id)
  const rootPersons = PEOPLE.filter((p) => p.name.toLowerCase().includes(q)).map((p) => p.id)
  const { projectIds, personIds } = expand(rootProjects, rootPersons)
  return { source: 'search', projectIds, personIds, selector: { query } }
}
