import { useRef, type ReactNode } from 'react'
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch'
import { useDict } from '../shared/i18n/useDict'

// feat-025 · Danny 2026-07-09 拍板 Q3(a)：lite room 薄可拖拽/缩放画布。
// ⚠ 墙纪律：不 import / 不改 src/story/components/PanZoomCanvas.tsx（story 冻结资产）——
// 这是一个 lite 自己的、独立成文件的薄 pan/zoom wrapper，只包 react-zoom-pan-pinch
// （npm 依赖，已在 package.json，非 story 私有）。参照 story 那 41 行写法但完全独立。
//
// 与 story PanZoomCanvas 的差异：story 版把 content 钉死成 BOARD 像素方框（world 绝对坐标 +
// rail 相机命令式驱动）；lite 版无 rail、无 world 坐标——content 随内容自然流动（8 字段卡 +
// 终端），只给 pan + wheel-zoom + pinch + 一个「复位」按钮。镜头状态自持（不进任何 store）。
export function LitePanZoom({ children }: { children: ReactNode }) {
  const ref = useRef<ReactZoomPanPinchRef | null>(null)
  const { t } = useDict()

  return (
    <div className="lite-room-canvas" aria-label="The room — board">
      <TransformWrapper
        ref={ref}
        initialScale={1}
        minScale={0.4}
        maxScale={2.2}
        limitToBounds={false}
        centerOnInit={false}
        doubleClick={{ disabled: true }}
        wheel={{ step: 0.1 }}
        panning={{ velocityDisabled: true, excluded: ['input', 'textarea', 'button'] }}
      >
        <div className="lite-room-canvas-controls" aria-hidden="false">
          <span className="lite-room-canvas-hint">{t.lite.roomCanvasHint}</span>
          <button
            type="button"
            className="lite-room-canvas-reset"
            onClick={() => ref.current?.resetTransform()}
          >
            {t.lite.roomCanvasReset}
          </button>
        </div>
        <TransformComponent
          wrapperClass="lite-panzoom-wrapper"
          contentClass="lite-panzoom-content"
          wrapperStyle={{ width: '100%', height: '100%' }}
        >
          {children}
        </TransformComponent>
      </TransformWrapper>
    </div>
  )
}
