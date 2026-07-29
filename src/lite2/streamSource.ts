// feat-017 · live 流源（The room 终端 + 8 字段卡）——ADR-0020 决策 2。
// feat-024（ADR-0022 决策 1）：立墙后本文件属 lite 壳——类型全部 lite 本地
// （与 story 终端行同形，但**不 import story**；story 的 StreamLine 留在 story/data/cases.ts）。
//
// LiveAgentSource：调 feat-015 /advise SSE，把 think/tool/observe 事件映射成终端行，
// manifest.advice 映射成 8 字段 LiteAdvice（服务端 contract.py 已投影 + 重跑红线）。

import type {
  AdviseRequest,
  AskDraft,
  AskQuestion,
  AskReceipt,
  AskRecipient,
  AskStatus,
  LiveAgentEvent,
  LiveTransport,
} from './transport'
import type { LiteLineCode } from '../shared/streamCopy'

// ── lite 终端行（与 story 终端同 CSS chrome，类型独立）───────────────────────
export type LiteSpeaker = 'agent' | 'tool' | 'system'
export type LiteLineType = 'thought' | 'tool-call' | 'tool-result' | 'manifest'

// feat-069：一行终端流**要么**是后端原文（text），**要么**是我们自己写的系统提示（code），
// 不会两者都有。派生层因此不再持有任何一句英文——句子在 shared/streamCopy.ts 按字典出。
// 渲染方一律走 localizeStreamLine(line, t.lite2)，不要直接读 .text（那样会漏掉系统行）。
export interface LiteStreamLine {
  speaker: LiteSpeaker
  type: LiteLineType
  // 后端/模型产出的原文，逐字保留。code 非空时恒为空串。
  text: string
  // 前端自己写的那几行系统提示的稳定标识（不进 DOM，交给文案层翻译）。
  code?: LiteLineCode
  key: string
}

// ── feat-059 · 简化视图的四相派生（净新增，不是照抄合伙人版）─────────────────────
// 合伙人版那 4 步是手写死的（1200ms 假延迟 + canned 文案）。这里是**同一个形状、真实质**：
// 四相的推进完全由真 SSE 事件驱动——没有对应事件的相位就停在 pending（诚实"待命"），
// 绝不为了叙事好看造节奏、造进度、造延迟。原始流一行不删，只是默认收在「展开原始流」后面。
export type LitePhaseId = 'read' | 'crosscheck' | 'method' | 'act'
export type LitePhaseStatus = 'pending' | 'active' | 'done'

export const LITE_PHASE_ORDER: LitePhaseId[] = ['read', 'crosscheck', 'method', 'act']

export interface LitePhase {
  id: LitePhaseId
  status: LitePhaseStatus
  steps: number // 归入本相的真事件条数（0 = 这一步真没发生，不亮）
}

// 一条真引用。`cite` 工具调用出生（claim + source_ref），紧随的 observe 补 resolved/snippet。
// 🟢 这是我们比合伙人版强的地方（她全库零引用），简化视图必须以人话保留、可点开看原文。
export interface LiteCitation {
  ref: string // 'facts.md:15'
  claim: string
  snippet: string | null // 后端 resolve_ref 取回的原文行；取不到就 null（不编）
  resolved: boolean | null // null = cite 的 observe 还没到
}

// ── advice 契约（feat-015 manifest.advice；对齐 service/contract.py 投影）──
// 🔴 红线：没有任何"人评分"槽位——诊断是对处境的 hypothesis，不是对人的裁决。
// 0729 输出形态战役 02（砍样板）：必填=summary/evidence/recommended_actions 三件套；
// 其余字段按需出现（absent≠none）——后端投影不再用常量补齐 confidence/escalation/
// metrics_to_track/diagnosis_hypotheses。缺席时卡对应节不渲染，绝不用默认值编造
// 「中等置信度」「暂时不用拉 HR」这类系统没真判断过的话。
export interface LiteAdvice {
  summary: string
  detected_signals: string[]
  diagnosis_hypotheses: { label: string; kind: 'primary' | 'alternative' }[]
  evidence: string[]
  recommended_actions: string[]
  confidence?: {
    level: 'low' | 'medium' | 'high'
    rationale: string
    wouldChange: string[]
  }
  escalation?: {
    level: 'none' | 'HRBP' | 'legal' | 'wellbeing' | 'compensation' | 'executive'
    note: string
    confirmWith: string[]
  }
  metrics_to_track: string[]
  conversation_script: string
}

