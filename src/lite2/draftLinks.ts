import type { LiteHandoff } from './teamData'
import type { FollowupItem } from './flowStore'

// feat-036 · mailto 起草深链（PRD F3）：Avery 起草、manager 来发（ADR-0015 authorship 原则——
// 同 AskCard 的"人闸"精神，这里更朴素：直接把 mailto: 交给系统默认邮件客户端）。
// 收件人永远留空——花名册里的是"真实姓名"，不是"真实邮箱"；捏造地址比不填更危险。

function buildMailto(subject: string, body: string): string {
  // mailto 的 query 值只认 %XX 转义（RFC 6068）——不用 URLSearchParams（它对空格产出
  // `+`，一些客户端不按 mailto 规则解 `+` 为空格）。
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export function draftMailForHandoff(handoff: LiteHandoff): string {
  const subject = handoff.action
  const body = [handoff.evidence, '', `(${handoff.evidenceTag})`].join('\n')
  return buildMailto(subject, body)
}

export function draftMailForFollowup(item: FollowupItem): string {
  const subject = item.title
  const body = item.note?.trim() ? item.note.trim() : item.title
  return buildMailto(subject, body)
}
