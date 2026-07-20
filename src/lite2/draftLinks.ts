import type { HandoffDisplay } from '../shared/handoffCopy'
import type { LiteTeam } from './teamData'
import type { FollowupItem, FollowupSource } from './flowStore'

// feat-036 · mailto 起草深链（PRD F3）：Avery 起草、manager 来发（ADR-0015 authorship 原则——
// 同 AskCard 的"人闸"精神）。
//
// feat-058（PRD G6）· 应用内草稿框：入口不再是裸 `mailto:` 链接（点一下就被甩进系统邮件
// 客户端，manager 连正文都没看见）。这里的职责因此从"造一条链接"变成"造一份草稿"：
//   · `LiteDraft` = 收件人 + 主题 + 正文，交给 DraftComposer 弹层承载（可编辑）
//   · mailto 降为**次出口**，且由**编辑后的**主题/正文实时重算（`mailtoForDraft`）
//   · 主出口是复制到聊天应用（`clipboardTextForDraft`）——国内团队在微信/飞书
//
// 🔴 收件人永远是**人名**，不是邮箱：花名册里存的是真实姓名，我们从来没有他们的邮箱。
// mailto 的 To 段因此恒为空（捏造地址比不填更危险），弹层里要把这件事明说，别让 manager
// 以为点了邮件就自动填好收件人了。

/**
 * 「完成」这个出口对**这一份**草稿到底意味着什么。写成显式三态而不是靠「有没有 followupId」
 * 去猜：分诊来的草稿和"来源那条已经办完了"的草稿都没有 followupId，靠猜会把后者错渲成
 * 「加进跟进」，于是队列里长出一条重复。
 */
export type DraftCompletion =
  /** 队列里还没有这件事 → 新建一条（分诊卡的草稿走这条）。 */
  | { mode: 'add' }
  /** 草稿就出自队列里的某条 → 把**那条**标已办（再 addFollowup 会长出重复条目）。 */
  | { mode: 'complete'; followupId: string }
  /** 来源那条早就办完了 → 没有完成出口，弹层不渲染这个按钮。 */
  | { mode: 'none' }

export interface LiteDraft {
  /** 稳定 id（= 来源条目 id 派生），既做 React key 也做门断言钩子 data-draft-id。 */
  id: string
  subject: string
  body: string
  /** 人名，**不是邮箱**。可能为空（来源条目没指向具体的人）。 */
  recipients: string[]
  /** 「完成」新建跟进条目时写进去的来源标签。 */
  source: FollowupSource
  completion: DraftCompletion
}

function buildMailto(subject: string, body: string): string {
  // mailto 的 query 值只认 %XX 转义（RFC 6068）——不用 URLSearchParams（它对空格产出
  // `+`，一些客户端不按 mailto 规则解 `+` 为空格）。
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** 次出口：mailto。用**当前（可能已被 manager 改过）**的主题/正文重算，不是开框那一刻的快照。 */
export function mailtoForDraft(draft: Pick<LiteDraft, 'subject' | 'body'>): string {
  return buildMailto(draft.subject, draft.body)
}

/** 主出口：贴进微信/飞书的纯文本。标题一行 + 空行 + 正文，粘过去就是一条能读的消息。 */
export function clipboardTextForDraft(draft: Pick<LiteDraft, 'subject' | 'body'>): string {
  const subject = draft.subject.trim()
  const body = draft.body.trim()
  if (!subject) return body
  if (!body) return subject
  return `${subject}\n\n${body}`
}

/**
 * 分诊条目 → 草稿。正文 = 该条目的**真证据**（teamData.liveHandoffs() 的真派生），不套任何
 * "你好 X，最近……"的问候模板：那种模板会让一段静态样板文字看起来像 Avery 替你写的私人信。
 * manager 想加寒暄，弹层里正文可编辑。
 *
 * 🔴 正文里**不带** `handoff.evidenceTag`（"From your uploads"），两个独立理由：
 *   ① 它是 teamData.ts 里写死的**英文**字面量、从未进 i18n 表——`lang=zh` 下把它拼进正文，
 *      manager 复制到微信发出去的就是一句中文消息尾巴上挂着英文。
 *   ② 就算翻成中文也不该在这儿：出处是给 manager 看的来源标注，不是要发给同事的消息内容；
 *      收件人收到「（来自你的上传）」只会莫名其妙。弹层已有 draftBodyHint 常驻说明来源。
 */
// feat-068 · 入参改吃**已本地化**的分诊条目（HandoffDisplay），不再是派生层的 LiteHandoff。
// 派生层的 action/evidenceTag 是写死的英文（"Take a look at X"），直接进草稿主题的话，
// 中文 manager 点「起草消息」复制到微信发出去，就是一句英文标题挂着中文正文。
// HandoffDisplay 结构上就是 HandoffLike + 本地化后的 toneLabel/action/evidenceTag，
// personIds / evidence 这些派生字段原样带着，所以这里只是把 subject 换成了本地化那份。
export function draftFromHandoff(handoff: HandoffDisplay, team: LiteTeam | null): LiteDraft {
  const names = handoff.personIds
    .map((id) => team?.people.find((p) => p.id === id)?.name)
    .filter((name): name is string => Boolean(name))
  return {
    id: `draft_${handoff.id}`,
    subject: handoff.action,
    body: handoff.evidence,
    recipients: names,
    source: 'triage',
    completion: { mode: 'add' },
  }
}

/** 跟进条目 → 草稿。队列条目上没有人的指向，收件人只能留空——弹层显诚实空态，不猜。 */
export function draftFromFollowup(item: FollowupItem): LiteDraft {
  return {
    id: `draft_${item.id}`,
    subject: item.title,
    body: item.note?.trim() ? item.note.trim() : item.title,
    recipients: [],
    source: item.source,
    completion: item.done ? { mode: 'none' } : { mode: 'complete', followupId: item.id },
  }
}