// 一次 live 运行的快照（LiveAgentSource 逐事件累积，供终端 + 卡渲染）。
export interface LiveRunState {
  status: 'idle' | 'running' | 'complete' | 'error'
  lines: LiteStreamLine[] // 逐拍累积的终端流行
  advice: LiteAdvice | null // manifest.advice（8 字段）——ready 后填
  // feat-034：manifest{kind:'ask-draft'} 落进来的 Quick ask 草稿（出生帧）。
  // 后续编辑/分享/回执的活体状态归 store 持有——这里只是"流里出生了一张草稿"的快照。
  askDraft: AskDraft | null
  contractOk: boolean | null
  redlinePassed: boolean | null
  error: string | null
  // ── feat-059 简化视图派生（原始 lines 一条不动，这些是"另一种读法"）──
  phases: LitePhase[] // 恒 4 条、恒定顺序（LITE_PHASE_ORDER）
  citations: LiteCitation[] // 真引用（cite 工具产出）
  sourcesRead: number // 真读回来的原始材料份数（read_case 的 observe）
  recallHits: number // recall 真翻出的记忆行数
  // 派生用的内部游标——不参与渲染：把紧随 tool 的 observe 归到发起它的那一相。
  pendingTool: string | null
}

export function emptyRunState(): LiveRunState {
  return {
    status: 'idle',
    lines: [],
    advice: null,
    askDraft: null,
    contractOk: null,
    redlinePassed: null,
    error: null,
    phases: LITE_PHASE_ORDER.map((id) => ({ id, status: 'pending' as LitePhaseStatus, steps: 0 })),
    citations: [],
    sourcesRead: 0,
    recallHits: 0,
    pendingTool: null,
  }
}

// ── LiveAgentSource：持有 transport，逐事件把 SSE 转成终端行 + LiteAdvice。──
export interface LiveAgentSource {
  readonly kind: 'live'
  run: (
    req: AdviseRequest,
    onUpdate: (state: LiveRunState) => void,
  ) => { abort: () => void }
}

export function createLiveAgentSource(transport: LiveTransport): LiveAgentSource {
  return {
    kind: 'live',
    run(req, onUpdate) {
      const state = emptyRunState()
      state.status = 'running'
      let seq = 0
      // feat-059：phases/citations 也逐帧换新引用——消费方（含 React.memo 的子树）看得见增量。
      const emit = () =>
        onUpdate({
          ...state,
          lines: [...state.lines],
          phases: state.phases.map((p) => ({ ...p })),
          citations: state.citations.map((c) => ({ ...c })),
        })

      // code 非空 = 我们自己写的系统行，没有 text 也必须落行（空 text 的判空只对后端原文生效，
      // 否则每一条系统提示都会被这道守卫静默吃掉）。
      const push = (
        speaker: LiteSpeaker,
        type: LiteLineType,
        text: string,
        code?: LiteLineCode,
      ) => {
        if (!code && (!text || !text.trim())) return
        state.lines.push({ speaker, type, text, code, key: `live-${seq++}` })
      }

      emit() // 首帧：running 空态（终端立即显"running ▌"）

      const handle = transport.streamAdvise(
        req,
        (ev: LiveAgentEvent) => {
          applyEvent(state, ev, push)
          emit()
        },
        (error) => {
          if (error) {
            state.status = 'error'
            state.error = error.message
          } else if (state.status !== 'error' && state.status !== 'complete') {
            // 流正常结束但没 manifest（罕见）——收成 complete，避免卡在 running。
            state.status = 'complete'
          }
          // feat-059：流收尾后没有活着的相位（在跑的那一相封成 done；从没亮过的保持 pending）。
          sealPhases(state)
          emit()
        },
      )
      return handle
    },
  }
}

