import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch'
import { useDict } from '../../shared/i18n/useDict'
import type { MapRect } from './mapLayout'

// team-map-revival-0804 · B1 · 地图页的薄 pan/zoom 基座。
//
// ⚠ 墙纪律（ADR-0022 + feat-035 §架构拍板 5）：**不 import、不改 `src/story/**`**。
// story 的 `PanZoomCanvas.tsx` 是冻结路演资产，这里是 lite2 自己的、独立成文件的薄 wrapper，
// 只包 react-zoom-pan-pinch（npm 依赖，已在 package.json，非 story 私有）。
// 先例是 v01 的 `src/lite/LitePanZoom.tsx`（feat-025 同一条墙纪律下写的）——参照那种写法，
// 但完全独立：v01 那个无 world 坐标（内容自然流动），这个把 content 钉死成 board 像素方框，
// world 对象用 board 绝对坐标定位、整体随镜头缩放（ADR-0012 修订 1 的 scale 契约）。
//
// 07-29「全站纵向滚动」那条拍板对本页有明文豁免（PRD §0「pan/zoom 语法特区」，Danny 08-05
// 随方案 B 一并放行）：整页没有纵向滚动面，所以滚轮 = 缩放不构成滚轮劫持——那条拍板防的是
// 「页面本来能滚，滚轮却被画布吃掉」，这里不存在那个面。

/** 镜头留白比例：fit 之后四周留一点呼吸，别让内容顶死安全矩形。 */
const FIT_PADDING = 0.94

/**
 * fit 之后允许的最大 scale。小团队（≤3 人，PRD §3.6）board 很小，不加这个夹子会被放大到
 * 头像糊掉——「装得下」不等于「该放这么大」。
 */
const MAX_FIT_SCALE = 1.1

/**
 * 🔴 fit 之后允许的**最小** scale ——「可读帧」这三个字里的「可读」。
 *
 * 纯 fit-width 在手机上会算出 0.198（板宽 1852 / 视口 390）：整块板缩成一张缩略图，
 * 名字 2.6px、下面还剩一大片空白点阵，第一眼读起来是**坏了**而不是**总览**。
 * Q3 拍板是「不做手机专门布局」——同一块板、小一点的窗口，**不是同一块板缩到看不见**。
 * 所以这里给一个地板：小窗口宁可只看得见板的左上角（拖动到达其余部分，画布本来就是干这个的），
 * 也不把内容缩到读不动。0.6 ≈ 桌面 fit 出来的 0.73 的同一量级，两个视口上字号观感一致。
 * 桌面/笔电（fit 分别是 0.73 / 0.65）都在地板之上，行为一字不变。
 */
const MIN_FIT_SCALE = 0.6

const MIN_SCALE = 0.12
const MAX_SCALE = 2.2

/** 内容超出安全矩形时，贴边留的呼吸边（屏幕 px）。 */
const EDGE_PAD = 24

/**
 * 初始镜头 = **fit-width 可读帧**（ADR-0012 修订 6 公式，对着
 * `src/story/lib/useRailCamera.ts` 的 `computeTransform(mode:'width-top')` 移植）：
 * 只按宽度定 scale、**装不下的那一头允许出帧**——看不全交给 pan/zoom，而不是把整块内容
 * 缩到读不动为止（修订 1-3 的全图 contain fit 就是那个下场）。
 *
 * 移植时补的一条（story 那份没有，因为它的 board 恒比视口高）：**装得下就居中，装不下才贴边**。
 * 顶锚存在的理由是「内容比画面高，从头开始读」；内容比画面矮的时候顶锚只是把它顶在天花板上、
 * 底下空一大片（手机上实测就是这个样子）。两轴各自判断：
 *   · 宽度装得下 → 水平居中；装不下 → 左边贴边（从名册开始读，而不是从左右两列中间的空档开始）。
 *   · 高度装得下 → 垂直居中；装不下 → 顶边贴齐（＝原修订 6 的顶锚）。
 *
 * screen = board * scale + position ⇒ position = safeCenter - boardCenter * scale
 */
function fitBoard(wrapper: HTMLElement, board: { width: number; height: number }) {
  const safeW = Math.max(40, wrapper.clientWidth)
  const safeH = Math.max(40, wrapper.clientHeight)
  const rawScale = (safeW / Math.max(1, board.width)) * FIT_PADDING
  const scale = Math.max(MIN_SCALE, Math.min(MAX_FIT_SCALE, Math.max(MIN_FIT_SCALE, rawScale)))
  const scaledW = board.width * scale
  const scaledH = board.height * scale
  return {
    x: scaledW <= safeW ? safeW / 2 - scaledW / 2 : EDGE_PAD,
    y: scaledH <= safeH ? safeH / 2 - scaledH / 2 : EDGE_PAD,
    scale,
  }
}

