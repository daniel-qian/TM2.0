import { AnimatePresence, motion, useReducedMotion, type Transition } from 'framer-motion'
import { useEffect, useReducer, useRef, type ReactNode } from 'react'

// feat-052 · lite2 统一 modal 基座（PRD G15「统一 modal 基座」/ kickoff feat-052）。
//
// 为什么存在：本波要铺草稿框（058）、项目详情（055）、人卡详情多个弹层。各写各的 → 关闭方式、
// 滚动行为、层级三处不一致（现状即如此：DetailOverlay 点背景能关、OnboardWizard 不能；两边都
// 不锁背景滚动；都没有进出场动画和焦点管理）。基座把这几件事收成一处：
//
//   ① 背景点击关闭   ② Esc 关闭（只有栈顶弹层响应）   ③ body 滚动锁（引用计数）
//   ④ 进出场动画（framer-motion，观感与 story 既有转场同参：0.24s / ease [0.16,1,0.3,1]）
//   ⑤ 焦点管理（开 → 焦点进面板；关 → 还给开之前的元素；Tab 在面板内成环）
//   ⑥ 层级统一（.lite-modal-layer 单一 z-index 令牌，见 lite2.css）
//
// 🔴 不许 portal 到 document.body：观感令牌挂在 .lite2-shell[data-look]（look.ts），靠 DOM
// 继承下发。portal 出壳 = 两张皮的令牌全部丢失（aurora 直接塌回 paper 变量的缺省值）。
// 弹层必须留在壳内渲染——这也是 paper/aurora 双皮兼容的全部实现代价。
//
// 用法（055/058 照这个接）：调用方**常驻挂载**，用 open 开关，别在父层 `{cond ? <X/> : null}`
// ——那样出场动画没机会跑（组件被直接摘掉）。
//
//   <LiteModal
//     open={Boolean(draft)}
//     onClose={closeDraft}
//     ariaLabel={t.lite2.draftAria}
//     backdropLabel={t.lite2.draftClose}
//     panelClassName="lite-draft-card"
//     panelData={{ 'data-draft-id': draft?.id }}
//   >
//     …面板内容（面板本身由基座渲染：role=dialog + aria-modal + 焦点容器）…
//   </LiteModal>
//
// open 从 true→false 后，children 仍会被渲染约一帧的出场时长。若内容来自会被清空的 store 字段
// （如 store.detail），调用方需留一份"最后一帧"快照，否则关闭瞬间面板会闪空——DetailOverlay.tsx
// 有现成写法可抄。

// 可聚焦元素：统一排掉 tabindex="-1" 与 aria-hidden（OnboardWizard 的隐藏 file input 两条都占，
// 不排掉会把焦点环第一站送进一个看不见的控件）。
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
]
  .map((sel) => `${sel}:not([tabindex="-1"]):not([aria-hidden="true"])`)
  .join(',')

// ── 模块级单例状态（"单例基座"的实处）─────────────────────────────────────────────
// 栈：同时开多个弹层时，只有栈顶响应 Esc / 吃 Tab 环，避免一次 Esc 连关两层。
const openStack: symbol[] = []

// 滚动锁引用计数：body 在 ≤860px 断点是 overflow:auto（00-base.css），弹层期间必须锁死；
// 桌面断点 body 本就 overflow:hidden，这里是幂等的无操作。多层同开只锁一次、最后一层关才还原。
let lockCount = 0
let restoreOverflow: string | null = null

function lockBodyScroll() {
  if (typeof document === 'undefined') return
  lockCount += 1
  if (lockCount > 1) return
  restoreOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
}

function unlockBodyScroll() {
  if (typeof document === 'undefined') return
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount > 0) return
  document.body.style.overflow = restoreOverflow ?? ''
  restoreOverflow = null
}

// 面板上的稳定断言钩子（门按 data-* 断言 DOM，见 OnboardWizard 的 data-onboard-step）。
export type LiteModalPanelData = Record<`data-${string}`, string | undefined>

