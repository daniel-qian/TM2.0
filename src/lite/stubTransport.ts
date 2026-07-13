// feat-034 阶段 B · 确定性 stub transport —— transport.ts 里早已立好的 stub 通道
// （"端点未起时 AFK 门用 stub transport 全程走通 seam"）的 tracked 实现，不是平行机制：
// 它就是一个 LiveTransport，经 store.setTransport 注入，或 URL `?transport=stub` 激活
// （resolveTransport，AFK 门 / 离线演示用；默认仍是真 HTTP transport，产品行为零变化）。
//
// 全程离线、零网络、零 LLM key；事件序列/回执内容全部写死 → 同一驱动脚本永远得到同一 DOM。
// Ask 流按后端契约提案形状回放（kickoff-dev.md）：advise SSE 里多一帧 manifest{kind:'ask-draft'}，
// saveAsk/shareAsk/fetchAsk 对应 POST /ask · POST /ask/{id}/share · GET /ask/{id}。
//
// 🔴 红线（ADR-0023 / ADR-0021 §4）：
//   · stub 人卡定性 ONLY——文本里连裸数字都不出现（AFK 门按"人卡零数字"断言）。
//   · ask 问句问"事"不问"人"；回执只挂 AskDraft.recipients[].receipt，人卡零新增字段。
//   · 多人同题只给 receipts_summary 定性一段话（真实现里该话由服务端生成并过红线门）。
// 未知 context_id / ask id 一律大声 throw（feat-028 的 404 纪律，stub 不弱化）。

import type {
  AdviseRequest,
  AskDraft,
  AskReceipt,
  LiveAgentEvent,
  LiveTeamPayload,
  LiveTransport,
} from './transport'
import { createHttpTransport } from './transport'

export const STUB_CONTEXT_ID = 'ctx_stub_demo'

// ── 确定性 Your team 语料（16 人 2 项目；含 Lin Qing / Chen Mingyuan——与官方 seed 花名册
// 复用的两个名字，让既有门相位 C 在 stub 下也能跑）。人卡文本零数字（tenure 用英文数词）。──
const STUB_PEOPLE: LiveTeamPayload['people'] = [
  { id: 'p_linqing', name: 'Lin Qing', role: 'Design Lead', team: 'Design', tenure: 'Three years in', owns: ['Pilot Launch — Hangzhou Store'], collaboration: ['Walking the store fixtures plan with the vendor side'] },
  { id: 'p_chenmingyuan', name: 'Chen Mingyuan', role: 'Engineering Manager', team: 'Engineering', tenure: 'Four years in', owns: ['Onboarding Portal Revamp'], collaboration: ['Pairing with Design on the portal handoff'] },
  { id: 'p_sunxiaomei', name: 'Sun Xiaomei', role: 'Product Designer', team: 'Design', tenure: 'Two years in' },
  { id: 'p_zhengzixuan', name: 'Zheng Zixuan', role: 'Frontend Engineer', team: 'Engineering', tenure: 'One year in' },
  { id: 'p_wangyuxuan', name: 'Wang Yuxuan', role: 'Backend Engineer', team: 'Engineering', tenure: 'Two years in' },
  { id: 'p_lijiahao', name: 'Li Jiahao', role: 'QA Engineer', team: 'Engineering', tenure: 'Three years in' },
  { id: 'p_zhoumin', name: 'Zhou Min', role: 'Operations Manager', team: 'Operations', tenure: 'Five years in' },
  { id: 'p_gaoting', name: 'Gao Ting', role: 'Supply Coordinator', team: 'Operations', tenure: 'Two years in' },
  { id: 'p_xulei', name: 'Xu Lei', role: 'Account Manager', team: 'Sales', tenure: 'Three years in' },
  { id: 'p_hanyue', name: 'Han Yue', role: 'Sales Associate', team: 'Sales', tenure: 'One year in' },
  { id: 'p_liuyang', name: 'Liu Yang', role: 'Data Analyst', team: 'Operations', tenure: 'Two years in' },
  { id: 'p_zhaolei', name: 'Zhao Lei', role: 'Mobile Engineer', team: 'Engineering', tenure: 'Three years in' },
  { id: 'p_qianduo', name: 'Qian Duo', role: 'Finance Specialist', team: 'Operations', tenure: 'Four years in' },
  { id: 'p_shenfei', name: 'Shen Fei', role: 'Visual Designer', team: 'Design', tenure: 'One year in' },
  { id: 'p_tangyi', name: 'Tang Yi', role: 'HR Generalist', team: 'Operations', tenure: 'Two years in' },
  { id: 'p_maruo', name: 'Ma Ruo', role: 'Solutions Consultant', team: 'Sales', tenure: 'Three years in' },
]

