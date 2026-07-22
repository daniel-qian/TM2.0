// 棒E · 顶栏真搜索的公共 selector（布局与真部件战役 2026-07-22）。
//
// 裁决（battle-map §2.4）：纯客户端内存检索，**零后端 endpoint、零 transport 改动**。
// 检索面全量在 store.team 内存里（~30 人 + 17 项目），`includes()` 足够，不建索引。
//
// 为什么抽成公共函数：此前唯一的检索在 LiteComposer.tsx 的引用菜单
//（`${label} ${meta}`.toLowerCase().includes(query) + kind 过滤）。顶栏搜索若另写一套
// `includes`，同一个词在两处会给出不同结果（漂移）。这里把「怎么算命中」收成一处，
// 引用菜单与顶栏搜索都消费它——**同一个词，两处同一个结果**。
//
// 🔴 三条纪律（与全仓一致）：
//   ① 纯函数、零网络、零随机、i18n-free。判据吃**原值**（statusRaw/ownerNameRaw），
//      本地化兜底串（projectsUnknownValue 之类）由**渲染层**在拿到结果后自己补——
//      绝不把「文档未提及」塞进匹配 haystack，否则搜「文档未提及」会命中所有缺负责人的项目，
//      是一次匹配幻觉（显示值与判据值分开，AGENTS.md §易复发陷阱第一条）。
//   ② absent ≠ none：缺失字段对 haystack 贡献空串，不是任何默认/兜底文案。
//   ③ 结果**零数字**：只吐 label（人名/项目名）与 meta（角色/负责人原值）。她方
//      `sub:${status}·${progress}%` 那半句一律丢掉（我方 LiteProject 连 progress 都没有，
//      人卡侧更禁数字，battle-map §2.6 硬红线）。

import type { LiteTeam } from './teamData'

export type SearchKind = 'person' | 'project'
export type SearchFilter = 'all' | SearchKind

export interface SearchResult {
  // 原始实体 id（person.id / project.id）——消费方直接 openDetail(kind, id) 打开详情浮层。
  id: string
  kind: SearchKind
  // 展示主串：人名 / 项目名。
  label: string
  // 展示次串（**原值**，可能是空串）：人的角色 / 项目自述的负责人。缺失兜底归渲染层
  //（`meta || t.lite2.projectsUnknownValue`），不在这里焊 locale。
  meta: string
}

// 空 query 语义 = **返回全量**（引用菜单空搜索时要能浏览所有人/项目，这是既有行为）。
// 顶栏搜索不想要这个语义时在调用点自己 gate：`query.trim() ? searchTeam(...) : []`。
export function searchTeam(
  team: LiteTeam | null,
  query: string,
  kind: SearchFilter = 'all',
): SearchResult[] {
  if (!team) return []
  const q = query.trim().toLowerCase()
  const out: SearchResult[] = []

  if (kind === 'all' || kind === 'person') {
    for (const p of team.people) {
      // 人：name / role / team（原值；缺 team = 空串）。
      const hay = `${p.name} ${p.role} ${p.team ?? ''}`.toLowerCase()
      if (!q || hay.includes(q)) {
        out.push({ id: p.id, kind: 'person', label: p.name, meta: p.role })
      }
    }
  }

  if (kind === 'all' || kind === 'project') {
    for (const p of team.projects) {
      // 项目：title / summary / ownerNameRaw / statusRaw（🔴 判据一律吃 raw；缺失 = 空串，
      // 绝不把本地化兜底串塞进来）。展示 meta 取 ownerName（= ownerNameRaw ?? ''），
      // 渲染层再对空串补 projectsUnknownValue。
      const hay = `${p.title} ${p.summary ?? ''} ${p.ownerNameRaw ?? ''} ${p.statusRaw ?? ''}`.toLowerCase()
      if (!q || hay.includes(q)) {
        out.push({ id: p.id, kind: 'project', label: p.title, meta: p.ownerName })
      }
    }
  }

  return out
}