export interface LiteModalProps {
  /** 开关。false 时基座仍挂载（出场动画需要），只是不渲染层。 */
  open: boolean
  /** 背景点击 / Esc / 基座任何关闭路径都走它。语义由调用方定（关闭、暂停、取消……）。 */
  onClose: () => void
  /** 弹层的无障碍名（role=dialog 的 aria-label）。 */
  ariaLabel: string
  /**
   * 背景关闭按钮的无障碍名。背景是个真 `<button>`（不是裸 div），所以指针和读屏都能用它关。
   * 🔴 但它**不在焦点环里**——焦点环只取面板内的可聚焦元素（见下方 Tab 处理），而背景是面板的
   * 兄弟节点，Tab / Shift+Tab 都到不了它。键盘用户的关闭路径是 `Esc`。
   * 推论（055/058 注意）：若你设 `closeOnEsc={false}`，**面板内必须自带关闭控件**，否则键盘
   * 用户会被关在弹层里出不来。
   */
  backdropLabel: string
  children: ReactNode
  /** 面板的外观类（宽度/内边距/背景由调用方的既有类给，基座只管定位与行为）。 */
  panelClassName?: string
  /** 层的附加类（极少用；需要给某个弹层单独调对齐时才给）。 */
  layerClassName?: string
  /** 面板上的 data-* 断言钩子。 */
  panelData?: LiteModalPanelData
  /** 点背景是否关闭。默认 true——除非有未保存内容，否则别关。 */
  closeOnBackdrop?: boolean
  /** Esc 是否关闭。默认 true。 */
  closeOnEsc?: boolean
}

// 出场看门狗上限。AnimatePresence 的**卸载**由帧循环驱动：exit 动画跑完才 safeToRemove。
// 帧循环一停摆，被关掉的层就永久留在 DOM——而它是 position:fixed;inset:0;z-index:120 的
// 全屏遮罩，等于整页点不动。所以给出场设一个硬上限：到点还没卸载就跳过动画直接卸。
// 正常路径 240ms 就完事，永远轮不到它触发。
const EXIT_WATCHDOG_MS = 700

