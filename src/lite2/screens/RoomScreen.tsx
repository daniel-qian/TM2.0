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
import { renderMarkdown } from '../markdown'
import { ATTACH_ACCEPT, precheckAttachments, type AttachPrecheckFail } from '../uploadLimits'
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

          {/* #75 · 中断也必须在面板里说一句。不说的话现象是「四相停在半路、没有任何解释」——
              与 SSE 断流那一条（上面 error 分支）当初的病根一模一样：看不出是失败、是还在跑、
              还是被自己按停了。这里说的是「你按的」，所以措辞与 roomFlowFailed 不同。 */}
          {run.status === 'interrupted' ? (
            <p className="lite-flow-stopped" data-flow-stopped="" role="status">
              {l.roomFlowInterrupted}
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

// #73 · 议事室现场附件的一格。`ref` 只在 ready 之后才有——它是**回执里那个服务端权威名**
// 构出来的，不是用户当初选的文件名（见下方 attach 那段 🔴）。
type RoomAttachment = {
  key: string
  label: string
  state: 'uploading' | 'ready' | 'failed'
  note?: string
  ref?: AskRef
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
  onStop,
  attachments,
  attachBusy,
  attachError,
  onAttach,
  onRemoveAttachment,
}: {
  placeholder: string
  submitLabel: string
  onAsk: (text: string, refs: AskRef[]) => void
  initialValue?: string
  initialRefs?: AskRef[]
  busy?: boolean
  onStop?: () => void
  attachments?: RoomAttachment[]
  attachBusy?: boolean
  attachError?: string | null
  onAttach?: (files: File[]) => void
  onRemoveAttachment?: (key: string) => void
}) {
  const { t } = useDict()
  const l = t.lite2
  return (
    <AskRefComposer
      formClassName="nexus-followup-composer"
      formAriaLabel={l.roomAskAria}
      inputAriaLabel={l.roomLiveQuestionAria}
      placeholder={placeholder}
      submitClassName="lite-btn lite-btn--primary"
      submitLabel={submitLabel}
      idPrefix="room"
      initialValue={initialValue}
      initialRefs={initialRefs}
      disableEmptySubmit
      busy={busy}
      onSubmit={onAsk}
      onStop={onStop}
      stopLabel={l.roomStopLabel}
      stopAriaLabel={l.roomStopAria}
      attachments={attachments}
      attachAriaLabel={l.roomAttachAria}
      attachAccept={ATTACH_ACCEPT}
      attachBusy={attachBusy}
      attachError={attachError}
      onAttach={onAttach}
      onRemoveAttachment={onRemoveAttachment}
      removeAttachmentAria={(label) => fill(l.roomAttachRemoveAria, { label })}
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
  onAskFollowup,
}: {
  turn: LiveTurn
  isLast: boolean
  ask: boolean
  noteJustAdded: boolean
  onGoNotes: () => void
  // #72 · 建议追问 chip 点击即发（走 RoomScreen 的 askWithRefs → 同一个 askLive 路径，
  // history 由 store 组装）。
  onAskFollowup: (question: string) => void
}) {
  const { t } = useDict()
  const l = t.lite2
  const run = turn.run
  // 🔴 「在跑」只对尾轮成立：历史轮的 run 状态是它当时的定格，不该再有光标在闪。
  const running = isLast && run.status === 'running'
  const advice = run.advice
  // #78 · 从历史场回灌出来的一轮。过程态**结构性没落库**（原始流/四相/结构化引用/计数，
  // 0012 头注拍板不存），所以这里的降级不是"少显示点"而是"别撒谎"：
  //   · 四相面板：emptyRunState 的四相全 pending，phaseMeta 会把它们渲染成 4×「待命」——
  //     对一条早就答完的记录那是纯假话，整块不渲染。
  //   · 实时状态条（HUD）：它说的是"此刻这一轮跑得怎么样"，而回灌轮此刻什么都没在跑。
  //   · 引用 chips 行：refs 是 null，本来就不渲染（缺失不是"没引用"，见 store 的注释）。
  // 换上一行明说"这是从历史载入的、当时的过程没留存"，让缺失可辨而不是看起来像空。
  const hydrated = turn.hydrated === true
  // #72 · 建议追问 chips：只挂尾轮（与实时状态条/快问卡同族——"接着可以问"说的是此刻，
  // 摆在历史轮上就是假的）、只在本轮真答完之后（running/error 没有可追问的结论）、
  // 且必须真有回答卡在场（advice 或短答——chips 是回答的下摆，不是独立漂浮物）。
  const followups =
    isLast && run.status === 'complete' && (advice || run.answer) ? run.followups : []

  return (
    // #75 · data-run-status 让门直接采到这一轮的终态（不必读 store 的镜像 run）——
    // 「停止」的判据要能钉在**这一轮**上，而不是全局最后一次运行上。
    <article
      className={classNames(['lite-room-turn', hydrated ? 'is-hydrated' : ''])}
      data-room-turn={turn.id}
      data-run-status={run.status}
      {...(hydrated ? { 'data-turn-hydrated': '' } : {})}
    >
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

      {/* #78 · 回灌轮换成一行诚实说明；本次现问的轮照旧渲染四相面板。 */}
      {hydrated ? (
        <p className="lite-room-turn-hydrated" data-hydrated-note>
          {l.roomTurnFromHistory}
        </p>
      ) : (
        <LiteThinkingFlow run={run} running={running} />
      )}

      {/* 实时状态条只挂尾轮：它说的是"此刻"，历史轮上摆一条就是假的。
          #78 · 回灌轮即使是尾轮也不挂：它此刻没在跑，那条状态条无话可说。 */}
      {isLast && !hydrated ? (
        <div className="nexus-brief-hud">
          <div className="nexus-brief-bar" aria-label={t.nexus.liveThinking}>
            {/* 🔴 #75 人眼过逮到的自相矛盾：这条眉标写死「正在仔细梳理中 · 实时」，于是
                中断态的状态条会并排显示「正在仔细梳理中」＋「已停止，这轮没答完」——
                同一个部件同时说两件相反的事。（ready 态其实早就有这毛病：「正在梳理」＋
                「分析好了」；本票新增的中断态只是把它顶到了脸上。）
                只在**真的在跑**的时候才渲染它：说的是此刻，此刻没在跑就别说。
                改的是渲染条件不是字典值——文案批改归 #79，这里不越界。
                aria-label 留在容器上不动（读屏那条路仍有名字，aria-zh 门照旧采得到）。 */}
            {running ? (
              <span className="nexus-brief-bar-eyebrow">{t.nexus.liveThinking}</span>
            ) : null}
            {/* 🔴 #75 · 这个三元曾经是全库最毒的一处静默走错分支：新加的 'interrupted'
                会掉进最后那个 else，屏上写「分析好了，可以看了」——manager 刚亲手按停。
                四态一一显式列出，不留兜底 else 吃掉未来的新状态。 */}
            <span className="nexus-brief-step">
              {run.status === 'error'
                ? t.nexus.liveError
                : run.status === 'interrupted'
                  ? t.nexus.liveInterrupted
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
            {/* #75 · 短答走 markdown 渲染（分点/表格/强调不再糊成一坨）。
                🔴 只有**回答**渲染 markdown，提问回显（.lite-room-turn-question-text）
                   一律保持纯文本：room-conversation 有几条判据是拿原话做**精确相等**比对的，
                   语料一旦含 `*_#[]()` 就会因为字符被解析/包进标签而漂移。今天的 fixture
                   不含特殊字符，所以那是颗隐性地雷而不是即时地雷——别去踩它。
                🔴 渲染器不产 HTML 字符串、不碰 dangerouslySetInnerHTML：正文全走文本节点，
                   注入面只剩链接 href，scheme 白名单 fail closed（见 markdown.tsx 头）。 */}
            <div className="lite-room-answer-text" data-answer-md="">
              {renderMarkdown(run.answer, `ans-${turn.id}`)}
            </div>
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

      {/* #72 · 建议追问 chips（advice 与短答两路共用——两种回答卡下方都要有）。
          文字就是完整问题，点击=发出去（点击即发是票面拍板；上一轮在跑时本块整个不渲染
          ——渲染条件见上方 followups 的推导——双击/同拍重复触发由 store.askLive 的
          busy 闸兜底，UI 的 disabled 挡不住同一拍的第二下）。 */}
      {followups.length > 0 ? (
        <div className="lite-room-followups" data-followup-chips="" aria-label={l.roomFollowupsLabel}>
          <p className="eyebrow lite-room-followups-label">{l.roomFollowupsLabel}</p>
          <div className="lite-room-chip-row">
            {followups.map((q, i) => (
              <button
                key={`${turn.id}-fu-${i}`}
                type="button"
                className="lite-room-chip"
                data-followup-chip={i}
                onClick={() => onAskFollowup(q)}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* feat-034：第二种 artifact 卡——agent 起草的 Quick ask（manager 确认后出门）。
          store 里恒只有一张活体卡；#72 起「没动过的草稿随新一轮退场、动过的/已发出的
          受保护不撤」（store.askLive），渲染仍恒挂尾轮。 */}
      {isLast && ask ? (
        <div className="lite-room-card lite-room-ask">
          <AskCard />
        </div>
      ) : null}
    </article>
  )
}

// ── issue #49 → #78 · 议事室历史：按**场**分组的对话列表 ────────────────────────────
// 右上一枚「历史对话 · N 场」入口 + 内滚面板——刻意不进 .lite-room-board / .nexus-empty
// 的既有 DOM（好几道门锚在那两棵树上）。
//
// #78 改了它的性质：从「只读回看抽屉」变成「打开一场对话」的入口。
//   * 列表单位从**条**变成**场**（一场 = 一个 thread_id 下的全部轮次）。
//   * 点一场 → hydrateThread 把整场灌进议事室 → 在那里接着问，新轮落回同一场。
//   * 面板里**不再就地展开判读卡**：详情视图就是议事室本身，两处渲染同一份内容是
//     两套要各自维护的代码（#75 留下的账「历史里的短答仍是纯文本、与会话流的 markdown
//     不一致」正是这么来的）。这条账在这里**靠删掉那个渲染面**结清——回放统一走
//     LiteTurnView，短答自然跟着走 markdown，不存在第二处实现可以再漂。
//
// 渲染门槛：adviseThreads 为 null（stub 通道/未拉取）或空数组时整块不出——三态语义与
// adviseRuns 逐字相同，stub 下零渲染保住离线门的 DOM 现状。
function LiteRoomHistory() {
  const adviseThreads = useLite((s) => s.adviseThreads)
  const hydrateThread = useLite((s) => s.hydrateThread)
  const currentThreadId = useLite((s) => s.threadId)
  // 🔴 禁点闸读的是**尾轮**的状态，不是顶层镜像 run：顶层是尾轮的镜像没错，但判据落在
  //    真相（turns）上比落在镜像上少一层可能不同步的东西。
  const busy = useLite((s) => {
    const tail = s.turns[s.turns.length - 1]
    return tail ? tail.run.status === 'running' : false
  })
  const { t, locale } = useDict()
  const [open, setOpen] = useState(false)
  if (!adviseThreads || adviseThreads.length === 0) return null
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
        data-history-toggle
        onClick={() => setOpen((o) => !o)}
      >
        {/* 计数的单位跟着变了（条→场），所以这里显式说出「场」：沿用光秃秃的 · N
            会让同一句话在语义变了之后继续看起来没变。文案批改本身归 #79。 */}
        {t.lite2.roomHistoryTitle} · {fill(t.lite2.roomHistoryCount, { n: adviseThreads.length })}
      </button>
      {open ? (
        <section
          className="lite-room-history-panel"
          aria-label={t.lite2.roomHistoryTitle}
          data-history-panel
        >
          <ol className="lite-room-history-list">
            {adviseThreads.map((thread) => {
              // 无场归属的存量单轮（thread_id 为空）用它自己的 run id 当 key——绝不让它们
              // 因为"共用空串这个键"在 React 里塌成一个。
              const key = thread.thread_id || thread.runs[0]?.id || ''
              const first = thread.runs[0]
              const last = thread.runs[thread.runs.length - 1]
              const isCurrent = !!thread.thread_id && thread.thread_id === currentThreadId
              if (!first) return null
              return (
                <li key={key} className={isCurrent ? 'is-current' : undefined}>
                  <button
                    type="button"
                    className="lite-room-history-head"
                    data-history-thread={key}
                    data-history-turns={thread.runs.length}
                    // 锁①：生成中禁点。政策拍板 (b) —— 打开一场是**替换**当前 turns，
                    // 在跑的那一轮会被顶掉且它还没落库，所以只能等它答完。
                    // 锁②在 store.hydrateThread 里（同一拍双击够不着 React 的重渲染）。
                    disabled={busy || undefined}
                    title={busy ? t.lite2.roomHistoryBusy : undefined}
                    aria-label={
                      isCurrent ? t.lite2.roomHistoryCurrent : t.lite2.roomHistoryOpenAria
                    }
                    onClick={() => {
                      hydrateThread(thread)
                      setOpen(false)
                    }}
                  >
                    {/* 场的标题就是它的**第一问**——一场对话是从哪句话开始的，比它最后聊到
                        哪儿更能让人认出它。 */}
                    <span className="lite-room-history-q">{first.question}</span>
                    <span className="lite-room-history-meta">
                      <span className="lite-room-history-turns">
                        {thread.runs.length > 1
                          ? fill(t.lite2.roomHistoryTurns, { n: thread.runs.length })
                          : t.lite2.roomHistoryEmptyThread}
                      </span>
                      {/* 时间戳取**最后一轮**：列表是按最近活动排的，标一个开场时间会和
                          排序打架（老场被追问后浮到最前、却显示着最老的时间）。 */}
                      <span className="lite-room-history-date">{stampOf(last.created_at)}</span>
                    </span>
                  </button>
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
  const stopLive = useLite((s) => s.stopLive)
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
  // ── #73 · 现场附件 ────────────────────────────────────────────────────────────────
  // 上传即入当前公司资料库（append 语义，与资料库那个入口同一条 store 路径）；转换完把
  // **回执里的服务端权威名**构成 file 引用，随这一问一起发出去。
  const appendFiles = useLite((s) => s.appendFiles)
  const [attachments, setAttachments] = useState<RoomAttachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const attachBusy = attachments.some((a) => a.state === 'uploading')

  const precheckMessage = (fail: AttachPrecheckFail): string => {
    if (fail.kind === 'too-many') return fill(t.lite2.roomAttachTooMany, { max: fail.max })
    if (fail.kind === 'too-large') return fill(t.lite2.roomAttachTooLarge, { name: fail.name, max: fail.max })
    return fill(t.lite2.roomAttachBatchTooLarge, { max: fail.max })
  }

  const handleAttach = async (picked: File[]) => {
    setAttachError(null)
    // 🔴 选文件那一刻就判，不等 413（票面原话）。判不过整批拒收、一个字节都不发。
    const fail = precheckAttachments(picked)
    if (fail) {
      setAttachError(precheckMessage(fail))
      return
    }
    const batch: RoomAttachment[] = picked.map((f, i) => ({
      key: `at-${Date.now()}-${i}-${f.name}`,
      label: f.name,
      state: 'uploading',
      note: t.lite2.roomAttachBusy,
    }))
    setAttachments((prev) => [...prev, ...batch])
    const batchKeys = new Set(batch.map((b) => b.key))

    await appendFiles(picked)
    // 抽取是在**同一次 HTTP 请求**里同步跑完再返回的（ingest_api.py 的 run_in_threadpool），
    // 所以这个 await 回来就是「读完了」，不需要再轮询什么完成信号。
    const { appendStatus, appendError, appendReceipt } = useLite.getState()
    if (appendStatus === 'error') {
      setAttachError(appendError ?? t.lite2.roomAttachFailed)
      setAttachments((prev) =>
        prev.map((a) =>
          batchKeys.has(a.key) ? { ...a, state: 'failed', note: t.lite2.roomAttachFailed } : a,
        ),
      )
      return
    }
    // 🔴 用**回执**的 documents[] 构 ref，不用刷新后的 store.files[].filename：
    //    回执给的是 `sd.source_key or sd.filename`（ingest_api.py:833）＝服务端消歧后的
    //    权威名；而 `GET /team/{id}/files` 回填的是 `sd.filename`＝用户当初选的原始名
    //    （registry.py:797），撞名时两行字面完全相同、只靠 idx 区分。后端解引用是
    //    `source_key == want or filename == want` 的 `next(...)`**取第一个命中**
    //    （references.py:155）——拿原始名去指，撞名时指到的不一定是刚传的这一份。
    //    （id 契约的根治归 #74 / S2，本票只走今天能对的那条路。）
    const served = appendReceipt?.documents ?? []
    setAttachments((prev) => {
      let cursor = 0
      return prev.map((a) => {
        if (!batchKeys.has(a.key)) return a
        const authoritative = served[cursor++] ?? a.label
        return {
          ...a,
          state: 'ready',
          note: undefined,
          label: authoritative,
          ref: { kind: 'file', id: authoritative, label: authoritative, meta: '', dupeTeam: '' },
        }
      })
    })
  }

  const removeAttachment = (key: string) => {
    setAttachError(null)
    setAttachments((prev) => prev.filter((a) => a.key !== key))
  }

  // #64 · 提交层的双通道：refs 结构化进契约（新后端保证注入），同时织进 situation 文字
  //（旧后端静默忽略 references 的窗口期，答案不比今天差——askRefs.weaveRefs 文件头）。
  // #71 · 第二参是**织文前的原话**，会话流回显它；history 由 store 从 turns 自己组装。
  // #73 · 已经读完的附件随这一问一起进 references（还在读的不进——它还没有权威名，
  //       硬塞一个用户选的原始名进去就是在赌撞名，见 handleAttach 里那段 🔴）。
  const askWithRefs = (text: string, refs: AskRef[]) => {
    const attached = attachments
      .filter((a) => a.state === 'ready' && a.ref)
      .map((a) => a.ref as AskRef)
    const all = [...refs, ...attached].filter(
      (r, i, arr) => arr.findIndex((x) => x.kind === r.kind && x.id === r.id) === i,
    )
    const situation = weaveRefs(text, all, t.lite2.refWeavePrefix, t.lite2.refWeaveSeparator)
    if (all.length > 0) askLive({ situation, references: toWireRefs(all) }, text)
    else askLive({ situation }, text)
    // 附件是「这一问」的附件：发完就从 composer 上撤下来（文件本身已经在资料库里，
    // 之后照常能用 @ 引用到——撤的是这一问的挂载，不是把文件删了）。
    setAttachments([])
    setAttachError(null)
  }

  // nudge-clear-only-on-goscreen-path：离开 Room 的三条路径（goScreen tab 切换 / Topbar
  // <Link> / 浏览器前进后退）唯一的公共信号是 location 变了——所以在这里订阅
  // location.pathname + location.search，值一变就清掉本屏的一次性 nudge（见 store.ts
  // clearNoteNudge 上方注释）。RoomScreen 挂载本身也算一次「变了」，覆盖「离开后又回到
  // Room」这条路：Room 之外触发的清点走不到这个 effect，全靠重新挂载补上。
  useEffect(() => {
    clearNoteNudge()
  }, [pathname, search, clearNoteNudge])

  // issue #49 → #78 · 历史拉取：挂载/换公司拉一次；一次 run 完成后再拉（服务端在 manifest
  // 时刻已落库，complete 时刷新即可把刚问的这条带进列表）。stub/无 context 下是无操作。
  // #78 起拉的是**按场分组**那条（界面读它）；平铺那条前端不再调用。
  const refreshAdviseThreads = useLite((s) => s.refreshAdviseThreads)
  const lastRun = turns.length > 0 ? turns[turns.length - 1].run : null
  const lastStatus = lastRun?.status ?? 'idle'
  useEffect(() => {
    void refreshAdviseThreads()
  }, [refreshAdviseThreads, contextId])
  // #75 · interrupted 也拉一次——这是**唯一**一处 interrupted 该跟着 complete 走的分支。
  // 理由是后端那个窄窗口：中止若恰好落在「manifest 已生成、帧还没送到浏览器」之间，
  // 服务端已经落了一条完整的 advise_run（app.py 的 on_manifest 在 yield 之前就调了），
  // 那条记录立刻出现在「历史对话」里，比让它悄悄躺到下次进屋才冒出来少一次惊吓。
  useEffect(() => {
    if (lastStatus === 'complete' || lastStatus === 'interrupted') void refreshAdviseThreads()
  }, [lastStatus, refreshAdviseThreads])

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
      {contextId !== null ? (
        // ── #75 · docked composer 三态统一 ────────────────────────────────────────
        // 空态与对话态从此**同一棵树**：滚动区 + 屏底常驻 composer。改造前空态是 story 的
        // `.nexus-empty` 居中卡（absolute top:42%）里塞一个 static 化的 composer，第一问发出
        // 就整屏重排、composer 瞬移到屏底换了宽度换了锚点——那不是设计，是地质层。
        //
        // 🔴 三条结构纪律，每条背后都有一道门：
        //   ① composer 必须是 `.lite-room` 的**直接子元素**——`.lite-room > .nexus-followup-composer`
        //      是 CSS(:8197 run 态归位) 与 room-usability 结构判据的双承重选择器。
        //   ② composer 必须在 `.lite-room-board` **之外**——room-usability 取
        //      `board.children[last]` 当「最后一轮卡」，把 composer 塞进 board（sticky 贴底那种
        //      常见简易写法）会让它抓到 composer 自己跟自己比，**对着任何真回归都全绿**。
        //   ③ 全树 `.nexus-followup-composer` 恒**只有一个实例**——snippet 相位 H 的
        //      composerInScroll/composerOutside 与 room-conversation 的 count()===1 都靠这条；
        //      拿两份 DOM 做 crossfade 过渡会同时打破它们。
        <>
          {/* 0729 输出形态战役 01 · 画板退役（Danny 拍板，kickoff 见 .issues/output-form-0729/）：
              pan/zoom 画布换成全站统一的 scroll→frame 纵向语法。⚠ .lite-room-board 类名保留——
              它同时承担「解除 story 绝对定位」的职责（lite2.css board 段）。 */}
          <div className="lite-room-scroll" aria-label={t.lite2.roomBoardAria} ref={scrollRef}>
            {/* #71 · 会话流：一轮一个 <article>，按提问顺序堆叠，尾部是当前这一轮。
                第二问不再覆盖第一问——覆盖此前是结构性的（store 只有一个 run 单槽）。
                turns 为空时这里放开场块，于是「发第一问」只是往同一个容器里追加内容，
                composer 一个像素都不动。 */}
            <div className="lite-room-board" data-room-turns={turns.length}>
              {hasStarted ? (
                turns.map((turn, i) => (
                  <LiteTurnView
                    key={turn.id}
                    turn={turn}
                    isLast={i === turns.length - 1}
                    ask={ask !== null}
                    noteJustAdded={noteJustAdded}
                    onGoNotes={() => goScreen('notes')}
                    /* #72 · chip 文字就是完整问题——refs 为空走 askWithRefs 的无引用分支，
                       situation 恒等于 chip 原文（门的网络层判据钉这条）。 */
                    onAskFollowup={(q) => askWithRefs(q, [])}
                  />
                ))
              ) : (
                <section className="lite-room-welcome" data-room-welcome="" aria-label={t.lite2.roomEmptyAria}>
                  {/* eyebrow 刻意**删掉**（不是改字）：这里原来挂的是 `t.nexus.liveThinking`
                      「正在仔细梳理中 — 实时」，而此刻并没有任何东西在被梳理——nomaterial 态
                      早就修过同款问题，空态漏了网。删元素而不动字典，是为了不越界进 #79 的
                      文案批改地盘；顺带也满足「一屏别处处挂 eyebrow」的克制。 */}
                  <h2>{t.lite2.roomEmptyTitle}</h2>
                  <p>{t.lite2.roomEmptyBody}</p>
                  {/* feat-045：建议问题 chips——点击即发问（同一个 askLive 路径，真 SSE）。
                      ⚠ `.lite-room-chip` 的**数量**是 room-nomaterial 的判据（世界 A 数 0、
                      世界 B 数 4），新部件一律别蹭这个类名。 */}
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
            </div>
          </div>
          {/* 常驻 composer：屏底、滚动区外、两态同一份。预填（灰提示/正文/refs）只在进屋那
              一刻有意义，所以仍然只喂给它一次——turns 已经开跑之后 entry 早被消费空了。 */}
          <LiteAskComposer
            /* #79 · 从共享 `nexus.askPlaceholder`（v01 的「向你的团队提问…」）分叉到 lite2 自己
               的键。共享那条留给冻结壳一个字节不动——v01 的屏叫「议事室」、隐喻是一屋子人；
               v02 问的对象是 Avery 本身。分叉先例：teamEmptyLead ← team.emptyBody（zh.ts:703-704）。 */
            placeholder={entry.hint ?? t.lite2.roomAskPlaceholder}
            submitLabel={t.nexus.ask}
            onAsk={askWithRefs}
            initialValue={entry.draft ?? undefined}
            initialRefs={entry.refs ?? undefined}
            busy={running}
            onStop={stopLive}
            attachments={attachments}
            attachBusy={attachBusy}
            attachError={attachError}
            onAttach={(picked) => void handleAttach(picked)}
            onRemoveAttachment={removeAttachment}
          />
          {/* issue #49 → #78 · 历史入口+面板：absolute 定位，不进 board/empty 两棵门锚树。
              🔴 #78 把它从 `.lite-room` 的末尾**挪进了 contextId !== null 这一支**：它现在
              是「打开一场对话」的入口，而 hydrate 的目标（滚动区 + composer）只在这一支里
              存在——挂在外面就有一条「无材料态点历史 → 灌进一棵不存在的树」的路。
              无材料态本来也拉不到历史（refreshAdviseThreads 判 contextId 即返回），所以这
              一挪不删除任何真实可达的功能，只是把不可达的那半也从 DOM 上关掉。 */}
          <LiteRoomHistory />
        </>
      ) : (
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
      )}
    </section>
  )
}