const STUB_TEAM: LiveTeamPayload = {
  context_id: STUB_CONTEXT_ID,
  source_files: [],
  people: STUB_PEOPLE,
  projects: [
    {
      id: 'pr_pilot',
      title: 'Pilot Launch — Hangzhou Store',
      ownerId: 'p_linqing',
      ownerName: 'Lin Qing',
      status: 'at-risk',
      summary: 'First offline pilot store; fixtures and vendor quotes are on the critical path.',
      blockers: ['Vendor quote for store fixtures is still unsigned.'],
    },
    {
      id: 'pr_portal',
      title: 'Onboarding Portal Revamp',
      ownerId: 'p_chenmingyuan',
      ownerName: 'Chen Mingyuan',
      status: 'on-track',
      progress: 60,
      summary: 'Rebuilding the internal onboarding portal around the new checklist flow.',
    },
  ],
  briefing: {
    tone: 'calm',
    headline: 'Your team, read from the stub corpus',
    subhead: 'A deterministic offline replay — same files in, same team out, every run.',
    metrics: [
      { label: 'People', value: '16' },
      { label: 'Projects', value: '2' },
    ],
  },
  signals: [
    {
      id: 'sig_pilot_quote',
      subjectType: 'project',
      subjectId: 'pr_pilot',
      summary: 'The fixtures vendor quote has been waiting on a signature for over a week.',
      tag: 'From your uploads',
    },
  ],
}

// ── 确定性 advise 事件流（含 ask-draft 帧）────────────────────────────────────────────
const STUB_ADVICE = {
  summary:
    'The documents say the pilot date is plausible on paper — the open fixtures quote is the one thread that could pull it. The two owners’ own read is the evidence you are missing.',
  detected_signals: [
    'The fixtures vendor quote is still unsigned while the pilot date holds.',
    'Both workstreams report steady progress in the latest uploads.',
  ],
  diagnosis_hypotheses: [
    { label: 'The plan holds if the vendor quote closes this week.', kind: 'primary' },
    { label: 'The date is already slipping and the documents lag reality.', kind: 'alternative' },
  ],
  evidence: [
    'Pilot plan lists fixtures as the last unstarted line item.',
    'The weekly notes flag the vendor quote as waiting on a signature.',
  ],
  recommended_actions: [
    'Ask the two owners directly how the date looks from where they sit.',
    'Put the vendor quote on today’s follow-up list.',
  ],
  confidence: {
    level: 'medium',
    rationale: 'The paper trail is consistent, but the freshest signal is a week old.',
    wouldChange: ['A direct word from the owners', 'The signed vendor quote'],
  },
  escalation: { level: 'none', note: '', confirmWith: [] },
  metrics_to_track: ['Vendor quote signed', 'Fixture install start date'],
  conversation_script:
    'I want the launch to land without a scramble — what does the date look like from your side, honestly?',
}

