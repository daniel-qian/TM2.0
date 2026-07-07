import { forwardRef, type ReactNode } from 'react'
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch'
import { BOARD } from '../data/board'

// P5 ④⑤⑥ (ADR-0012 决策 1)：Dashboard 与 Nexus 共用的 pan/zoom 画板基座。
// 包住现有 DOM（节点 / 连线 / briefing / 结果卡 / 背景表面）即给 pan + wheel-zoom + pinch，
// 保留全部 framer-motion 动效。镜头由 useRailCamera 经 forwardRef 命令式驱动（不进 store）。
// content 固定为 BOARD 像素方框 → world 对象用 board 绝对坐标定位，整体随镜头缩放（修订 1：
// 与 chrome 不再分裂 scale）。
export const PanZoomCanvas = forwardRef<
  ReactZoomPanPinchRef,
  { children: ReactNode; board?: { width: number; height: number } }
>(function PanZoomCanvas({ children, board = BOARD }, ref) {
    return (
      <TransformWrapper
        ref={ref}
        initialScale={0.5}
        minScale={0.08}
        maxScale={2.4}
        limitToBounds={false}
        centerOnInit
        doubleClick={{ disabled: true }}
        wheel={{ step: 0.12 }}
        panning={{ velocityDisabled: true }}
      >
        <TransformComponent
          wrapperClass="panzoom-wrapper"
          contentClass="panzoom-content"
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: `${board.width}px`, height: `${board.height}px` }}
        >
          {children}
        </TransformComponent>
      </TransformWrapper>
    )
  },
)
