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

import { isNeedsYouStatus } from '../projectView'
import { MAP_CELL, type MapLayout, type MapPos, type MapProjectNode, type MapRect } from './mapLayout'

/**
 * focus 的四种口。
 *
 * B2 只有前两种（点板上一个节点）。B3 的 HUD 又添了两个触发器，而它们指的都**不是**单个节点：
 * 部门 chip 指一整组人、警报药丸指一撮项目。它们没有各自另立一套「高亮状态」，
 * 走的是同一个 focus 契约——理由和 B2 把真相源放进 URL 一样：同一件事（板上此刻在亮什么）
 * 只能有一个真相源。多出来的好处是它们**跟着一起可分享**：`?focus=zone:后厨` 发给合伙人，
 * 他看到的是同一组人和同一批活。
 *
 * 单节点口（person/project）与集合口（zone/alert）的差别只有一处：集合口没有「主角」，
 * 所以板上不会有任何节点长成 mini 卡（`MapNodeState` 的 subject 态永远不出现）——
 * 一次组级提问要的是一个组级答案，不是随手挑一个人把他的卡打开。
 */
export type MapFocusKind = 'person' | 'project' | 'zone' | 'alert'

/**
 * 警报药丸那一口唯一合法的 id：项目屏「需要你管的」那一组（blocked / at-risk）。
 *
 * 用组名而不是 `blocked` / `at-risk` 两个 token，是因为判据本身走
 * `isNeedsYouStatus`（项目屏同一把尺）。哪天那组的定义变了，这个 token 的含义跟着变，
 * URL 不用动——而如果写死成 `alert:blocked,at-risk`，定义一变旧链接就开始说谎。
 */
export const ALERT_NEEDS_YOU = 'needsYou'

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
  if (kind !== 'person' && kind !== 'project' && kind !== 'zone' && kind !== 'alert') return null
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
  const subject = target

  const personNodes = new Map<string, MapPos>()
  for (const zone of layout.zones) {
    for (const member of zone.members) personNodes.set(member.person.id, member.pos)
  }

  /**
   * 一撮项目 → 该亮什么。**四种口共用这一段**，于是「缺了不编」只写一遍：
   * owner 缺席或指向一个不在花名册上的 id ⇒ 这根条自己亮，不画边、不点亮任何人。
   * 分四处各写一遍的话，将来只会有一处被改对。
   */
  function fromProjects(nodes: MapProjectNode[], seedPeople: Iterable<string> = []) {
    const personIds = new Set<string>(seedPeople)
    const edges: MapEdge[] = []
    for (const node of nodes) {
      const ownerId = ownerIdOf(node)
      const ownerPos = ownerId ? personNodes.get(ownerId) : undefined
      if (!ownerId || !ownerPos) continue
      personIds.add(ownerId)
      edges.push({ personId: ownerId, projectId: node.project.id, from: ownerPos, to: node.pos })
    }
    return {
      subject,
      personIds,
      projectIds: new Set(nodes.map((node) => node.project.id)),
      edges,
    }
  }

  if (target.kind === 'person') {
    if (!personNodes.has(target.id)) return null
    // 一个人也可能一件活都不背——那时 personIds 只有他自己、零条边，板上只有他亮着。
    // 这是个**真答案**（「他没扛项目」），不是空结果，所以不返回 null。
    return fromProjects(
      layout.projects.filter((node) => ownerIdOf(node) === target.id),
      [target.id],
    )
  }

  if (target.kind === 'zone') {
    const zone = layout.zones.find((z) => z.key === target.id)
    if (!zone) return null
    const memberIds = new Set(zone.members.map((m) => m.person.id))
    return fromProjects(
      layout.projects.filter((node) => {
        const ownerId = ownerIdOf(node)
        return !!ownerId && memberIds.has(ownerId)
      }),
      memberIds,
    )
  }

  if (target.kind === 'alert') {
    // 🔴 只有一个合法 id。别的值（手改 URL）当**看不懂**处理 = calm，不猜一个默认分组。
    if (target.id !== ALERT_NEEDS_YOU) return null
    const flagged = layout.projects.filter((node) => isNeedsYouStatus(node.project.statusRaw))
    // 一件都没有 ⇒ null（= calm）。药丸本来就只在计数 > 0 时才渲染，所以这一路只有手敲
    // URL 才到得了；到了也不该把整块板暗下去只为了宣布「什么事都没有」。
    if (flagged.length === 0) return null
    return fromProjects(flagged)
  }

  const projectNode = layout.projects.find((node) => node.project.id === target.id)
  if (!projectNode) return null
  return fromProjects([projectNode])
}

/** 两个矩形的并。 */
function union(a: MapRect, b: MapRect): MapRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}

function boxAround(pos: MapPos, width: number, height: number): MapRect {
  return { x: pos.x - width / 2, y: pos.y - height / 2, width, height }
}

/**
 * 这一次 focus 亮起来的东西，整个装在哪个方框里（board px）。镜头跟随的输入。
 *
 * ## 为什么非有不可
 * 80 人的板宽 3476px，可读地板 `MIN_FIT_SCALE=0.6` 下首帧只框得住约 2400px。点一个人，
 * 他的项目条在右边、离他 2000px 开外——**两条线径直跑出画面**，屏幕上只剩一个亮着的圆点和
 * 两根指向虚空的线头。整张图存在的理由（「他背着这几件事」）在最需要它的那一刻恰好看不见。
 * demo-seed（板宽 1852）上不存在这个问题，所以 B2 的验收一路全绿也没暴露它。
 *
 * ## 口径
 * 装的是**亮着的节点**，不是被点的那一个：一条边有两头，只框住其中一头等于没框。
 * 分区口额外并进分区卡自己的框——组级答案的主语是那张卡（人再少也要能看见「这是哪个部门」）。
 * mini 卡不进框：它挂在节点下方、是 focus 之后才长出来的东西，把它算进去会让镜头为一张
 * 还没画出来的卡先让位（而且它的高度取决于文案换行，不是纯函数算得出来的）。
 */
export function focusBounds(layout: MapLayout, view: MapFocusView | null): MapRect | null {
  if (!view) return null
  let rect: MapRect | null = null
  const add = (next: MapRect) => {
    rect = rect ? union(rect, next) : next
  }

  for (const zone of layout.zones) {
    if (view.subject.kind === 'zone' && zone.key === view.subject.id) add(zone.rect)
    for (const member of zone.members) {
      if (!view.personIds.has(member.person.id)) continue
      add(boxAround(member.pos, MAP_CELL.person.width, MAP_CELL.person.height))
    }
  }
  for (const node of layout.projects) {
    if (!view.projectIds.has(node.project.id)) continue
    add(boxAround(node.pos, MAP_CELL.project.width, MAP_CELL.project.height))
  }
  return rect
}
