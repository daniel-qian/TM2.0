import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useLite, type LiveTurn } from '../store'
import { useFlow } from '../flowStore'
import { useDict } from '../../shared/i18n/useDict'
import type { Dict } from '../../shared/i18n'
import { LiteAdviceCard } from '../LiteAdviceCard'
import { AskCard } from '../AskCard'
import { AskRefComposer } from '../AskRefComposer'
import { toWireRefs, weaveRefs, type AskRef } from '../askRefs'
import { localizeStreamLine } from '../../shared/streamCopy'
import { coerceAdvice } from '../streamSource'
import type {
  LiteStreamLine,
  LiteSpeaker,
  LiveRunState,
  LitePhase,
  LitePhaseId,
} from '../streamSource'

// feat-024 · lite 屏 3：The room 薄建——ADR-0022 决策 1。
// live SSE 控制台（终端 chrome 与 story 同 CSS，代码独立）+ 8 字段卡。
// 不搬 1400 行剧场 NexusScene：无 rail、无 case 编排、无 world 坐标。
// feat-025 Q3(a)：加一层薄可拖拽/缩放画布（LitePanZoom，lite 自有 wrapper，不碰 story
// PanZoomCanvas）容纳终端 + 8 字段卡；composer 留在画布外恒定可点（门相位 F2 驱动它）。

// avery-sync zh-purity (open-loop-0720, group b): 'TOOL' used to be a hardcoded literal here —
// pure display chrome (no code matches on the label text; `is-tool`/`is-manifest` classNames are
// separate and untouched), so it's cheap and safe to source from the dict instead. Kept as a
// function of `t` (not a module-level const) since it now depends on locale. v01 twin
// (src/lite/screens/RoomScreen.tsx) has the same shape.
function speakerMeta(t: { roomToolLabel: string }): Record<LiteSpeaker, { label: string; className: string }> {
  return {
    agent: { label: 'AVERY', className: 'is-agent' },
    tool: { label: t.roomToolLabel, className: 'is-tool' },
    system: { label: '·', className: 'is-system' },
  }
}

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

// 原始流：一行不删、一行不改——展开后工程师/Danny 看到的就是今天这个终端本身。
// 等待/滚动全走 DOM，不依赖动画帧（headless rAF 坑）。
function RawStreamLog({ lines, running }: { lines: LiteStreamLine[]; running: boolean }) {
  const logRef = useRef<HTMLDivElement | null>(null)
  const { t } = useDict()
  const meta = speakerMeta(t.lite2)
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [lines.length])

  return (
    <div className="nexus-terminal-log" ref={logRef} data-raw-stream="">
      {lines.map((line) => {
        const lineMeta = meta[line.speaker]
        const prefix = line.type === 'manifest' ? t.lite2.roomManifestLabel : lineMeta.label
        const prefixClass = line.type === 'manifest' ? 'is-manifest' : lineMeta.className
        return (
          <p key={line.key} className={classNames(['terminal-line', `is-${line.type}`, 'is-new'])}>
            <span className={classNames(['terminal-prefix', prefixClass])}>{prefix}</span>
            {/* feat-069：**不要**改回 {line.text}——系统行的 text 是空的，句子在字典里
                （见 src/shared/streamCopy.ts）。后端原文行 code 为空，照旧逐字透传。 */}
            <span className="terminal-text">{localizeStreamLine(line, t.lite2)}</span>
          </p>
        )
      })}
      {running ? (
        <p className="terminal-line terminal-cursor-line" aria-hidden="true">
          <span className="terminal-prefix is-system">·</span>
          <span className="terminal-text">
            running <span className="terminal-cursor">▌</span>
          </span>
        </p>
      ) : null}
    </div>
  )
}

const PHASE_LABEL: Record<LitePhaseId, (l: Dict['lite2']) => string> = {
  read: (l) => l.roomPhaseRead,
  crosscheck: (l) => l.roomPhaseCrosscheck,
  method: (l) => l.roomPhaseMethod,
  act: (l) => l.roomPhaseAct,
}