// 把单个 SSE 事件折进运行态（纯函数副作用限定在 state + push）。导出供 AFK 门直接断言映射正确。
export function applyEvent(
  state: LiveRunState,
  ev: LiveAgentEvent,
  push: (speaker: LiteSpeaker, type: LiteLineType, text: string, code?: LiteLineCode) => void,
): void {
  switch (ev.type) {
    case 'started':
      // 元数据帧——不落终端行（question 首行由 RoomScreen 从提问态派生）。
      // feat-059：也**不点亮**任何相位——"开始了"不等于"读过了"，第一条真 think/tool 才算数。
      break
    case 'think':
      // 真 agent 用泛 'agent'（display "AVERY"）——单 agent 不冒充多专家。
      push('agent', 'thought', ev.text ?? '')
      // 🔴 复核打回（feat-059 finding 2）：一条裸 think 曾经就能把「读取事实」点亮成 done，
      //    哪怕全程没有 read_case（memory.py::load_facts_head 已把 facts.md 头部预载进上下文，
      //    模型完全可以不调 read_case 直接 recall——那就是一份原始材料都没读回来）。
      //    现在「读取事实」**只由 read_case 驱动**（见 toolPhase），裸 think 不点亮它。
      // 证据已经开始收 → 这条 think 是在拿到的证据上判断怎么办（匹配方法）；
      // 还没开始收 → 归不到任何一相，谁也不点亮（原始流里一行不少，简化视图不替它编一个相位）。
      if (evidenceStarted(state)) countStep(state, 'method')
      break
    case 'tool':
      push('agent', 'tool-call', formatToolCall(ev.name, ev.input))
      state.pendingTool = ev.name ?? null
      if (ev.name === 'cite') recordCite(state, ev.input)
      countStep(state, toolPhase(ev.name))
      break
    case 'observe':
      push('tool', 'tool-result', ev.observation ?? '')
      absorbObservation(state, ev.observation ?? '', ev.is_error === true)
      countStep(state, toolPhase(state.pendingTool ?? undefined))
      state.pendingTool = null
      break
    case 'nudge':
      // gate 把模型推回——system 行提示（人话，不暴露 rule id）。
      push('system', 'thought', '', nudgeCode(ev.gate))
      // 被闸推回去重新找依据，本身就是"在挑做法"的真信号。
      countStep(state, 'method')
      break
    case 'manifest': {
      // feat-034 契约提案：可选判别字段 kind（缺省 = advice，现有路径零破坏）。
      if (ev.kind === 'ask-draft') {
        const draft = coerceAskDraft(ev.ask)
        if (draft) {
          state.askDraft = draft
          push('system', 'manifest', '', 'ask-drafted')
          countStep(state, 'act') // 起草出一张 ask 也是"生成动作"
        }
        // ask-draft 帧不判 run 完成——advice 帧（或流自然收尾）才收 status。
        break
      }
      const advice = coerceAdvice(ev.advice)
      state.advice = advice
      state.contractOk = ev.contract_ok ?? null
      state.redlinePassed = ev.redline_passed ?? null
      push('system', 'manifest', '', advice ? 'advice-ready' : 'advice-done')
      state.status = 'complete'
      countStep(state, 'act')
      sealPhases(state)
      break
    }
    case 'error':
      state.status = 'error'
      // feat-069：后端没给详情就记 null——**不再自己编一句 'unknown error'**。
      // 详情存在则逐字透传（那是后端的原话，中文构建下它本来就可能是中文）；
      // 真没有时由 localizeRunError() 在文案层出一句人话。
      state.error = ev.error ?? null
      push('system', 'thought', '', 'stream-failed')
      // 出错时**不**把在跑的相位改成 done——它确实没跑完，留 active 由 UI 配合 run.status 显错。
      break
    default:
      break
  }
}

// ── feat-059 · 四相派生的纯逻辑（导出供门直接断言映射正确）──────────────────────

export function phaseIndex(id: LitePhaseId): number {
  return LITE_PHASE_ORDER.indexOf(id)
}

// 工具 → 相位。read_case=读事实；recall/cite=交叉验证；draft_advice=生成动作。
// 未知工具归"匹配方法"——今天后端只有这 4 个（eval-harness/avery/tools.py::TOOL_SCHEMAS），
// 日后新增的检索/方法类工具落在这里比落在别处更贴近事实。
function toolPhase(name: string | undefined): LitePhaseId {
  switch (name) {
    case 'read_case':
      return 'read'
    case 'recall':
    case 'cite':
      return 'crosscheck'
    case 'draft_advice':
      return 'act'
    default:
      return 'method'
  }
}

// 「收证据」是否已经真的开始（决定一条 think 算不算「匹配方法」的一步）。
// 看的是真事件计数，不是时间——没有 recall/cite 发生过，这条 think 就还归不到任何一相。
function evidenceStarted(state: LiveRunState): boolean {
  return state.phases[phaseIndex('crosscheck')].steps > 0
}

