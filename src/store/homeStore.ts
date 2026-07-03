import { create } from 'zustand'

// feat-014（ADR-0017）：主页今日 checklist 的勾选/搁置态。
//
// 为什么不进 canvasStore：① action 契约已冻结（ADR-0013 contract pass）；
// ② rail seek 会把 canvasStore 重置回 pristine 再重放——Danny 现场勾掉的卡
// 不该被一次方向键抹掉（与 dispatchTask "seek 重置，接受" 不同：checklist
// 是 home 的常驻表面，抹掉在观众眼里就是 bug）。独立小 store 让勾选态跨
// seek 存活；rail restart（r 键，回 pristine 开场）才连带 reset()。
// ADR-0003 litmus 仍成立：done/discard/undo 全是 free-click 动作，不进 SCRIPT。

export type HandoffMark = 'done' | 'discarded'

interface HomeState {
  marks: Record<string, HandoffMark>
  markDone: (id: string) => void
  discard: (id: string) => void
  restore: (id: string) => void
  reset: () => void
}

export const useHome = create<HomeState>((set) => ({
  marks: {},
  markDone: (id) => set((s) => ({ marks: { ...s.marks, [id]: 'done' } })),
  discard: (id) => set((s) => ({ marks: { ...s.marks, [id]: 'discarded' } })),
  restore: (id) =>
    set((s) => {
      const marks = { ...s.marks }
      delete marks[id]
      return { marks }
    }),
  reset: () => set({ marks: {} }),
}))