export function LiteModal({
  open,
  onClose,
  ariaLabel,
  backdropLabel,
  children,
  panelClassName,
  layerClassName,
  panelData,
  closeOnBackdrop = true,
  closeOnEsc = true,
}: LiteModalProps) {
  const prefersReducedMotion = useReducedMotion()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const wasOpenRef = useRef(false)

  // onClose / 开关项走 ref：键盘监听只在 open 变化时注册一次，调用方传内联箭头函数也不会
  // 每帧重挂监听。
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const closeOnEscRef = useRef(closeOnEsc)
  closeOnEscRef.current = closeOnEsc

  // 开：进栈 + 锁滚动 + 焦点进面板；关（含卸载）：反向全还原。
  useEffect(() => {
    if (!open) return

    const token = Symbol('lite-modal')
    openStack.push(token)
    lockBodyScroll()
    wasOpenRef.current = true

    const previouslyFocused =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null

    // 焦点落在面板本身（tabIndex=-1）而不是首个按钮：读屏会念出 dialog 名，且不会给"关闭"
    // 按钮套上视觉焦点环（一开弹层就高亮关闭键的观感很差）。
    panelRef.current?.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      // 只有栈顶弹层响应——否则一次 Esc 会把向导和详情一起关掉。
      if (openStack[openStack.length - 1] !== token) return

      if (event.key === 'Escape') {
        if (!closeOnEscRef.current) return
        event.stopPropagation()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return

      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      )
      const active = document.activeElement as HTMLElement | null

      // 面板内没有可聚焦元素（纯只读内容）：Tab 原地留在面板，不许漏到背后的页面。
      if (items.length === 0) {
        event.preventDefault()
        panel.focus({ preventScroll: true })
        return
      }

      const first = items[0]
      const last = items[items.length - 1]
      const outside = !active || !panel.contains(active) || active === panel

      if (event.shiftKey) {
        if (outside || active === first) {
          event.preventDefault()
          last.focus()
        }
      } else if (outside || active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      const at = openStack.indexOf(token)
      if (at >= 0) openStack.splice(at, 1)
      unlockBodyScroll()
      // 焦点还给开之前的元素（键盘用户关掉弹层后不会被扔回文档开头）。
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
  }, [open])

  // 🔴 弹层的"可见"与"消失"都不许押在动画帧上。后台标签页里 requestAnimationFrame 不跑，
  // framer-motion 的帧循环随之停摆，两头都出事，且都是实测复现的（feat-052，
  // document.visibilityState='hidden'）：
  //   · 进场：层与面板一直卡在 initial 值上，opacity 恒为 0 —— 弹层等于没出现。
  //   · 出场：AnimatePresence 的 exit 永远跑不完，被关掉的层**永久留在 DOM**，opacity 恒为 1、
  //     pointer-events auto —— 一块全屏遮罩糊在 UI 上，按了 Esc 弹层纹丝不动、整页点不动。
  // 首访向导是自动弹的：浏览器恢复会话时在后台标签页开着 Avery，正是这个场景。
  //
  // 所以帧循环不可信时整条走**静态分支**：不进 AnimatePresence、不挂 motion 值，open=false 由
  // React 直接卸载。正常路径（前台标签页）零影响，照走 0.24s 动画。
  const frameLoopStalled = typeof document === 'undefined' || document.visibilityState === 'hidden'

  // 静态模式只在 open **翻转时**重算一次，不是每次渲染都算：open 期间父层重渲染若把
  // motion.div 换成 div（元素类型变了），整棵子树会重挂载——焦点、面板内的输入态全丢。
  const staticModeRef = useRef(false)
  const prevOpenRef = useRef<boolean | null>(null)
  if (prevOpenRef.current !== open) {
    prevOpenRef.current = open
    staticModeRef.current = frameLoopStalled
  }

  // 看门狗：兜住"visibilityState 是 visible、但帧循环照样不转"的环境（无头驱动、被降频的
  // 标签页）。setTimeout 不依赖 rAF，所以帧循环死了它照样到点。到点仍未卸载 → 转静态分支
  // 直接卸。开关重开时上面的翻转逻辑会把它重置，不会粘住。
  const [, forceRender] = useReducer((n: number) => n + 1, 0)
  const watchdogRef = useRef<number | null>(null)
  const clearWatchdog = () => {
    if (watchdogRef.current === null) return
    window.clearTimeout(watchdogRef.current)
    watchdogRef.current = null
  }
  useEffect(() => {
    if (open || !wasOpenRef.current) return
    wasOpenRef.current = false
    watchdogRef.current = window.setTimeout(() => {
      watchdogRef.current = null
      staticModeRef.current = true
      forceRender()
    }, EXIT_WATCHDOG_MS)
    return clearWatchdog
  }, [open])

  const staticMode = staticModeRef.current

  // 观感与 story 既有转场同参（DashboardScene.tsx 的 transition），reduced-motion 直接零时长。
  const transition: Transition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.24, ease: [0.16, 1, 0.3, 1] }
  const panelMotion = prefersReducedMotion
    ? { animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 6, scale: 0.99 },
      }
  const panelInitial = prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.985 }

  const dismiss = () => {
    if (closeOnBackdrop) onClose()
  }

  const layerClass = `lite-modal-layer${layerClassName ? ` ${layerClassName}` : ''}`
  const panelClass = `lite-modal-panel${panelClassName ? ` ${panelClassName}` : ''}`
  const backdrop = (
    <button
      type="button"
      className="lite-modal-backdrop"
      aria-label={backdropLabel}
      onClick={dismiss}
    />
  )

  // 静态分支：完全不进 AnimatePresence。open=false → 返回 null → React 同步卸载，
  // 不等任何动画帧。层与面板落的就是终态（CSS 缺省 opacity:1 / 无 transform），
  // 与动画跑完的样子一致。
  if (staticMode) {
    if (!open) return null
    return (
      <div className={layerClass}>
        {backdrop}
        <div
          ref={panelRef}
          className={panelClass}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          tabIndex={-1}
          {...panelData}
        >
          {children}
        </div>
      </div>
    )
  }

  return (
    // exit 真跑完时撤掉看门狗——正常路径（帧循环健在）连那次多余渲染都不会发生。
    <AnimatePresence onExitComplete={clearWatchdog}>
      {open ? (
        <motion.div
          key="lite-modal"
          className={layerClass}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
        >
          {backdrop}
          <motion.div
            ref={panelRef}
            className={panelClass}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            tabIndex={-1}
            transition={transition}
            initial={panelInitial}
            {...panelMotion}
            {...panelData}
          >
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