// agent 起草的 Quick ask —— 问"事"（这次上线、这个日期），不问"人"。
function stubAskDraft(id: string): AskDraft {
  return {
    id,
    status: 'draft',
    questions: [
      { id: 'q1', kind: 'scale', text: 'How confident are you that the pilot launch lands on the current date?' },
      { id: 'q2', kind: 'yesno', text: 'Do you have everything you need to hold that date?' },
    ],
    recipients: [
      { id: 'p_linqing', name: 'Lin Qing' },
      { id: 'p_chenmingyuan', name: 'Chen Mingyuan' },
    ],
    comment_prompt: 'Anything to add, in one line?',
    company_context_id: STUB_CONTEXT_ID,
    created_at: '2026-07-13T09:00:00+08:00',
  }
}

// 回执书（按受访者在 recipients 里的顺次取，确定性）。comment 是"员工原话"，
// 最值钱的那句往往就是它（PRD Q5）。
const RECEIPT_BOOK: { scale: number; yesno: boolean; comment: string; answered_at: string }[] = [
  {
    scale: 4,
    yesno: true,
    comment: 'Confident on the build itself; the vendor quote is the one piece I don’t control.',
    answered_at: '2026-07-13T10:12:00+08:00',
  },
  {
    scale: 3,
    yesno: false,
    comment: 'I can hold the date if the pricing approval lands this week.',
    answered_at: '2026-07-13T11:47:00+08:00',
  },
  {
    scale: 4,
    yesno: true,
    comment: 'Steady from my side.',
    answered_at: '2026-07-13T13:05:00+08:00',
  },
]

function receiptFor(draft: AskDraft, recipientIndex: number): AskReceipt {
  const book = RECEIPT_BOOK[recipientIndex % RECEIPT_BOOK.length]
  return {
    answers: draft.questions.map((q) => ({
      question_id: q.id,
      value: q.kind === 'scale' ? book.scale : book.yesno,
    })),
    comment: book.comment,
    answered_at: book.answered_at,
  }
}

// 多人同题的定性汇总——真实现里由服务端生成并过红线门（ADR-0023 边界 3）；
// stub 给一段同形状的定稿文本：聚合口径、零人名×数值配对、零每人一行。
function stubSummary(total: number): string {
  return (
    `All ${total} replied. Taken together: broadly confident the work itself lands, ` +
    'with the vendor pricing approval named as the one open risk. This is what they said ' +
    'about the launch, in their own words — not a reading of anyone.'
  )
}

interface StubAskState {
  draft: AskDraft
  revealed: number // fetchAsk 已揭示的回执数（每次拉取 +1，直到全齐）
}

