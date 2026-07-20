// feat-025 · Danny 2026-07-09 拍板 Q2(a)：轻量分组视图（不做空间 map）。
// 把 Your team 人卡按「部门/角色/项目归属」聚类分组，带分组容器 + 标题 + 可折叠。
// 顺带解掉 Bug4 的「people 需要列表分类、容器」诉求。
//
// 分组维度取自已有 person.team / person.role / 项目 ownership 数据 —— 不新增数据依赖、不碰后端。
// 🔴 红线：分组只影响容器结构，人卡本身零改 —— 永不渲染任何数字/评分/排名。
//
// 维度优先级（每个人归入一个组）：
//   ① person.team（部门）——最强信号，LLM 抽取常填。
//   ② person 所拥有项目的标题（从 projects[].ownerId/ownerName 反查）——归到「Owns: <project>」。
//   ③ person.role（角色）——退而求其次。
//   ④ 「Everyone else」兜底桶。
// 若全员无任何维度信号 → 单个兜底组（容器仍渲染，分组视图恒成立）。

import type { LitePerson, LiteProject } from './teamData'

export interface PersonGroup {
  key: string
  title: string
  people: LitePerson[]
}

const UNGROUPED_KEY = '__ungrouped__'

// 项目 ownerId/ownerName → 拥有者归属维度。反查一个 person 拥有的第一个项目标题。
function ownedProjectTitle(
  person: LitePerson,
  projects: LiteProject[],
): string | null {
  for (const pr of projects) {
    // 判据只认 ownerNameRaw（文档自述）——ownerName 缺失时是「文档未提及」这句渲染文案，
    // 拿它比对会把一句兜底文案当成人名，凭空给人挂上一个项目。
    if (pr.ownerNameRaw && pr.ownerNameRaw === person.name) return pr.title
  }
  return null
}

// feat-068 · ownsTemplate 由调用方从字典传入（同 ungroupedLabel 的既有口径）。以前这里直接
// 拼 `Owns ${owned}`，中文页的分组标题因此顶着英文动词。分组 key 仍用**原始项目标题**派生，
// 与语言无关——换语言只换标题，不改分组身份（key 变了会让折叠状态错位）。
function groupKeyFor(
  person: LitePerson,
  projects: LiteProject[],
  ownsTemplate: string,
): { key: string; title: string } | null {
  const team = person.team?.trim()
  if (team) return { key: `team:${team.toLowerCase()}`, title: team }

  const owned = ownedProjectTitle(person, projects)
  if (owned) {
    return {
      key: `owns:${owned.toLowerCase()}`,
      title: ownsTemplate.replace('{project}', owned),
    }
  }

  const role = person.role?.trim()
  if (role) return { key: `role:${role.toLowerCase()}`, title: role }

  return null
}

// 把人卡分组。稳定顺序：按每组内首个成员在原数组的出现次序排组；兜底组永远排最后。
export function groupPeople(
  people: LitePerson[],
  projects: LiteProject[],
  ungroupedLabel: string,
  ownsTemplate: string,
): PersonGroup[] {
  const byKey = new Map<string, PersonGroup>()
  const order: string[] = []

  for (const person of people) {
    const g = groupKeyFor(person, projects, ownsTemplate)
    const key = g?.key ?? UNGROUPED_KEY
    const title = g?.title ?? ungroupedLabel
    let bucket = byKey.get(key)
    if (!bucket) {
      bucket = { key, title, people: [] }
      byKey.set(key, bucket)
      order.push(key)
    }
    bucket.people.push(person)
  }

  const groups = order.map((k) => byKey.get(k) as PersonGroup)
  // 兜底组沉底，便于阅读（有名分的组在前）。
  groups.sort((a, b) => {
    const au = a.key === UNGROUPED_KEY ? 1 : 0
    const bu = b.key === UNGROUPED_KEY ? 1 : 0
    return au - bu
  })
  return groups
}
