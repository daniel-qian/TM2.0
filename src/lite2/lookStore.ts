import { create } from 'zustand'
import { lookFromUrlParam, persistLook, resolveLook, type LiteLook } from './look'

// open-loop-0720 · 观感（Look）开关的反应式落点。
//
// 为什么单开一个 store（而不是留 Lite2App.tsx 那句 `useMemo(() => resolveLook(), [])`）：
// LiteTopbar 的开关按钮和 Lite2Shell 的壳根（挂 data-look 属性的那个 div）是两个兄弟组件
// （见 Lite2App.tsx），状态得提到二者共同的祖先之上才能互通——Zustand 与 useMode/modeStore.ts
// 同一模式。
//
// 早读（模块加载时，即 import 时机）避免首帧闪错皮：create() 的初始化函数在 import 阶段就跑，
// 比组件的 useState 初始化器还早一步落定；首次 commit 时 DOM 上的 data-look 已经是最终值，
// 不会先挂一个默认值再在 effect 里改写（那样会有一帧可见的错皮闪烁）。
export interface LookState {
  look: LiteLook
  setLook: (look: LiteLook) => void
}

function initialLook(): LiteLook {
  const look = resolveLook()
  // 深链同步（kickoff 需求②）：`?look=` 显式给出时，把这次的选择落 localStorage——下次
  // 不带参数的裸链/刷新仍保持这次的选择。只在「这次确实是 URL 赢的」时才写，否则每次
  // 无参访问都会把默认值 paper 错当"用户选择"焊死进 localStorage。
  if (lookFromUrlParam() === look) persistLook(look)
  return look
}

export const useLook = create<LookState>((set) => ({
  look: initialLook(),
  setLook: (look) => {
    persistLook(look)
    set({ look })
  },
}))
