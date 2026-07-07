export interface Pt {
  x: number
  y: number
}

// 二次贝塞尔：节点间的柔和弧线（控制点上提）。
// P5 (ADR-0012)：坐标系从 viewBox 0–100 改为 board px → lift 从固定 8 单位改为按距离比例，
// 使任意尺度下弧度观感一致。SvgEdgeLayer / NexusEdgeLayer 用 board 尺寸 viewBox。
export function edgePath(from: Pt, to: Pt): string {
  const cx = (from.x + to.x) / 2
  const dist = Math.hypot(to.x - from.x, to.y - from.y)
  const lift = Math.max(36, dist * 0.12)
  const cy = Math.min(from.y, to.y) - lift
  return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`
}