export function createStubTransport(): LiveTransport {
  let askSeq = 0
  const asks = new Map<string, StubAskState>()
  let ingested = false
  let sourceFiles: string[] = []

  const emitAdviseScript = (
    req: AdviseRequest,
    onEvent: (event: LiveAgentEvent) => void,
    onDone: (error?: Error) => void,
  ): { abort: () => void } => {
    askSeq += 1
    const askId = `ask_stub_${askSeq}`
    const events: LiveAgentEvent[] = [
      { type: 'started', agent: 'avery', case_id: 'stub', prompt: req.situation },
      { type: 'think', text: 'Reading the situation against the uploaded corpus.' },
      { type: 'tool', name: 'recall', input: { query: 'pilot launch date fixtures vendor' } },
      {
        type: 'observe',
        observation: 'Pilot plan + weekly notes: fixtures quote unsigned; both owners report steady progress.',
      },
      { type: 'think', text: 'The documents cannot answer for the owners — their own read is the missing evidence.' },
      {
        type: 'manifest',
        kind: 'advice',
        advice: STUB_ADVICE,
        contract_ok: true,
        redline_passed: true,
      },
      // 契约提案帧：advice 之后追加一帧 ask-draft（缺省 kind 的老消费者会忽略它）。
      { type: 'manifest', kind: 'ask-draft', ask: stubAskDraft(askId) },
    ]
    // setTimeout 链（不用 rAF——headless 停摆坑）；隐藏 tab 下 Chrome 会把间隔钳到 ≥1s，
    // 事件本来就少（7 帧），门的轮询预算兜得住。
    let i = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let aborted = false
    const tick = () => {
      if (aborted) return
      if (i >= events.length) {
        onDone()
        return
      }
      onEvent(events[i])
      i += 1
      timer = setTimeout(tick, 40)
    }
    timer = setTimeout(tick, 40)
    return {
      abort: () => {
        aborted = true
        if (timer) clearTimeout(timer)
      },
    }
  }

  return {
    streamAdvise: emitAdviseScript,

    async ingest(files) {
      ingested = true
      sourceFiles = files.map((f) => f.name)
      return { ...STUB_TEAM, source_files: sourceFiles }
    },

    async fetchTeam(contextId) {
      // feat-028 纪律：未知 id 大声 404，绝不静默回落。
      if (!ingested || contextId !== STUB_CONTEXT_ID) throw new Error('team HTTP 404 (stub)')
      return { ...STUB_TEAM, source_files: sourceFiles }
    },

    async saveAsk(draft) {
      // 结构校验与真端点同形（1..3 题、题文非空）。红线文本校验是服务端的活（阶段 C）——
      // stub 不假装校验过。
      if (draft.questions.length < 1 || draft.questions.length > 3) throw new Error('ask HTTP 400 (stub: questions out of range)')
      if (draft.questions.some((q) => !q.text.trim())) throw new Error('ask HTTP 400 (stub: empty question)')
      if (draft.recipients.length < 1) throw new Error('ask HTTP 400 (stub: no recipients)')
      const stored: AskDraft = { ...draft, status: 'draft' }
      asks.set(draft.id, { draft: stored, revealed: 0 })
      return stored
    },

    async shareAsk(askId) {
      const st = asks.get(askId)
      if (!st) throw new Error('ask HTTP 404 (stub)')
      const shared: AskDraft = {
        ...st.draft,
        status: 'shared',
        expires_at: '2026-07-20T09:00:00+08:00',
        recipients: st.draft.recipients.map((r, i) => ({
          ...r,
          token: `tok_${askId}_r${i + 1}`,
          link: `https://avery.ima-read.com/r/tok_${askId}_r${i + 1}`,
        })),
      }
      asks.set(askId, { draft: shared, revealed: 0 })
      return shared
    },

    async fetchAsk(askId) {
      const st = asks.get(askId)
      if (!st) throw new Error('ask HTTP 404 (stub)')
      if (st.draft.status === 'draft') return st.draft
      // 每次拉取多"回来"一份回执，直到全齐——shared → collecting → closed 可确定性重放。
      st.revealed = Math.min(st.revealed + 1, st.draft.recipients.length)
      const recipients = st.draft.recipients.map((r, i) =>
        i < st.revealed ? { ...r, receipt: receiptFor(st.draft, i) } : { ...r, receipt: undefined },
      )
      const allIn = st.revealed >= st.draft.recipients.length
      const next: AskDraft = {
        ...st.draft,
        recipients,
        status: allIn ? 'closed' : st.revealed > 0 ? 'collecting' : 'shared',
        receipts_summary:
          allIn && st.draft.recipients.length > 1 ? stubSummary(st.draft.recipients.length) : undefined,
      }
      asks.set(askId, { draft: next, revealed: st.revealed })
      return next
    },
  }
}

// ── 激活：URL `?transport=stub` → 确定性 stub；否则真 HTTP。store 的 setTransport 注入
// 通道原样保留（门也可以运行时替换）。──────────────────────────────────────────────
export function resolveTransport(): LiveTransport {
  try {
    const qs =
      typeof window !== 'undefined' && window.location ? window.location.search : ''
    if (new URLSearchParams(qs).get('transport') === 'stub') return createStubTransport()
  } catch {
    // malformed search — fall through to the real transport
  }
  return createHttpTransport()
}
