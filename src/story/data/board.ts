// P5 ④⑤⑥ (ADR-0012)：board 绝对坐标系。world 对象（节点 / 连线 / briefing / 结果卡 /
// 背景表面）全部活在这一套 board 像素空间里，由 react-zoom-pan-pinch 整体 pan/zoom。
// 单位永远是 board px——禁 vw / 视口% / clamp(...100%)（那些只在 HUD 合法）。
// board 可比视口大；装不下交给运行时导航（memory: prefer-runtime-navigation-over-handtuned-layout）。

export interface Pos {
  x: number
  y: number
}

export interface BoardRect {
  x: number
  y: number
  width: number
  height: number
}

// 一套 board 供 Dashboard 与 Nexus 共用（强化 ADR-0004「同一产品两面」）。
// 修订 2：board 取**宽屏比例**（~16:10），让 Dashboard 软团队聚簇的 full-fit 横向填满、
// glance scale 抬到 ~0.55（board 过高是 calm 太小的首因）。Nexus 竖向流仍在此板内向下铺，
// 溢出由 pan/zoom 兜（memory: prefer-runtime-navigation-over-handtuned-layout）。
export const BOARD = { width: 2600, height: 1640 }
export const BOARD_CENTER: Pos = { x: BOARD.width / 2, y: BOARD.height / 2 }

// feat-004 (ADR-0014 决策 7)：节点链退场后 Nexus board 只装 Manifest 双列瀑布，
// 相应缩窄。Dashboard 用宽 BOARD、Nexus 用这块——PanZoomCanvas 的 board 尺寸按 scene
// 传入，同一 rzpp 基座。
export const NEXUS_BOARD = { width: 2300, height: 2700 }

const DEG = Math.PI / 180

// 极坐标 → board 笛卡尔。angle 以「正上方 = -90°」、顺时针为正。
export function polar(center: Pos, radiusPx: number, angleDeg: number): Pos {
  const a = angleDeg * DEG
  return {
    x: center.x + radiusPx * Math.cos(a),
    y: center.y + radiusPx * Math.sin(a),
  }
}

// 一组 board 点 + 各自半宽/半高 → 包围盒（镜头 fit 用）。
export function bboxOf(items: Array<{ pos: Pos; halfW: number; halfH: number }>): BoardRect | null {
  if (items.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const { pos, halfW, halfH } of items) {
    minX = Math.min(minX, pos.x - halfW)
    minY = Math.min(minY, pos.y - halfH)
    maxX = Math.max(maxX, pos.x + halfW)
    maxY = Math.max(maxY, pos.y + halfH)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
