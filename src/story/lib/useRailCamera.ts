import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import type { BoardRect } from '../data/board'

// P5 跨④⑤ (ADR-0012 决策 4 + 修订 3/4/5/6)：rail 派生镜头。
// 镜头目标 = 当前 step / focus 的纯函数（由 scene 算出 board bbox 传入），不进 store；
// seek 倒带后自洽重算。两种相反取景，复用同一套 fit 机器：
//   · calm / 静息 = fit-width 顶锚「可读帧」（修订 6：宽度装满、顶边贴齐、底部允许出帧，
//     看不全交给 pan/zoom——取代修订 1-3 的全图 contain fit）。
//   · step / focus = contain 飞向局部 bbox（活跃簇 ＋ 该拍结果卡）。
// fit 到「HUD-safe 视口矩形」（视口减 Topbar/composer margin）。

export interface SafeInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export type CameraFitMode = 'contain' | 'width-top'

export interface CameraTarget {
  bbox: BoardRect
  // contain（默认）= 整 bbox 居中装入安全矩形；width-top = 只按宽度定 scale、顶边锚定。
  mode?: CameraFitMode
}

interface CameraOptions {
  // fit 后允许的最大 scale。calm 给小值守住全图；step 给 ~1.1 让结果卡可读、又不过度放大小簇。
  maxFitScale?: number
  // 包围盒四周留白比例（safe 矩形内）。
  padding?: number
  // 动画时长 ms。
  animationTime?: number
}

const MIN_SCALE = 0.08

function computeTransform(
  wrapper: HTMLDivElement,
  target: CameraTarget,
  insets: SafeInsets,
  maxFitScale: number,
  padding: number,
) {
  const { bbox, mode = 'contain' } = target
  const W = wrapper.clientWidth
  const H = wrapper.clientHeight
  const safeW = Math.max(40, W - insets.left - insets.right)
  const safeH = Math.max(40, H - insets.top - insets.bottom)

  const rawScale =
    mode === 'width-top'
      ? (safeW / bbox.width) * padding
      : Math.min(safeW / bbox.width, safeH / bbox.height) * padding
  const scale = Math.max(MIN_SCALE, Math.min(maxFitScale, rawScale))

  const safeCenterX = insets.left + safeW / 2
  const boardCenterX = bbox.x + bbox.width / 2

  if (mode === 'width-top') {
    // 顶锚：内容顶边贴安全矩形顶部（留 padding 折算的小呼吸边），底部允许出帧。
    const topPad = Math.min(40, (safeW * (1 - padding)) / 2)
    return {
      x: safeCenterX - boardCenterX * scale,
      y: insets.top + topPad - bbox.y * scale,
      scale,
    }
  }

  const safeCenterY = insets.top + safeH / 2
  const boardCenterY = bbox.y + bbox.height / 2

  // screen = board * scale + position  →  position = safeCenter - boardCenter * scale
  return {
    x: safeCenterX - boardCenterX * scale,
    y: safeCenterY - boardCenterY * scale,
    scale,
  }
}

// P6-03 (ADR-0013 决策 5)：组件本地镜头命令——点 Manifest 卡飞向其局部 bbox。
// 与 rail 派生镜头共用同一套 fit 机器；一次性命令式调用，不进 store（ADR-0012）。
// rail 下一拍 depKey 变化照常收回镜头（useRailCamera 的 effect 不知道也不需要知道这次手动飞行）。
export function flyToTarget(
  api: ReactZoomPanPinchRef | null,
  target: CameraTarget,
  insets: SafeInsets,
  options: CameraOptions = {},
) {
  const wrapper = api?.instance.wrapperComponent
  if (!api || !wrapper) return
  const { maxFitScale = 1.1, padding = 0.86, animationTime = 600 } = options
  const t = computeTransform(wrapper, target, insets, maxFitScale, padding)
  api.setTransform(t.x, t.y, t.scale, animationTime, 'easeOut')
}

export function useRailCamera(
  apiRef: RefObject<ReactZoomPanPinchRef | null>,
  target: CameraTarget | null,
  insets: SafeInsets,
  depKey: string,
  options: CameraOptions = {},
) {
  const { maxFitScale = 1.1, padding = 0.86, animationTime = 600 } = options
  const lastTarget = useRef<CameraTarget | null>(null)
  const hasAppliedOnce = useRef(false)

  // 首帧用 layout effect + 瞬时（animationTime 0）落位，避免从默认 transform 闪一下。
  useLayoutEffect(() => {
    if (!target) return
    const api = apiRef.current
    const wrapper = api?.instance.wrapperComponent
    if (!api || !wrapper) return
    lastTarget.current = target
    if (hasAppliedOnce.current) return
    const t = computeTransform(wrapper, target, insets, maxFitScale, padding)
    api.setTransform(t.x, t.y, t.scale, 0)
    hasAppliedOnce.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!target) return
    const api = apiRef.current
    const wrapper = api?.instance.wrapperComponent
    if (!api || !wrapper) return
    lastTarget.current = target
    const t = computeTransform(wrapper, target, insets, maxFitScale, padding)
    const time = hasAppliedOnce.current ? animationTime : 0
    api.setTransform(t.x, t.y, t.scale, time, 'easeOut')
    hasAppliedOnce.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey])

  // 窗口尺寸变化 → 用上次目标瞬时重新 fit（守跨屏不 mis-fit）。
  useEffect(() => {
    function onResize() {
      const api = apiRef.current
      const wrapper = api?.instance.wrapperComponent
      const tgt = lastTarget.current
      if (!api || !wrapper || !tgt) return
      const t = computeTransform(wrapper, tgt, insets, maxFitScale, padding)
      api.setTransform(t.x, t.y, t.scale, 0)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
