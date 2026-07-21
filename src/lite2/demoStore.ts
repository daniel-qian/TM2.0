import { create } from 'zustand'
import { useLite } from './store'

// input-side-0721 · 3A：示例团队能力探测（GET /demo/status，无鉴权无副作用）。
// 「示例团队」那扇门露不露面**只**由这里决定——探不到 / 后端没配 / stub 传输，一律不出门
// （4A 拍板的"不出假按钮"纪律：按钮出现即意味着点了真的能拿到团队）。
//
// 与 AuthPanel 探 /account/status 是同一个套路（vercel-supabase 教训的另一面：UI 不许只看
// 自己的构建期配置就露能力，必须先问过后端）。探测一次进程内缓存；失败按"没有"处理，
// 不重试不报错——门少一扇是安全降级，报错弹窗才是打扰。
type DemoAvailability = 'unknown' | 'probing' | 'yes' | 'no'

interface DemoState {
  availability: DemoAvailability
  probe: () => void
}

export const useDemo = create<DemoState>((set, get) => ({
  availability: 'unknown',
  probe: () => {
    if (get().availability !== 'unknown') return
    const transport = useLite.getState().transport
    const status = transport.demoStatus
    if (!status) {
      set({ availability: 'no' })
      return
    }
    set({ availability: 'probing' })
    status.call(transport).then(
      (p) => set({ availability: p.available ? 'yes' : 'no' }),
      () => set({ availability: 'no' }),
    )
  },
}))
