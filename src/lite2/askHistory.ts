import type { AdviseHistoryTurn } from './transport'
import type { LiveRunState } from './streamSource'

// #71 · 议事室会话流的「带上下文追问」——把前几轮压成后端能吃的轻量 history。
//
// 为什么单独一个文件：配额常数必须集中放一处（票面硬要求）。它有一份**权威孪生**在后端
// `eval-harness/service/history.py`（同名常数、同款截断），改一处必须改两处——真正的闸在
// 后端（前端是可以被绕过的输入），这里的截断只是「别把几 KB 的判读卡整个发出去」。
//
// 🔴 turns 刻意不持久化（票面拍板）：这里也不许出现任何 localStorage / sessionStorage。
// 离开议事室 / 刷新即这场对话结束，history 随 turns 一起消失。

/** 最多带几轮（超出丢**最早**的，留最近的——追问最需要的是刚刚那几句）。 */
export const HISTORY_MAX_TURNS = 6
/** 单轮问题的字数上限。 */
export const HISTORY_MAX_QUESTION_CHARS = 400
/** 单轮回答摘要的字数上限。 */
export const HISTORY_MAX_ANSWER_CHARS = 800

// 截断标记走英文：它进的是 prompt 脚手架（与 engine 里的 nudge / reference block 同一层，
// 那一层全英文），不是给 manager 看的界面文案，所以不进 i18n。
const TRUNCATION_MARK = '…[truncated]'

function clamp(text: string, max: number): string {
  const s = (text ?? '').trim()
  if (s.length <= max) return s
  return s.slice(0, max) + TRUNCATION_MARK
}

/**
 * 一轮的终局产物摘要：判读卡取 summary、短答取整段 answer。两者都没有（跑挂了 / 被红线
 * 门丢了 / 还在跑）就返回 null——**没答出东西的那一轮不进 history**，宁可少带一轮，也不
 * 给模型一句「上一轮：（空）」去圆场。
 */
export function historyAnswerOf(run: LiveRunState): string | null {
  const text = run.advice?.summary ?? run.answer ?? ''
  const trimmed = text.trim()
  return trimmed ? trimmed : null
}

/**
 * 把已落定的前几轮压成 history。空数组返回 `undefined`——契约是 additive optional：
 * 第一问的请求体里**根本没有 history 这个键**（absent≠[]，同 #64 references 的纪律）。
 */
export function buildAdviseHistory(
  turns: Array<{ question: string; run: LiveRunState }>,
): AdviseHistoryTurn[] | undefined {
  const usable: AdviseHistoryTurn[] = []
  for (const turn of turns) {
    const question = (turn.question ?? '').trim()
    if (!question) continue
    const answer = historyAnswerOf(turn.run)
    if (!answer) continue
    usable.push({
      question: clamp(question, HISTORY_MAX_QUESTION_CHARS),
      answer: clamp(answer, HISTORY_MAX_ANSWER_CHARS),
    })
  }
  if (usable.length === 0) return undefined
  return usable.slice(-HISTORY_MAX_TURNS)
}
