// team-map-revival-0804 · B2 · focus 机器的**契约层**（纯函数、locale-free、零 DOM）。
//
// focus 回答的是地图存在的那个理由：「这活儿压在谁身上」。calm 态摆的是全景，
// 点下去才把**一个人和他背着的那几件事**从背景里拎出来——连线只在这一刻出现（PRD §3.3）。
//
// ## 为什么真相源是 URL 而不是一个 useState
// 票面要 `?focus=person:<id>` 可分享（PRD §3.1）。同一件事有两个真相源（组件 state + URL）
// 就一定会漂：feat-051 把「当前是哪一屏」从 Zustand 变量换成真路由，正是为了根治这个形状。
// 所以本模块只做**解析与派生**，不持有任何状态：URL 变了重新算一遍，值一模一样。
//
// ## 🔴 路径作用域：这个参数只属于 /map
// 它**刻意不进** `EPHEMERAL_PARAMS`（routes.ts 那个全局黑名单）——那里装的是「一次性接力棒」
// （`?q=` 进屋要问什么），进了黑名单就等于对全仓宣布「这个键是可丢的」，将来任何一个新的
// 导航助手都会静默吃掉它，而 focus 恰恰要**活到能被发给别人**。
// 它离开 /map 就消失，靠的是地图自己那几个出站 href 显式丢掉它（routes.ts 的
// `mapAwayParams()`），不是靠全局黑名单——「谁引入的作用域谁负责收口」。

import type { MapLayout, MapPos, MapProjectNode } from './mapLayout'

export type MapFocusKind = 'person' | 'project'

/** URL 里那个 token 解出来的东西。**只是一个意图**，不保证板上真有这个节点。 */
export interface MapFocusTarget {
  kind: MapFocusKind
  id: string
}

/** 一条 focus 连线。两端都是 board px（world 单位——ADR-0012 修订 1）。 */
export interface MapEdge {
  personId: string
  projectId: string
  from: MapPos
  to: MapPos
}

/**
 * focus 落到板上之后的样子。**只有解析得到真节点时才存在**——查无此人 = null = calm，
 * 不画一个空的高亮壳（那会让人以为「他在这儿只是没数据」）。
 */
export interface MapFocusView {
  subject: MapFocusTarget
  /** 该亮的人（含被点的那个）。 */
  personIds: Set<string>
  /** 该亮的项目条（含被点的那根）。 */
  projectIds: Set<string>
  /** 连线。🔴 无 owner / owner 不在花名册上 ⇒ **一条都没有**（缺了不编，不猜一个人连上去）。 */
  edges: MapEdge[]
}

const TOKEN_SEPARATOR = ':'

/**
 * `{kind,id}` → URL token。id 原样放进 query 值（`URLSearchParams` 负责转义），
 * 分隔符用 `:` 而不是 `-`：人卡 id 形如 `u_周雅`、项目 id 形如 `p_草坪婚宴旺季档`，
 * 里面本来就带下划线与中文，`:` 是这两类 id 里都不会出现的字符。
 */
export function focusToken(target: MapFocusTarget): string {
  return `${target.kind}${TOKEN_SEPARATOR}${target.id}`
}

/**
 * URL token → `{kind,id}`。
 *
 * 🔴 URL 是**用户可改的输入**：坏形状一律解成 null（= calm），绝不抛异常、也绝不猜。
 * 只切第一个 `:`——id 里若真出现冒号，剩下的部分照样属于 id。
 */
export function parseFocusToken(raw: string | null | undefined): MapFocusTarget | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  const cut = value.indexOf(TOKEN_SEPARATOR)
  if (cut <= 0) return null
  const kind = value.slice(0, cut)
  const id = value.slice(cut + 1).trim()
  if (!id) return null
  if (kind !== 'person' && kind !== 'project') return null
  return { kind, id }
}

/** 项目条 → 它 owner 的人 id。空 = 文档没读到负责人（或读到了但不在花名册上）。 */
function ownerIdOf(node: MapProjectNode): string | undefined {
  return node.project.ownerId?.trim() || undefined
}

/**
 * 板 + 意图 → 该亮什么、该连哪几条线。**纯函数**：不读 store、不读 URL、不读 DOM。
 *
 * 三条口径逐字对着 PRD §3.3：
 *   · 点人 → 亮「他 + 他 owned 的项目」；
 *   · 点项目 → 亮「它 + owner」；
 *   · 板上找不到这个 id → **null**（= calm）。深链发给别人时那家公司的花名册可能已经变了，
 *     这时候诚实的表现是「回到全景」，不是画一个指向空气的高亮。
 *
 * 🔴 owner 只认 `ownerId`（后端 `_link_owners` 解出来的 join key），与 mapLayout 的排序口径
 * 同一把尺。不拿名字去花名册里模糊匹配——同名的两个人会被连成同一个，而这张图回答的正是
 * 「活儿压在谁身上」，认错人比不认人贵得多。
 */
export function resolveMapFocus(
  layout: MapLayout,
  target: MapFocusTarget | null,
): MapFocusView | null {
  if (!target) return null

  const personNodes = new Map<string, MapPos>()
  for (const zone of layout.zones) {
    for (const member of zone.members) personNodes.set(member.person.id, member.pos)
  }

  if (target.kind === 'person') {
    const personPos = personNodes.get(target.id)
    if (!personPos) return null
    const owned = layout.projects.filter((node) => ownerIdOf(node) === target.id)
    return {
      subject: target,
      personIds: new Set([target.id]),
      projectIds: new Set(owned.map((node) => node.project.id)),
      edges: owned.map((node) => ({
        personId: target.id,
        projectId: node.project.id,
        from: personPos,
        to: node.pos,
      })),
    }
  }

  const projectNode = layout.projects.find((node) => node.project.id === target.id)
  if (!projectNode) return null
  const ownerId = ownerIdOf(projectNode)
  const ownerPos = ownerId ? personNodes.get(ownerId) : undefined
  // 🔴 owner 缺席（或指向一个不在花名册上的 id）⇒ 项目条自己亮，**不画边、不点亮任何人**。
  // 这是「缺了不编」在 focus 上的样子：文档没说是谁，图上就不许出现一条指向某个人的线。
  if (!ownerId || !ownerPos) {
    return {
      subject: target,
      personIds: new Set(),
      projectIds: new Set([target.id]),
      edges: [],
    }
  }
  return {
    subject: target,
    personIds: new Set([ownerId]),
    projectIds: new Set([target.id]),
    edges: [{ personId: ownerId, projectId: target.id, from: ownerPos, to: projectNode.pos }],
  }
}
