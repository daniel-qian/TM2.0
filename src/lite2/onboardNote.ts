import { getDict, resolveLocale } from '../shared/i18n'
import { useLite } from './store'
import { useOnboard } from './onboardStore'

// input-side-0721 · 8A：把闸门页采集的「公司现状」口述送到后端（POST /team/{id}/notes →
// company_notes）。这是「不会发到任何地方」承诺改口的**机制半边**——文案半边在 en.ts 的
// onboardTeamBody/onboardCompanyNoteHint（拍板 DoD：两边必须同棒改，这里就是同棒）。
//
// 为什么独立成模块而不塞进 store.ts / onboardStore.ts：两个 store 刻意互不 import（减冲突面
// 切分，见 onboardStore.ts 文件头）。送出这件事天然横跨两边（内容在 onboard、凭据与通道在
// lite），谁并进谁都会打破切分——第三个小模块单向读两边，是最小耦合面。
//
// 送出时机 = 「有 context 落地的那一刻」，而不是"闸门 finish 的那一刻"：用户完全可能先跳过
// 上传走完闸门（此刻无处可送），过两天从 UploadPanel 传了文件——那时也必须送，否则就是
// 静默丢数据。所以这里订阅 store 的 contextId 变化（wireCompanyNoteFlush，由闸门组件模块
// 求值时接线一次），每个新 context 送一次（幂等账本 companyNoteSentTo）。
//
// 失败姿态：红线 422（口述里带评分文本）或网络失败 → **不标记已送**、console.warn、不打扰
// 用户——下一次 context 变化会再试。这段口述不是关键路径数据，弹窗报错比丢一条注记更伤。
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
}

export async function flushCompanyNote(): Promise<void> {
  const onboard = useOnboard.getState()
  // ADR-0034 拍板 8 · 预览模式「不落库、不发请求」的兑现处之一。横幅上写着「未填写的数据
  // 不会保存，也不会用于分析」——这条送出线是唯一会把向导里的字**送到后端**的通道，所以
  // 它必须在这里认预览态。放在 flushCompanyNote 里而不是各个调用点，是因为它有两个触发源
  // （finish 时补一脚 + contextId 变化的订阅线），漏掉任何一个这句承诺就破了。
  if (onboard.preview) return
  const note = onboard.companyNote.trim()
  if (!note) return
  const { contextId, transport } = useLite.getState()
  if (!contextId || onboard.companyNoteSentTo.includes(contextId)) return
  const append = transport.appendNote
  if (!append) return
  const l = getDict(resolveLocale()).lite2
  try {
    await append.call(transport, contextId, fill(l.onboardNoteText, { note }), l.onboardNoteSource)
    useOnboard.getState().markCompanyNoteSent(contextId)
  } catch (err) {
    console.warn('[avery] onboarding company note not delivered (will retry on next workspace):', err)
  }
}

let wired = false

// 接线一次：contextId 每次**变成新值**都尝试送一次（上传成功 / 示例领取 / 切换名册都会过
// adoptContext 这个收口改 contextId）。zustand 裸 subscribe 每次 set 都会来，自己比对差值。
export function wireCompanyNoteFlush(): void {
  if (wired) return
  wired = true
  let last = useLite.getState().contextId
  useLite.subscribe((s) => {
    if (s.contextId !== last) {
      last = s.contextId
      if (s.contextId) void flushCompanyNote()
    }
  })
}