// 计步永远记在**事件自己那一相**上——哪怕叙事已经走到后面。
// （早期版本按"当前游标"记，结果 recall→think→cite 的真实序列里 cite 被记进了「匹配方法」，
//   计数与事实不符。相位状态要单调，但计数必须忠实。）
function countStep(state: LiveRunState, id: LitePhaseId): void {
  const phase = state.phases[phaseIndex(id)]
  if (phase) phase.steps += 1
  refreshPhases(state)
}

// 相位状态**纯由 steps 派生**，不留可被随手调的进度变量：
//   steps === 0            → pending（这一步真没发生，诚实灰着，绝不补成 done）
//   不是最靠后的有事件相位 → done
//   最靠后的有事件相位     → 只有 run 真的 complete 才 done，否则 active（含 error：它确实没跑完）
export function refreshPhases(state: LiveRunState): void {
  let last = -1
  for (let i = 0; i < state.phases.length; i++) {
    if (state.phases[i].steps > 0) last = i
  }
  for (let i = 0; i < state.phases.length; i++) {
    const p = state.phases[i]
    if (p.steps === 0) {
      p.status = 'pending'
      continue
    }
    p.status = i < last ? 'done' : state.status === 'complete' ? 'done' : 'active'
  }
}

// 流收尾（onDone）——状态已落定，重算一次即可把在跑的那一相封掉。
export function sealPhases(state: LiveRunState): void {
  refreshPhases(state)
}

// cite 工具调用 → 一条待确认的引用（claim + ref 都来自模型真调用的入参）。
function recordCite(state: LiveRunState, input: Record<string, unknown> | undefined): void {
  const ref = typeof input?.source_ref === 'string' ? input.source_ref.trim() : ''
  const claim = typeof input?.claim === 'string' ? input.claim.trim() : ''
  if (!ref) return // 没有 ref 就不是引用——不造一条空证据充数
  state.citations.push({ ref, claim, snippet: null, resolved: null })
}

// observe → 把真数字/真原文吸进派生态。只认后端已文档化的观察串形状，认不出就不填（不猜）。
//   read_case  → 整份原始材料转储（简化视图只留"读了 N 份"，全文留在原始流）
//   recall     → 每行 `facts.md:15  <text>`（memory.py::Hit.as_line）
//   cite       → `✓ cited: «claim» ⟵ facts.md:15  (snippet)` 或 `⚠ recorded, but …`
function absorbObservation(state: LiveRunState, observation: string, isError: boolean): void {
  const tool = state.pendingTool
  if (tool === 'read_case') {
    if (!isError && observation.trim()) state.sourcesRead += 1
    return
  }
  if (tool === 'recall') {
    if (isError) return
    for (const line of observation.split('\n')) {
      if (MEMORY_HIT.test(line.trim())) state.recallHits += 1
    }
    return
  }
  if (tool === 'cite') {
    const cite = state.citations[state.citations.length - 1]
    if (!cite || cite.resolved !== null) return
    if (isError || observation.startsWith('⚠')) {
      cite.resolved = false
      return
    }
    cite.resolved = observation.startsWith('✓')
    if (cite.resolved) cite.snippet = extractCiteSnippet(observation)
  }
}

// `facts.md:15  正文…` —— memory.py::Hit.as_line 的形状（source 是 <file>:<line>）。
const MEMORY_HIT = /^[\w.\-/]+:\d+\s/

// 从 `✓ cited: «claim» ⟵ facts.md:15  (原文)` 里取回原文（tools.py::_cite 的确切形状）。
// 🔴 复核打回（feat-059 finding 1）：早期版本用 lastIndexOf('(')/lastIndexOf(')') 全串扫，
//    源文件行自己带半角括号时会从括号处截断——`(Phase 1 (Sanya) launch moved to Q3)` 被切成
//    `Sanya) launch moved to Q3`，把残句当逐字原文显示给经理。半角括号在业务文档里极常见
//    （`Q3 (revised)`、`Anna Lindqvist (PM)`），英文语境必踩。
// 解法：锚在 `» ⟵ <ref>  (` 之后（ref 无空格；claim 由 «» 定界），贪婪吃到结尾最后一个 ')'，
//    这样嵌套/多个括号都原样保留。形状对不上就 null——宁可不显，不显残缺的"原文"。
const CITE_SNIPPET = /»\s+⟵\s+\S+\s+\(([\s\S]*)\)\s*$/

