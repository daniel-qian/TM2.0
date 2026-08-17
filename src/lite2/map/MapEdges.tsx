import { MAP_CELL } from './mapLayout'
import type { MapEdge } from './mapFocus'

// team-map-revival-0804 · B2 · focus 连线层（world 层，z-index 2）。
//
// 🔴 **连线只在 focus 时存在**（PRD §3.3）。calm 态一条都不画，不是"画了再淡出来"——
// 16 个人 6 个项目就已经是一张蛛网，而这张图要回答的是「**这一个人**背着哪几件事」，
// 全画等于一条都没回答。所以本组件在 edges 为空时直接返回 null，DOM 里连一个空 `<svg>`
// 都不留（门判「calm 态零连线」时那是个明确的判据，不是"有个元素但看不见"）。
//
// 🔴 单位一律 board px：`viewBox` 与 `width/height` 都吃 board 尺寸，于是整层跟着镜头一起
// 缩放，线宽也跟着缩——world 对象不许碰视口单位（ADR-0012 修订 1 的分层铁律）。
// 线宽用 `vector-effect: non-scaling-stroke` 反而**不对**：那会让线在缩小的板上显得越来越粗，
// 与它连着的两个节点脱节。

/** 贝塞尔控制点的水平伸出量：跨度的 0.45，夹在 [40, 260]。 */
function reachOf(dx: number): number {
  return Math.max(40, Math.min(260, Math.abs(dx) * 0.45))
}

/**
 * 一条边的 path。
 *
 * 项目端锚在**条的左缘**（`pos.x - PROJECT_W/2`）而不是条的中心：条是有底色的卡片，
 * 线钻进去再从中心冒出来会在卡片下面留一截看得见的暗影。左缘是它真正"接线"的地方。
 * 人端锚在 `pos`（人位中心）——被点亮的人节点这时有一块底板盖着它（`.is-linked`），
 * 线头正好收在板底下，不会从名字上横穿过去。
 *
 * 水平出入的三次贝塞尔：两端切线都是水平的，所以线离开人、进入项目条时都是"平着接上"的，
 * 读起来像一条走线而不是一根拉直的绳子。
 */
function edgePath(edge: MapEdge): string {
  const x1 = edge.from.x
  const y1 = edge.from.y
  const x2 = edge.to.x - MAP_CELL.project.width / 2
  const y2 = edge.to.y
  const reach = reachOf(x2 - x1)
  return `M ${x1} ${y1} C ${x1 + reach} ${y1}, ${x2 - reach} ${y2}, ${x2} ${y2}`
}

export function MapEdges({
  board,
  edges,
}: {
  board: { width: number; height: number }
  edges: MapEdge[]
}) {
  if (edges.length === 0) return null
  return (
    <svg
      className="lite-map-edge-layer"
      width={board.width}
      height={board.height}
      viewBox={`0 0 ${board.width} ${board.height}`}
      // 装饰层：线本身不带信息——「谁背着哪件事」这句话由 mini 卡与高亮的节点说出来，
      // 读屏路径上再念一遍一条看不见的曲线只是噪音。
      aria-hidden="true"
      focusable="false"
    >
      {edges.map((edge) => (
        <path
          key={`${edge.personId}→${edge.projectId}`}
          className="lite-map-edge"
          d={edgePath(edge)}
        />
      ))}
    </svg>
  )
}
