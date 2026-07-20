// feat-069 · 议事室对话流（The room 终端）的文案层——把 streamSource.ts 派生出的**结构化行**
// 拼成当前语言的句子。
//
// ⚠️ 这一层为什么必须存在（与 handoffCopy.ts 同一个理由，下一个读到的人请不要把句子"顺手"
//    挪回派生层）：
//
//   `applyEvent()` 曾经直接把英文句子推进对话流——
//
//       push('system', 'manifest', 'The read is ready')
//       push('system', 'thought',  'Something went wrong reaching the room.')
//       push('system', 'manifest', 'A quick ask is drafted — yours to confirm')
//
//   这些串是**前端自己写的**（不是后端吐的，也不是语料里的原文），所以后端怎么改都救不了
//   它们。而线上 https://averylite.dannyqian.com 是 VITE_AVERY_LOCALE=zh 的境内构建，
//   **中文才是生产默认**——中文客户在议事室里跑一次，对话流就逐条冒出英文句子。
//
//   ⇒ 修法与 feat-068 一致：派生层只产出**结构化的行**（speaker / type / code），一个英文
//     单词都不拼；拼句全部下沉到这里，按字典出文案。派生层因此重新变成 locale-free 的纯
//     函数（同一串 SSE 事件进，同一份结构化行出，与语言无关），这也是它本来就该有的样子。
//
// 🔴 与「后端原文」的分界线，是本文件唯一容易改错的地方：
//    agent 的 think 正文、tool 调用串、observe 观察串，都是**后端 / 模型产出的原文**，
//    逐字透传，本层一个字都不碰。判据就是 `code`：
//      · `code` 为空  → 这行是原文，原样渲染（绝不"顺手翻译"客户自己文件里的话）。
//      · `code` 非空  → 这行是我们自己写的话，按字典出。
//
// 与 lite/lite2 的墙：本文件在 shared/ 下，两个壳都可 import（墙禁止 lite ↔ lite2 互相
// import）。这里刻意**不** import 任何一侧的 streamSource 类型，改用结构化的最小接口——
// TS 是结构类型系统，lite 和 lite2 各自的 LiteStreamLine 都天然满足。

/**
 * 前端自己写的那几行系统提示的稳定标识。
 *
 * 🔴 这是**派生层唯一被允许产出的"文案"**——它是个 token，不是句子，永远不进 DOM。
 *    新增一条系统行时：在这里加 code → 在 StreamCopy 加键 → 在 en.lite/en.lite2 加英文
 *    → 跑 zh 生成器。少任何一步，TS 都会在编译期拦住（CODE_KEY 是 exhaustive 的 Record）。
 */
export type LiteLineCode =
  | 'nudge-redline'
  | 'nudge-chain'
  | 'ask-drafted'
  | 'advice-ready'
  | 'advice-done'
  | 'stream-failed'

/** 壳字典里本地化对话流所需的那些键（t.lite 和 t.lite2 两个 section 都满足）。 */
export interface StreamCopy {
  streamNudgeRedline: string
  streamNudgeChain: string
  streamAskDrafted: string
  streamAdviceReady: string
  streamAdviceDone: string
  streamFailed: string
  streamErrorUnknown: string
}

// code → 字典键。Record<LiteLineCode, …> 是 exhaustive 的：漏一条 code 编译期就报错。
const CODE_KEY: Record<LiteLineCode, keyof StreamCopy> = {
  'nudge-redline': 'streamNudgeRedline',
  'nudge-chain': 'streamNudgeChain',
  'ask-drafted': 'streamAskDrafted',
  'advice-ready': 'streamAdviceReady',
  'advice-done': 'streamAdviceDone',
  'stream-failed': 'streamFailed',
}

/** 派生层交给文案层的最小形状（lite/lite2 的 LiteStreamLine 都结构兼容）。 */
export interface StreamLineLike {
  // 后端/模型产出的原文。`code` 非空时恒为空串——句子由字典出，不在派生层拼。
  text: string
  code?: LiteLineCode
}

/**
 * 一条对话流行 → 当前语言的一行字。
 *
 * 未知 code 回落到 `text`（而不是抛错或显空行）：与 handoffCopy.statusWord 处理未知状态
 * 同口径——宁可让一行英文露出来，也不静默吞掉一整行证据。实践中够不到（CODE_KEY 是
 * exhaustive 的），但 run 状态会被 store 持久化，旧快照里可能带着本版不认识的 code。
 */
export function localizeStreamLine(line: StreamLineLike, copy: StreamCopy): string {
  if (!line.code) return line.text
  return copy[CODE_KEY[line.code]] ?? line.text
}

/**
 * run.error → 当前语言的一句话。
 *
 * 🔴 派生层现在对「后端没给错误详情」记的是 `null`，**不再自己编一句 'unknown error'**。
 *    详情存在就逐字透传（那是后端的原话，可能是中文，也可能带排查用的技术信息）；
 *    真没有才由本层出一句人话。判空用 trim——空白串和 null 是同一种"什么都没说"。
 */
export function localizeRunError(error: string | null, copy: StreamCopy): string {
  const detail = error?.trim()
  return detail ? detail : copy.streamErrorUnknown
}
