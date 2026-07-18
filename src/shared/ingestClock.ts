// feat-068 · ingest 秒表的**时间锚**——两个壳共用（src/shared 是唯一合法共享地）。
//
// ── 为什么这个模块必须存在 ────────────────────────────────────────────────────────────
// 秒表的唯一职责是证明「应用没冻」。feat-068 最初把 startedAt 写成 effect 内的局部常量，
// 于是它跟着**组件**活：surface 一 unmount，锚点就没了；再 mount 时 Date.now() 重新起算，
// 秒表从 0 开始跳。
//
// 这不是小瑕疵，因为 feat-068 自己的中文文案正在主动制造这条路径——ingestingHint 写着
// 「这期间可以先进行下一步」。经理照做：起一发 ingest（真耗时 100–120s）→ 按提示去下一步 →
// t=100s 回来 → 屏幕上写「已用时 4 秒」。比没有秒表更糟：它看起来像上传自己悄悄重来了一遍。
//
// 修法：锚点跟着**这一发 ingest**活，不跟着组件活。它在语义上属于 ingest 状态（也就是
// store），但 store.ts 本波归他人所有、不许碰——所以落在这个模块级单例里。任何 surface
// mid-ingest 挂上来，读到的都是同一个 startedAt，算出的是真实总时长。
//
// 🔴 若将来 store.ts 解锁：正确的归宿是 lite/lite2 store 里的 `ingestStartedAt: number | null`，
// 由 uploadFiles 在 `set({ ingestStatus: 'ingesting' })` 的同一次 set 里写入、在 ready/error
// 时置空。那样锚点与状态天然同一个事务，连下面「谁来清」的时序讨论都不需要。本模块是在
// 不碰 store 的前提下能做到的最好形态，不是理想形态。
//
// ── 单例的边界 ──────────────────────────────────────────────────────────────────────
// 模块级 = 每个已加载的 JS 环境一份。lite 与 lite2 是同一次页面加载里二选一的壳，永远不会
// 同时渲染，所以两壳共用一个锚点不会串。同一个壳里可以有多个 surface 同时挂着
//（lite2 的 OnboardWizard.StepUpload 与 UploadPanel），但它们读的是同一个 store 的
// ingestStatus，对 active 的判断永远一致——共用锚点正是我们要的效果。

import { useEffect, useState } from 'react'

let ingestStartedAt: number | null = null

// 锚定这一发 ingest 的起点。幂等：已经锚过就原样返回，重复调用不会把秒表推回 0。
// 这一点是刻意的——秒表每秒 re-render 一次，每次渲染都会调它。
export function markIngestStart(now: number = Date.now()): number {
  if (ingestStartedAt === null) ingestStartedAt = now
  return ingestStartedAt
}

// 松锚。下一发 ingest 会重新锚定，所以第二次上传不会继承上一次的秒数。
export function clearIngestStart(): void {
  ingestStartedAt = null
}

export function getIngestStartedAt(): number | null {
  return ingestStartedAt
}

// 真实已用秒数。未锚定 → 0。Math.max 兜住时钟回拨（用户改系统时间 / NTP 校正）——
// 秒表宁可停在 0，也不能显示负数。
export function ingestElapsedSeconds(now: number = Date.now()): number {
  if (ingestStartedAt === null) return 0
  return Math.max(0, Math.floor((now - ingestStartedAt) / 1000))
}

// feat-068 · 秒表 hook。三个壳里的三处 surface 共用这一份实现。
//
// 与被它取代的旧实现的关键差别：`seconds` 不再是组件 state。组件 state 里现在只有一个
// 无意义的 tick 计数器，秒数每次都从模块级锚点**现算**——所以 remount 的第一帧就是真值，
// 不需要等第一次 interval 触发。
//
// 生命周期（brief 明确要求，逐条对照）：
//   · unmount → effect cleanup 清 interval。
//   · 路由切换 / 向导换步 → 那是 unmount，同上。一个活过路由切换的 setInterval 会一直跑到
//     标签页关闭，每秒 setState 一个已卸载的树。
//   · ingest 结束（active 翻 false）→ 依赖数组里有 active，cleanup 先跑，interval 立即清掉。
// 三条路共用同一个 cleanup，没有哪条漏网。
export function useIngestElapsedSeconds(active: boolean): number {
  const [, tick] = useState(0)

  // 渲染期锚定（而不是放进 effect）：mid-ingest 挂上来的 surface，**第一帧**就得显示真实
  // 总时长。若挪进 effect，会先闪一帧 0 再跳到 100——正是这个 fix 要消灭的那一幕。
  // 安全性：markIngestStart 幂等且只由 active 决定，StrictMode 的双渲染、并发模式里被丢弃
  // 的渲染，重复调用都收敛到同一个值。
  if (active) markIngestStart()

  // 松锚放在 effect 里而不是渲染期：只有**已提交**的渲染才会跑 effect。若在渲染期清，
  // 一个被丢弃的 render（并发模式）就能把正在跑的 ingest 的锚点抹掉，秒表原地归零。
  useEffect(() => {
    if (!active) clearIngestStart()
  }, [active])

  useEffect(() => {
    if (!active) return
    // interval 在这里**只是 re-render 的心跳**，不累加任何计数——真值永远从 startedAt 现算。
    // 后台标签页会节流 setInterval：累加法会越走越慢地说谎，差值法只是刷新得稀疏一点，
    // 用户切回来看到的仍是正确的秒数。
    const id = window.setInterval(() => tick((n) => (n + 1) % 1_000_000), 1000)
    return () => window.clearInterval(id)
  }, [active])

  return active ? ingestElapsedSeconds() : 0
}