function extractCiteSnippet(observation: string): string | null {
  const match = CITE_SNIPPET.exec(observation)
  if (!match) return null
  const snippet = match[1].trim()
  return snippet ? snippet : null
}

function formatToolCall(name: string | undefined, input: Record<string, unknown> | undefined): string {
  if (!name) return 'tool call'
  const arg =
    input && typeof input === 'object'
      ? Object.entries(input)
          .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(' ')
      : ''
  return arg ? `${name} ${arg}` : name
}

// gate → 系统行 code。**只产出 token，不产出句子**——文案在 shared/streamCopy.ts 按字典出。
// 两条 code 都刻意只描述"在重新找依据"这件事，不暴露 rule id，也不提任何一个人。
function nudgeCode(gate: 'chain' | 'redline' | undefined): LiteLineCode {
  return gate === 'redline' ? 'nudge-redline' : 'nudge-chain'
}

// manifest.advice 可能来自真后端——做防御性形状归一，缺字段补空（终端仍渲染，卡按有的字段显）。
export function coerceAdvice(raw: unknown): LiteAdvice | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  const out: LiteAdvice = {
    summary: typeof r.summary === 'string' ? r.summary : '',
    detected_signals: strArr(r.detected_signals),
    diagnosis_hypotheses: Array.isArray(r.diagnosis_hypotheses)
      ? (r.diagnosis_hypotheses as unknown[])
          .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
          .map((h) => ({
            label: typeof h.label === 'string' ? h.label : '',
            kind: h.kind === 'primary' ? ('primary' as const) : ('alternative' as const),
          }))
      : [],
    evidence: strArr(r.evidence),
    recommended_actions: strArr(r.recommended_actions),
    metrics_to_track: strArr(r.metrics_to_track),
    conversation_script: typeof r.conversation_script === 'string' ? r.conversation_script : '',
  }
  // 0729/02 absent≠none：calibration 字段只有后端真发了键才进快照——缺席绝不用默认值
  // 编造（旧行为会把缺席补成 medium/none，等于替系统撒谎说它做过这个判断）。
  if (r.confidence && typeof r.confidence === 'object') {
    const confidence = r.confidence as Record<string, unknown>
    const level = confidence.level
    out.confidence = {
      level: level === 'low' || level === 'medium' || level === 'high' ? level : 'medium',
      rationale: typeof confidence.rationale === 'string' ? confidence.rationale : '',
      wouldChange: strArr(confidence.wouldChange),
    }
  }
  if (r.escalation && typeof r.escalation === 'object') {
    const escalation = r.escalation as Record<string, unknown>
    const escLevel = escalation.level
    out.escalation = {
      level:
        escLevel === 'none' ||
        escLevel === 'HRBP' ||
        escLevel === 'legal' ||
        escLevel === 'wellbeing' ||
        escLevel === 'compensation' ||
        escLevel === 'executive'
          ? escLevel
          : 'none',
      note: typeof escalation.note === 'string' ? escalation.note : '',
      confirmWith: strArr(escalation.confirmWith),
    }
  }
  return out
}