// 每一相的副文案 **只由真计数派生**：读回来几份材料、翻出几条记录、走了几步。
// 相位没亮（steps=0）就说"待命"——绝不写"正在分析…"这类看着热闹的空话。
function phaseMeta(phase: LitePhase, run: LiveRunState, l: Dict['lite2']): string {
  if (phase.status === 'pending') return l.roomPhasePending
  switch (phase.id) {
    case 'read':
      return run.sourcesRead > 0
        ? fill(l.roomFlowSources, { count: run.sourcesRead })
        : fill(l.roomFlowSteps, { count: phase.steps })
    case 'crosscheck':
      return run.recallHits > 0
        ? fill(l.roomFlowRecall, { count: run.recallHits })
        : fill(l.roomFlowSteps, { count: phase.steps })
    case 'act':
      return run.advice ? l.roomFlowReady : fill(l.roomFlowSteps, { count: phase.steps })
    default:
      return fill(l.roomFlowSteps, { count: phase.steps })
  }
}

// feat-059 · 议事室简化输出。默认四相叙事（真事件驱动），「展开原始流」看全量。
// 🔴 四相不是脚本：没有对应事件的相位停在 pending。零假延迟、零假进度、零 canned 文案。
function LiteThinkingFlow({ run, running }: { run: LiveRunState; running: boolean }) {
  const [showRaw, setShowRaw] = useState(false)
  const [showCites, setShowCites] = useState(false)
  const { t } = useDict()
  const l = t.lite2
  const cites = run.citations

  return (
    <section
      className={classNames(['nexus-terminal', 'lite-flow', showRaw ? 'is-raw' : 'is-simplified'])}
      aria-label={l.roomFlowTitle}
    >
      <header className="nexus-terminal-bar lite-flow-bar">
        <span className="nexus-terminal-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="nexus-terminal-title">
          {showRaw ? l.roomFlowRawTitle : l.roomFlowTitle}
        </span>
        <button
          type="button"
          className="lite-flow-toggle"
          data-flow-toggle=""
          aria-expanded={showRaw}
          onClick={() => setShowRaw((v) => !v)}
        >
          {showRaw ? l.roomFlowHideRaw : l.roomFlowShowRaw}
        </button>
      </header>

      {showRaw ? (
        <RawStreamLog lines={run.lines} running={running} />
      ) : (
        <div className="lite-flow-body">
          <ol className="lite-flow-phases">
            {run.phases.map((phase, i) => (
              <li
                key={phase.id}
                className={classNames(['lite-flow-phase', `is-${phase.status}`])}
                data-phase-id={phase.id}
                data-phase-status={phase.status}
              >
                <span className="lite-flow-dot" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="lite-flow-phase-text">
                  <p className="lite-flow-phase-label">
                    {PHASE_LABEL[phase.id](l)}
                    {phase.status === 'active' && running ? (
                      <span className="terminal-cursor" aria-hidden="true">
                        ▌
                      </span>
                    ) : null}
                  </p>
                  <p className="lite-flow-phase-meta">{phaseMeta(phase, run, l)}</p>
                  {/* 🟢 真引用以人话保留在简化视图里——她那版全库零引用，这是我们的实质。 */}
                  {phase.id === 'crosscheck' && cites.length > 0 ? (
                    <button
                      type="button"
                      className="lite-flow-cites-toggle"
                      data-cites-toggle=""
                      aria-expanded={showCites}
                      onClick={() => setShowCites((v) => !v)}
                    >
                      {fill(l.roomFlowCites, { count: cites.length })}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>

          {/* 🔴 复核打回（feat-059 finding 4）：SSE 中途断掉时，简化视图曾经只把某一相永久停在
              active——看不出是失败还是还在跑（error 行只进原始流，而原始流默认是收起来的）。
              这里在面板内直接说"断了"，并指向原始流看断点。绝不做假的"成功"态。 */}
          {run.status === 'error' ? (
            <p className="lite-flow-failed" data-flow-failed="" role="status">
              {l.roomFlowFailed}
            </p>
          ) : null}

          {showCites && cites.length > 0 ? (
            <ul className="lite-flow-cite-list" aria-label={l.roomFlowCitesLabel}>
              {cites.map((cite, i) => (
                <li key={`${cite.ref}-${i}`} className="lite-flow-cite">
                  <span className="lite-flow-cite-ref">{cite.ref}</span>
                  {cite.claim ? <span className="lite-flow-cite-claim">{cite.claim}</span> : null}
                  {cite.snippet ? (
                    <span className="lite-flow-cite-snippet">{cite.snippet}</span>
                  ) : null}
                  {cite.resolved === false ? (
                    <span className="lite-flow-cite-warn">{l.roomFlowUnresolved}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  )
}

// live 提问 composer（空态 + 运行后追问共用）。走 store.askLive → feat-015 /advise SSE。
// feat-036：initialValue 承接"带进议事室"的预填上下文（flowStore.composerDraft，挂载时
// 读一次——只预填、不自动提交，manager 审过再问）。
// #64：换成共用的 AskRefComposer（@ 引用弹层 + chips）；提交层把 refs 结构化进
// `askLive.references` 并织进 situation 文字兜底。DOM/类名与旧 LiteAskComposer 静息态等价。
// #69：卡片入口的模板文字改走 placeholder（灰提示，不占正文）——正文通道只剩悬浮胶囊
// （那是 manager 自己刚打完的原话，退成灰提示等于逼他到了议事室再打一遍）。
// #69/#71：发送键在**空文本**或**上一轮还在跑**时置灰。
function LiteAskComposer({
  placeholder,
  submitLabel,
  onAsk,
  initialValue,
  initialRefs,
  busy,
}: {
  placeholder: string
  submitLabel: string
  onAsk: (text: string, refs: AskRef[]) => void
  initialValue?: string
  initialRefs?: AskRef[]
  busy?: boolean
}) {
  const { t } = useDict()
  return (
    <AskRefComposer
      formClassName="nexus-followup-composer"
      formAriaLabel={t.lite2.roomAskAria}
      inputAriaLabel={t.lite2.roomLiveQuestionAria}
      placeholder={placeholder}
      submitClassName="lite-btn lite-btn--primary"
      submitLabel={submitLabel}
      idPrefix="room"
      initialValue={initialValue}
      initialRefs={initialRefs}
      disableEmptySubmit
      busy={busy}
      onSubmit={onAsk}
    />
  )
}

// ── #71 · 会话流的一轮 ────────────────────────────────────────────────────────────────
// 「问题行 + 分析过程 + 回答卡」按提问顺序堆叠（对齐 codex/claude 的 transcript 形态）。
// 🔴 引用回显用 `.lite-room-turn-ref` 而**不是** `.lite-ref-chip`：后者是 composer 里那些
//   可删的活 chip，好几道门按 `.lite-room .lite-ref-chip` 的**数量**断言"选中了/删掉了"，
//   历史轮再长出同类名的节点会把那些判据整批毒化。
function LiteTurnView({
  turn,
  isLast,
  ask,
  noteJustAdded,
  onGoNotes,
}: {
  turn: LiveTurn
  isLast: boolean
  ask: boolean
  noteJustAdded: boolean
  onGoNotes: () => void
}) {
  const { t } = useDict()
  const l = t.lite2
  const run = turn.run
  // 🔴 「在跑」只对尾轮成立：历史轮的 run 状态是它当时的定格，不该再有光标在闪。
  const running = isLast && run.status === 'running'
  const advice = run.advice

  return (
    <article className="lite-room-turn" data-room-turn={turn.id}>
      <section className="lite-room-turn-question" aria-label={l.roomTurnQuestionLabel}>
        <p className="eyebrow">{l.roomTurnQuestionLabel}</p>
        {/* 回显的是 manager 自己打的那句原话——不是提交层织过「涉及：」的 situation。
            引用另起一行出现在下面，比把名字塞回句子里更接近他当时看到的样子。 */}
        <p className="lite-room-turn-question-text">{turn.question}</p>
        {turn.refs && turn.refs.length > 0 ? (
          <p className="lite-room-turn-refs">
            {turn.refs.map((r) => (
              <span
                key={`${r.kind}-${r.id}`}
                className={`lite-room-turn-ref is-${r.kind}`}
                data-turn-ref={r.kind}
                data-ref-id={r.id}
              >
                {r.label}
              </span>
            ))}
          </p>
        ) : null}
      </section>

      <LiteThinkingFlow run={run} running={running} />

      {/* 实时状态条只挂尾轮：它说的是"此刻"，历史轮上摆一条就是假的。 */}
      {isLast ? (
        <div className="nexus-brief-hud">
          <div className="nexus-brief-bar" aria-label={t.nexus.liveThinking}>
            <span className="nexus-brief-bar-eyebrow">{t.nexus.liveThinking}</span>
            <span className="nexus-brief-step">
              {run.status === 'error'
                ? t.nexus.liveError
                : running
                  ? t.nexus.liveRunning
                  : t.nexus.liveReady}
            </span>
          </div>
        </div>
      ) : null}

      {/* 0729/03 分流短答：事实查询的一段话直答（与判读卡互斥）。出处已由上方
          分析过程面板的「依据 N 条原文」承载；追问入口就是屏底常驻 composer。 */}
      {!advice && run.answer ? (
        <div className="lite-room-card lite-room-answer">
          <section className="lite-room-answer-card" aria-label={l.roomAnswerLabel}>
            <p className="eyebrow">{l.roomAnswerLabel}</p>
            <p className="lite-room-answer-text">{run.answer}</p>
          </section>
          {/* nudge 是「刚刚这一轮落了新笔记」的瞬态提示，只可能属于尾轮。 */}
          {isLast && noteJustAdded ? (
            <button type="button" className="lite-btn lite-btn--ghost lite-notes-nudge" onClick={onGoNotes}>
              {l.notesNudge} →
            </button>
          ) : null}
        </div>
      ) : null}

      {advice ? (
        <div className="lite-room-card">
          <LiteAdviceCard advice={advice} />
          {/* feat-047 移植（feat-033）：advise 完成且后端确认新笔记落库才出 nudge
              （丢弃则不出、不显占位）。样式对齐 .lite-metric-chip / .upload-source-chip
              视觉族；点击切到 notes tab。 */}
          {isLast && noteJustAdded ? (
            <button type="button" className="lite-btn lite-btn--ghost lite-notes-nudge" onClick={onGoNotes}>
              {l.notesNudge} →
            </button>
          ) : null}
        </div>
      ) : null}

      {/* feat-034：第二种 artifact 卡——agent 起草的 Quick ask（manager 确认后出门）。
          store 里恒只有一张活体草稿、新一轮开跑即撤旧卡，所以它永远属于尾轮。 */}
      {isLast && ask ? (
        <div className="lite-room-card lite-room-ask">
          <AskCard />
        </div>
      ) : null}
    </article>
  )
}

// ── issue #49 · 议事室历史：后端 advise_runs 的只读回看面（新→旧）─────────────────────
// 右上一枚「之前问过的 · N」入口 + 内滚抽屉面板——刻意不进 .lite-room-board / .nexus-empty
// 的既有 DOM（好几道门锚在那两棵树上），空态与对话态都可达（F5 后 run 回 idle、历史必须
// 还够得着，这正是本功能要解决的丢失面）。
// 渲染门槛：adviseRuns 为 null（stub 通道/未拉取）或空数组时整块不出——历史不该在没有
// 历史的第一天就摆一个空抽屉，stub 下零渲染保住离线门的 DOM 现状。
function LiteRoomHistory() {
  const adviseRuns = useLite((s) => s.adviseRuns)
  const { t, locale } = useDict()
  const [open, setOpen] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  if (!adviseRuns || adviseRuns.length === 0) return null
  const stampOf = (iso: string) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }
  return (
    <>
      <button
        type="button"
        className="lite-btn lite-btn--ghost lite-room-history-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {t.lite2.roomHistoryTitle} · {adviseRuns.length}
      </button>
      {open ? (
        <section className="lite-room-history-panel" aria-label={t.lite2.roomHistoryTitle}>
          <ol className="lite-room-history-list">
            {adviseRuns.map((run) => {
              const expanded = openId === run.id
              // 展开才 coerce——列表滚动时不为收着的条目做形状归一。
              const advice = expanded ? coerceAdvice(run.advice) : null
              return (
                <li key={run.id} className={expanded ? 'is-open' : undefined}>
                  <button
                    type="button"
                    className="lite-room-history-head"
                    aria-expanded={expanded}
                    onClick={() => setOpenId(expanded ? null : run.id)}
                  >
                    <span className="lite-room-history-q">{run.question}</span>
                    <span className="lite-room-history-date">{stampOf(run.created_at)}</span>
                    <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
                  </button>
                  {expanded ? (
                    <div className="lite-room-history-body">
                      {advice ? (
                        /* .lite-room-card 包裹与 board 同款——它承担「解除 story 绝对定位」
                           的职责（lite2.css board 段 + history 段各一份同规格规则）。 */
                        <div className="lite-room-card">
                          <LiteAdviceCard advice={advice} />
                        </div>
                      ) : run.answer ? (
                        <section className="lite-room-answer-card" aria-label={t.lite2.roomAnswerLabel}>
                          <p className="eyebrow">{t.lite2.roomAnswerLabel}</p>
                          <p className="lite-room-answer-text">{run.answer}</p>
                        </section>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ol>
        </section>
      ) : null}
    </>
  )
}

// feat-045（PRD F5）· 空态建议问题 chips——4 个泛化开场问（不预设语料内容），点击即发问
// （直接走同一个 askLive，不经 composer 预填——"点击即发问"是拍板原文）。稳定 data-chip-id
// 供门相位（chipsAsk）断言；文案在 en.ts lite2.roomChip*。
const ROOM_CHIPS: { id: string; text: (l: Dict['lite2']) => string }[] = [
  { id: 'attention', text: (l) => l.roomChipAttention },
  { id: 'project-risk', text: (l) => l.roomChipRisk },
  { id: 'handoff', text: (l) => l.roomChipHandoff },
  { id: 'next-week', text: (l) => l.roomChipPlanning },
]

// #69 · 预填的「认领」闸。为什么不是「挂载时读一次」：StrictMode（dev）会把组件
// 挂载→卸载→重挂载，任何以挂载为闸的读取在**第二次**挂载时读到的都是已经被消费掉的空值
// （Lite2App 的 useRoomQueryRelay 早就为同一个坑改用了 location.key）。这里同款：
// 按 history 条目认领一次——重挂载认领的还是同一条，值还在；下一次进议事室是新条目，
// 重新读 store（那时已被 consume 清空）＝默认提示。
type ComposerEntry = { draft: string | null; hint: string | null; refs: AskRef[] | null }
let entryClaim: { key: string; entry: ComposerEntry } | null = null
function claimComposerEntry(key: string, live: ComposerEntry): ComposerEntry {
  if (!entryClaim || entryClaim.key !== key) entryClaim = { key, entry: live }
  return entryClaim.entry
}

export function RoomScreen() {
  // #71 · 会话流：turns 是唯一真相，屏上按顺序堆叠。`store.run`（尾轮镜像）在本屏不再读——
  // 读它就等于又回到"只看得见最后一轮"的单槽视角。
  const turns = useLite((s) => s.turns)
  const ask = useLite((s) => s.ask)
  const askLive = useLite((s) => s.askLive)
  const clearTurns = useLite((s) => s.clearTurns)
  const noteJustAdded = useLite((s) => s.noteJustAdded)
  const goScreen = useLite((s) => s.goScreen)
  const clearNoteNudge = useLite((s) => s.clearNoteNudge)
  // 0721 对齐棒（合伙人反馈 A2）：无材料 gate 的判据。用 contextId 而不用 team——
  // contextId 在 store 模块求值时就从 localStorage 同步恢复（restoredContextId），
  // 回访用户第一帧就非空，不会在 restoreSession 网络往返期间闪一下"没材料"空态；
  // 真正的新访客两者皆空，restore 404 时 store 会把两者一起清掉（store.ts:499-501），
  // 判据同样成立。🔴 gate 只落在这一层 UI：store.askLive 与 __lite2Store 测试缝保持
  // 无条件——门的 stub 注入路径不经过这里。
  const contextId = useLite((s) => s.contextId)
  const { t } = useDict()

  // feat-036：分诊"带进议事室"的预填——读一次即消费，之后正常导航不会再带旧草稿回来。
  // #64：悬浮胶囊中继来的 @ 引用（composerDraftRefs）随文字一起消费——可能只有 refs 没有
  // 文字（q 空），所以判据看三者任一非 null，不能只看 composerDraft 真值。
  // #69：多了一条 hint 通道（卡片模板产文 → 灰 placeholder）。
  const composerDraft = useFlow((s) => s.composerDraft)
  const composerHint = useFlow((s) => s.composerHint)
  const composerDraftRefs = useFlow((s) => s.composerDraftRefs)
  const consumeComposerDraft = useFlow((s) => s.consumeComposerDraft)
  const { key: locationKey, pathname, search } = useLocation()
  const entry = claimComposerEntry(locationKey, {
    draft: composerDraft,
    hint: composerHint,
    refs: composerDraftRefs,
  })
  useEffect(() => {
    if (composerDraft !== null || composerHint !== null || composerDraftRefs !== null) {
      consumeComposerDraft()
    }
    // 只在挂载时消费一次——依赖数组特意留空，effect 不该在 composerDraft 变化时重跑。
    // 值已经在上面 render 期被 entryClaim 认领走了，这里清的是 store，不影响本次显示。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // #71 · 离开议事室即散场（票面拍板：session 内连续，离开/刷新这场对话就结束）。
  // 刷新那一半是免费的——turns 只活在内存里，**刻意没有** localStorage / 库的第二份拷贝。
  useEffect(() => () => clearTurns(), [clearTurns])

  // #64 · 提交层的双通道：refs 结构化进契约（新后端保证注入），同时织进 situation 文字
  //（旧后端静默忽略 references 的窗口期，答案不比今天差——askRefs.weaveRefs 文件头）。
  // #71 · 第二参是**织文前的原话**，会话流回显它；history 由 store 从 turns 自己组装。
  const askWithRefs = (text: string, refs: AskRef[]) => {
    const situation = weaveRefs(text, refs, t.lite2.refWeavePrefix, t.lite2.refWeaveSeparator)
    if (refs.length > 0) askLive({ situation, references: toWireRefs(refs) }, text)
    else askLive({ situation }, text)
  }

  // nudge-clear-only-on-goscreen-path：离开 Room 的三条路径（goScreen tab 切换 / Topbar
  // <Link> / 浏览器前进后退）唯一的公共信号是 location 变了——所以在这里订阅
  // location.pathname + location.search，值一变就清掉本屏的一次性 nudge（见 store.ts
  // clearNoteNudge 上方注释）。RoomScreen 挂载本身也算一次「变了」，覆盖「离开后又回到
  // Room」这条路：Room 之外触发的清点走不到这个 effect，全靠重新挂载补上。
  useEffect(() => {
    clearNoteNudge()
  }, [pathname, search, clearNoteNudge])

  // issue #49 · 历史拉取：挂载/换公司拉一次；一次 run 完成后再拉（服务端在 manifest 时刻
  // 已落库，complete 时刷新即可把刚问的这条带进列表）。stub/无 context 下是无操作。
  const refreshAdviseRuns = useLite((s) => s.refreshAdviseRuns)
  const lastRun = turns.length > 0 ? turns[turns.length - 1].run : null
  const lastStatus = lastRun?.status ?? 'idle'
  useEffect(() => {
    void refreshAdviseRuns()
  }, [refreshAdviseRuns, contextId])
  useEffect(() => {
    if (lastStatus === 'complete') void refreshAdviseRuns()
  }, [lastStatus, refreshAdviseRuns])

  // #71 · 新一轮起跑就把滚动区带到底部（对齐常见 AI chat：新消息进来跟着走）。
  // 只在**轮数**变化时跑——流式过程中每帧都滚会把 manager 正在读的历史轮拽走。
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns.length])

  const running = lastStatus === 'running'
  const hasStarted = turns.length > 0

  return (
    <section className="scene scene-nexus is-active lite-room" aria-label={t.lite2.tabRoom}>
      {hasStarted ? (
        <>
          {/* 0729 输出形态战役 01 · 画板退役（Danny 拍板，kickoff 见 .issues/output-form-0729/）：
              pan/zoom 画布换成全站统一的 scroll→frame 纵向语法。⚠ .lite-room-board 类名保留——
              它同时承担「解除 story 绝对定位」的职责（lite2.css board 段），改的只是它自己的
              布局规则（1180px 世界宽 → 纵向列）。composer 仍在滚动区外恒可点。 */}
          <div className="lite-room-scroll" aria-label={t.lite2.roomBoardAria} ref={scrollRef}>
            {/* #71 · 会话流：一轮一个 <article>，按提问顺序堆叠，尾部是当前这一轮。
                第二问不再覆盖第一问——覆盖此前是结构性的（store 只有一个 run 单槽）。 */}
            <div className="lite-room-board" data-room-turns={turns.length}>
              {turns.map((turn, i) => (
                <LiteTurnView
                  key={turn.id}
                  turn={turn}
                  isLast={i === turns.length - 1}
                  ask={ask !== null}
                  noteJustAdded={noteJustAdded}
                  onGoNotes={() => goScreen('notes')}
                />
              ))}
            </div>
          </div>
          {/* 追问 composer：常驻屏底、在滚动区外。预填只属于**空态**那一份（进屋那一刻
              才有卡片上下文），所以这里恒是默认提示 + 空正文。 */}
          <LiteAskComposer
            placeholder={t.nexus.askPlaceholder}
            submitLabel={t.nexus.ask}
            onAsk={askWithRefs}
            busy={running}
          />
        </>
      ) : contextId === null ? (
        /* 0721 · 无材料诚实空态（合伙人实测：零数据提问被呈现成「中途断了」系统故障样，
           实际要么烧默认英文 demo 语料的真 LLM、要么 LLM 侧断流——两种都不是网络问题）。
           没有材料就不给「注定失败的输入」：composer 和建议 chips 一并收起，只留引导。
           下棒「一键加载示例团队」拍板后（Q3-A）按钮加在 CTA 旁，本棒不出假按钮。 */
        <section className="nexus-empty lite-room-nomaterial" data-room-nomaterial="" aria-label={t.lite2.roomNoMaterialTitle}>
          {/* eyebrow 用 tab 名而不是 liveThinking（「正在仔细梳理中」）——此刻并没有任何
              东西在被梳理，那句在这个状态里是假的。 */}
          <p className="eyebrow">{t.lite2.tabRoom}</p>
          <h2>{t.lite2.roomNoMaterialTitle}</h2>
          <p>{t.lite2.roomNoMaterialBody}</p>
          <button
            type="button"
            className="lite-btn lite-btn--primary lite-room-nomaterial-cta"
            onClick={() => goScreen('home')}
          >
            {t.lite2.roomNoMaterialCta} →
          </button>
        </section>
      ) : (
        <section className="nexus-empty" aria-label={t.lite2.roomEmptyAria}>
          <p className="eyebrow">{t.nexus.liveThinking}</p>
          <h2>{t.lite2.roomEmptyTitle}</h2>
          <p>{t.lite2.roomEmptyBody}</p>
          <div className="nexus-empty-composer-wrap">
            {/* #69 · 卡片入口带来的模板句落在 placeholder 上（灰、不占正文、发送不带、
                一打字就消失）；chips 照旧是真 refs。正文只有悬浮胶囊中继那一条路会填。 */}
            <LiteAskComposer
              placeholder={entry.hint ?? t.nexus.askPlaceholder}
              submitLabel={t.nexus.ask}
              onAsk={askWithRefs}
              initialValue={entry.draft ?? undefined}
              initialRefs={entry.refs ?? undefined}
            />
          </div>
          {/* feat-045：建议问题 chips——点击即发问（同一个 askLive 路径，真 SSE）。 */}
          <div className="lite-room-chips" aria-label={t.lite2.roomChipsLabel}>
            <p className="eyebrow lite-room-chips-label">{t.lite2.roomChipsLabel}</p>
            <div className="lite-room-chip-row">
              {ROOM_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className="lite-room-chip"
                  data-chip-id={chip.id}
                  onClick={() => askLive({ situation: chip.text(t.lite2) })}
                >
                  {chip.text(t.lite2)}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}
      {/* issue #49 · 历史入口+抽屉：absolute 定位，不进 board/empty 两棵门锚树；
          对话态与空态都渲染（F5 后历史必须仍可达）。无历史/stub 下自身返回 null。 */}
      <LiteRoomHistory />
    </section>
  )
}
