import { create } from 'zustand'
import type { LiteDraft } from './draftLinks'

// feat-058（PRD G6）· 应用内草稿框的开合与编辑态。
//
// 为什么单独一个 store 而不是塞进 flowStore：
//   ① 草稿是**纯瞬态**的——不进 localStorage。flowStore 的每个字段都在 persist() 的写盘
//      清单里，把草稿混进去等于让一份半截未发的消息跨会话复活（刷新后弹层自己冒出来）。
//   ② 开框的入口（分诊卡在「你的团队」、队列条目在「跟进」）与承载弹层的位置（壳层
//      Lite2App，与 DetailOverlay 同级）跨三棵子树，必须有个共享处；本波多条线都在动
//      flowStore，另起一个文件同时把合并冲突面降到零。
//
// 「完成」真写库那一步不在这儿——它调 flowStore 的 addFollowup / completeFollowup（跟进队列
// 只有一份真相源，见 flowStore 顶注：不许长出第二份平行内存列表）。

interface DraftState {
  /** null = 没开框。弹层的 open 就读它（LiteModal 常驻挂载 + open 属性）。 */
  draft: LiteDraft | null
  openDraft: (draft: LiteDraft) => void
  closeDraft: () => void
  /** 主题/正文可编辑（🟢 超过参考库的只读预览：正文不可编辑等于不可用）。 */
  setSubject: (subject: string) => void
  setBody: (body: string) => void
}

export const useDraft = create<DraftState>((set) => ({
  draft: null,
  openDraft: (draft) => set({ draft }),
  closeDraft: () => set({ draft: null }),
  setSubject: (subject) => set((s) => (s.draft ? { draft: { ...s.draft, subject } } : s)),
  setBody: (body) => set((s) => (s.draft ? { draft: { ...s.draft, body } } : s)),
}))