/**
 * 「这一下算点击还是算拖动」的判据（屏幕 px）。
 *
 * 🔴 必须有这个阈值：画布上每一次 pan 都以 pointerdown 开头、pointerup 收尾，只看
 * "抬手时下面是空白" 的话，**每拖一下板都会把 focus 清掉**——用户想挪一下看清连线，
 * 结果连线没了。6px 是手指/触控板的抖动量级，比它大的位移一律当拖动。
 */
const CLICK_SLOP = 6

/**
 * 抬手落在这些东西上不算「点空白」：它们各自有自己的点击语义。
 * ⚠ 这里**没有** `.lite-map-hud`：B3 的 HUD-lite 在画布外面（页头那一带，见 MapScreen），
 * 它的点击根本到不了本处理器。写进来会是一根永远判不到任何东西的死针。
 */
const INTERACTIVE_WITHIN = '.lite-map-person, .lite-map-project, .lite-map-controls'

/** 动效开关。像素基线 runner 恒开 reducedMotion，于是镜头是**瞬移**——基线里没有中间帧。 */
function prefersReducedMotion(): boolean {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function MapPanZoom({
  board,
  ariaLabel,
  onBackgroundClick,
  extraControls,
  focusKey,
  focusRect,
  children,
}: {
  board: { width: number; height: number }
  ariaLabel: string
  /** 点空白（不是拖动、不是点节点）→ 回 calm。B2 的「点空白回 calm」就落在这里。 */
  onBackgroundClick?: () => void
  /** HUD 胶囊里额外塞的按钮（B2 的「回到全景」只在 focus 时出现）。 */
  extraControls?: ReactNode
  /**
   * 这一次 focus 的**身份**（URL token 或 null）。镜头只在它变化时动一次——
   * 🔴 不能拿 `focusRect` 当依赖：那是个每次渲染都可能换引用的对象，一旦某天上游的 memo
   * 断了，镜头会在每一帧把用户刚拖到的位置抢回去（「跟随」变成「拽着不放」）。
   */
  focusKey?: string | null
  /** 该进画面的方框（board px）。null = 这次 focus 没有可框的东西。 */
  focusRect?: MapRect | null
  children: ReactNode
}) {
  const ref = useRef<ReactZoomPanPinchRef | null>(null)
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null)
  // 「刚才那一下是拖动」——由 pointerup 判定，供紧随其后的 click 在捕获期读（见 onClickCapture）。
  const draggedRef = useRef(false)
  const { t } = useDict()
  // board 走 ref 而不是进 applyFit 的闭包：`onInit` 是 rzpp 只调一次的回调，捕获到的那份
  // 闭包会一直是首帧那一份。读 ref 才保证「换了公司之后点复位」用的是新板的尺寸。
  const boardRef = useRef(board)
  boardRef.current = board

  const applyFit = useCallback((animate: boolean) => {
    const api = ref.current
    const wrapper = api?.instance.wrapperComponent
    if (!api || !wrapper) return
    const fit = fitBoard(wrapper, boardRef.current)
    api.setTransform(fit.x, fit.y, fit.scale, animate ? 320 : 0, 'easeOut')
  }, [])

  // 🔴 落位**不能**挂 `useLayoutEffect`。第一版就是那么写的，实测镜头纹丝不动停在
  // initialScale 0.5：rzpp 在自己的挂载流程里把 initialScale 写进 transform，时点晚于父组件的
  // layout effect，于是我们先设的值当场被它盖掉。当时所有计数判据都是绿的（分区 10 / 人 16 /
  // 项目 6 全对），只有截图上那一片空白露了馅——「数得对」和「镜头对」是两回事。
  //
  // 下面这条是**被动** effect：子组件（TransformWrapper）的 effect 先跑、父组件后跑，
  // 所以它落在 rzpp 写完 initialScale 之后，盖得过它。依赖里带 board 是因为它同时管**换板**
  // （换了公司 / 加了人 → 这是另一块板，镜头没理由停在上一块的坐标上）。
  //
  // ⚠ 它与下面 TransformWrapper 的 `onInit` 是**两把独立的锁**，变异实测（本票 born-red）：
  //     两把都拆 → 判据红（scale 停在 0.5）· 只留 onInit → 绿 · 只留本 effect → 绿。
  //   也就是说单看首帧它俩互为冗余，**谁都能单独让判据变绿**——所以别把「判据绿了」读成
  //   「两条都在起作用」。留着两条各有各的射程：本 effect 管换板（onInit 一辈子只响一次），
  //   onInit 管「父 effect 跑的时候 rzpp 还没量到 wrapper」那个窗口（那时 applyFit 会静默
  //   空转）。B3 给这条写门时，两把锁要各配一个专属变异，别拿一条变异当两条用。
  useEffect(() => {
    applyFit(false)
  }, [board, applyFit])

  /**
   * 🔴 B3 ·「点击聚焦对应簇」里的那个**聚焦**：把亮起来的那一撮东西带进画面。
   *
   * ## 它修的是什么
   * 80 人的板宽 3476px，可读地板（`MIN_FIT_SCALE`）下首帧只框得住约 2400px。点一个人，
   * 他的项目条在右边 2000px 开外——两条连线径直跑出右边框，屏幕上只剩一个亮着的圆点和两个
   * 线头。整张图存在的理由恰好在最需要它的那一刻看不见（B2 收尾时实测记档，见回执）。
   *
   * ## 三条口径（每一条都是一次「别抢用户的镜头」）
   * ① **已经全看得见就一个像素都不动**。demo-seed 那种板本来就装得下，镜头一动不动——
   *    B2 验过的手感一字不变，也让「跟随」不会变成每点一下都晃一下。
   * ② **只缩小、绝不放大**（`Math.min(scale, need)`）。放大到一个人身上看着像「它替我
   *    决定了该看多近」，而且回到全景时的落差会让人以为换了一块板。
   * ③ 装不下才动，动就**居中**——半推半就地只挪到刚好贴边，下一次微小的 focus 变化又要再挪，
   *    读起来是镜头在抖。
   *
   * ⚠ 有意识地允许缩到 `MIN_FIT_SCALE`（可读地板）**以下**：手机竖屏上一个人与他的项目条
   * 相距 1100 board px，两头都要进画面就只能缩到 0.30 左右，那时字是读不动的。
   * 权衡是清醒做的——focus 只有一个职责，就是**把那条关系指出来**，只框住一头等于没框
   *（那正是 B2 收尾时记档的原始问题）。看不清可以捏合放大，也可以「回到全景」原路退回；
   * 而看不见就是看不见。初始帧仍然守着地板不变（`fitBoard`）：那一帧是「这家公司长什么样」，
   * 必须能读。两处地板不同，是因为两处回答的不是同一个问题。
   *
   * `animate=false` 是**深链**那一路（首帧就该已经框好，见 onInit 那段）：用户没点过任何东西，
   * 给他放一段从 fit 帧飞过来的动画，等于表演一次他没做过的操作。
   */
  const ensureVisible = useCallback((rect: MapRect, animate = true) => {
    const api = ref.current
    const wrapper = api?.instance.wrapperComponent
    if (!api || !wrapper) return
    const { scale, positionX, positionY } = api.instance.transformState
    const safeW = Math.max(40, wrapper.clientWidth)
    const safeH = Math.max(40, wrapper.clientHeight)
    const left = rect.x * scale + positionX
    const top = rect.y * scale + positionY
    const right = left + rect.width * scale
    const bottom = top + rect.height * scale
    if (left >= EDGE_PAD && top >= EDGE_PAD && right <= safeW - EDGE_PAD && bottom <= safeH - EDGE_PAD) {
      return
    }
    const roomW = Math.max(40, safeW - EDGE_PAD * 2)
    const roomH = Math.max(40, safeH - EDGE_PAD * 2)
    const need = Math.min(roomW / Math.max(1, rect.width), roomH / Math.max(1, rect.height))
    const next = Math.max(MIN_SCALE, Math.min(scale, need))
    api.setTransform(
      safeW / 2 - (rect.x + rect.width / 2) * next,
      safeH / 2 - (rect.y + rect.height / 2) * next,
      next,
      animate && !prefersReducedMotion() ? 320 : 0,
      'easeOut',
    )
  }, [])

  // rect 走 ref：依赖只认 focusKey（见 props 注释）。声明序在 fit effect **之后**——
  // React 按源码序跑 effect，反过来的话首帧的深链会被紧随其后的 fit 当场盖掉。
  const focusRectRef = useRef(focusRect)
  focusRectRef.current = focusRect
  // 🔴 **首帧不放动画**。深链（`/map?focus=person:小徐` 直接打开）是「开门就该看见」，
  // 用户没点过任何东西，给他放一段从全景飞过去的动画等于表演一次他没做过的操作。
  // 之后每一次 focus 变化才动画——那时镜头怎么走过去，本身就是要给人看的信息。
  //
  // ⚠ 顺带治了一个能把像素基线冻成假象的陷阱：`page.clock.setFixedTime` 冻住 `Date.now()`，
  // 而 rzpp 的动画进度是拿它算的——一冻，动画永远停在第 0 帧。像素 spec 恰好既钉钟又走深链，
  // 于是首帧那张冻进去的是「还没飞过去」的样子：手机上就是**亮着的那一簇整个在画面外**。
  // 判据全绿（连线在、mini 卡在），只有手机那张基线看得出来（#106 B3 实收）。
  const framedOnceRef = useRef(false)
  useEffect(() => {
    const rect = focusRectRef.current
    if (!rect) return
    ensureVisible(rect, framedOnceRef.current)
    framedOnceRef.current = true
  }, [focusKey, board, ensureVisible])

  // 跨屏不 mis-fit：视口变了按同一把尺重算（含手机横竖屏切换）。
  useEffect(() => {
    function onResize() {
      applyFit(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [applyFit])

  // 拖动与点击在画布上共用同一串指针事件（pointerdown → move* → pointerup → click），
  // 所以「这一下算不算点击」必须有**一个**判据、判在**一个**地方。
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    pointerDownAt.current = { x: event.clientX, y: event.clientY }
    draggedRef.current = false
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const down = pointerDownAt.current
    pointerDownAt.current = null
    draggedRef.current = !!down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_SLOP
  }

  /**
   * 🔴 拖动之后那一下 `click` **必须在捕获期就掐掉**，而不是只在背景处理里 return。
   *
   * 实测踩到的：从一个人节点上按下去拖板——rzpp 把 content 跟着指针一起平移，于是**同一个
   * 节点一直待在指针底下**，抬手时 down/up 目标相同，浏览器照常派发一次 click，节点的
   * onClick 就把他选中了。用户只想挪一下板看清连线，结果 focus 跳到了另一个人身上。
   *
   * 捕获期在目标自己的 onClick **之前**跑（React 的合成事件按同一条传播路径走），
   * 所以在这里 stopPropagation 能一次拦住节点、HUD、背景全部三种点击——一个判据、一个地方。
   */
  function onClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (draggedRef.current) {
      draggedRef.current = false
      event.stopPropagation()
      event.preventDefault()
      return
    }
    if (!onBackgroundClick) return
    const el = event.target as Element | null
    // 点在节点/HUD 上 → 那是它们自己的点击，不是「点空白」。
    if (el?.closest?.(INTERACTIVE_WITHIN)) return
    onBackgroundClick()
  }

  return (
    <div
      className="lite-map-canvas"
      aria-label={ariaLabel}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onClickCapture={onClickCapture}
    >
      <TransformWrapper
        ref={ref}
        initialScale={0.5}
        minScale={MIN_SCALE}
        maxScale={MAX_SCALE}
        limitToBounds={false}
        centerOnInit={false}
        // rzpp 初始化完成（wrapper 已量到尺寸）的确定时点。与上面那条被动 effect 是两把
        // 独立的锁，各自的射程与变异实测结果写在那一段——本行不是它的重复，是它够不着
        // 「rzpp 还没量到 wrapper」那个窗口时的兜底。
        onInit={(api) => {
          ref.current = api
          applyFit(false)
          // ⚠ 这里**刻意不做** focus 框选。试过，是错的：紧随其后的那条被动 effect 会再跑一次
          // `applyFit`，把刚框好的镜头一把推回 fit 帧。首帧的 focus 归下面那条 effect 管
          //（它排在 applyFit 之后），一件事只留一处。
        }}
        // 双击禁用（PRD §4）：双击缩放会和 B2 的「点节点 → focus」抢同一串事件。
        doubleClick={{ disabled: true }}
        wheel={{ step: 0.12 }}
        panning={{ velocityDisabled: true }}
      >
        {/* HUD 层：viewport-fixed，不进 world（ADR-0012 修订 1 的 world/HUD 分层铁律——
            world 对象只许 board px，视口单位只有 HUD 能用）。
            🔴 它是 `TransformComponent` 的**兄弟**而不是它的孩子：进了 transform 就会跟着
            镜头缩放平移，那时它就不是 HUD 了，是一个飘在世界里的大按钮。 */}
        <div className="lite-map-controls">
          <span className="lite-map-hint">{t.lite2.mapCanvasHint}</span>
          {extraControls}
          <button
            type="button"
            className="lite-btn lite-btn--ghost lite-map-reset"
            onClick={() => applyFit(true)}
          >
            {t.lite2.mapCanvasReset}
          </button>
        </div>
        <TransformComponent
          wrapperClass="lite-map-panzoom-wrapper"
          contentClass="lite-map-panzoom-content"
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: `${board.width}px`, height: `${board.height}px` }}
        >
          {children}
        </TransformComponent>
      </TransformWrapper>
    </div>
  )
}