// manifest{kind:'ask-draft'}.ask 的防御性形状归一（与 coerceAdvice 同规格）。
// 契约硬边界（PRD Q5 / ADR-0023 / 阶段 C F1+F3 收紧——feat-047 打回复验补齐，
// 与 src/lite/streamSource.ts 现行实现对齐；拷贝不引用，墙纪律不变）：
//   · 题数 >3、未知题型、值域外回执（99 "out of 5"、yesno 收到数字）→ 返回 null，
//     **宁可不出卡**，绝不出一张半坏/静默改形的卡（F3：不再截断、不再折 scale）。
//   · status 词表 = 服务端六词（draft|shared|collecting|closed|revoked|expired）；
//     未知词一律折 **closed**——绝不折 draft，否则已发出/已撤回的 ask 会以可编辑草稿复活（F1）。
//   · 回执只存在于 recipients[].receipt——没有任何可挂到"人"身上的槽位（结构性红线）。
export function coerceAskDraft(raw: unknown): AskDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null

  if (!Array.isArray(r.questions)) return null
  const rawQuestions = (r.questions as unknown[]).filter(
    (q): q is Record<string, unknown> => !!q && typeof q === 'object',
  )
  if (rawQuestions.length !== (r.questions as unknown[]).length) return null // 非对象题项 = 坏形状
  if (rawQuestions.length > 3) return null // F3：超题数不出卡（不再静默截断）
  const questions: AskQuestion[] = []
  for (let i = 0; i < rawQuestions.length; i++) {
    const q = rawQuestions[i]
    if (q.kind !== 'scale' && q.kind !== 'yesno') return null // F3：未知题型不出卡（不再折 scale）
    const text = typeof q.text === 'string' ? q.text : ''
    if (!text.trim()) continue // 空题文照旧丢弃（阶段 B 行为，不算毒形状）
    questions.push({
      id: typeof q.id === 'string' && q.id ? q.id : `q${i + 1}`,
      kind: q.kind,
      text,
    })
  }
  if (questions.length < 1) return null
  const kindById = new Map(questions.map((q) => [q.id, q.kind]))

  const recipients: AskRecipient[] = []
  const rawRecipients = Array.isArray(r.recipients)
    ? (r.recipients as unknown[]).filter(
        (x): x is Record<string, unknown> => !!x && typeof x === 'object',
      )
    : []
  for (let i = 0; i < rawRecipients.length; i++) {
    const x = rawRecipients[i]
    const name = typeof x.name === 'string' ? x.name : ''
    if (!name.trim()) continue
    const receipt = coerceAskReceipt(x.receipt, kindById)
    if (receipt === 'poisoned') return null // F3：值域外/错型回执 = 整卡不出
    recipients.push({
      id: typeof x.id === 'string' && x.id ? x.id : `r${i + 1}`,
      name,
      token: typeof x.token === 'string' ? x.token : undefined,
      link: typeof x.link === 'string' ? x.link : undefined,
      receipt,
    })
  }

  // F1：已知六词原样保留；未知词折 closed（fail-safe 方向 = 不可编辑、不可再分享）。
  const status: AskStatus =
    r.status === 'draft' ||
    r.status === 'shared' ||
    r.status === 'collecting' ||
    r.status === 'closed' ||
    r.status === 'revoked' ||
    r.status === 'expired'
      ? r.status
      : 'closed'

  return {
    id: r.id,
    status,
    questions,
    recipients,
    comment_prompt: typeof r.comment_prompt === 'string' ? r.comment_prompt : undefined,
    company_context_id:
      typeof r.company_context_id === 'string' ? r.company_context_id : undefined,
    created_at: typeof r.created_at === 'string' ? r.created_at : undefined,
    expires_at: typeof r.expires_at === 'string' ? r.expires_at : undefined,
    receipts_summary: typeof r.receipts_summary === 'string' ? r.receipts_summary : undefined,
  }
}

// feat-047 对抗验证 · 门缝：把防御性 coerce 暴露给 live-frontend-gate 的 F 组
// askStatusCoerce 相位直接断言（门是唯一消费者；产品代码不读它）。照 src/lite/streamSource.ts
// 的 __liteAsk 先例，独立命名 __lite2Ask 避免与 v01 撞名——v01 的 askVerdict 相位打 __liteAsk，
// 两个壳各自的 coerce 各自被门覆盖（此前 lite2 侧的 coerce 从未被任何门行使过，正是这次
// blocker 潜伏至今的原因）。
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__lite2Ask = { coerceAskDraft }
}

// 回执归一：undefined = 没有回执；'poisoned' = 回执存在但值域/类型对不上它的题——
// F3 收紧后由调用方把整卡打回 null（渲染 "99 out of 5" 是对证据的歪曲，宁可不渲染）。
function coerceAskReceipt(
  raw: unknown,
  kindById: Map<string, AskQuestion['kind']>,
): AskReceipt | undefined | 'poisoned' {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.answers)) return undefined
  const answers: { question_id: string; value: number | boolean }[] = []
  for (const a of r.answers as unknown[]) {
    if (!a || typeof a !== 'object') return 'poisoned'
    const rec = a as Record<string, unknown>
    const qid = typeof rec.question_id === 'string' ? rec.question_id : ''
    const kind = kindById.get(qid)
    if (!kind) return 'poisoned' // 回执答了一道不存在的题
    const v = rec.value
    if (kind === 'scale') {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) return 'poisoned'
    } else {
      if (typeof v !== 'boolean') return 'poisoned'
    }
    answers.push({ question_id: qid, value: v })
  }
  if (answers.length === 0) return undefined
  return {
    answers,
    comment: typeof r.comment === 'string' && r.comment.trim() ? r.comment : undefined,
    answered_at: typeof r.answered_at === 'string' ? r.answered_at : '',
  }
}
