import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLite } from '../store'
import { useFlow } from '../flowStore'
import { useDict } from '../../shared/i18n/useDict'
import type { Dict } from '../../shared/i18n'
import { LiteAdviceCard } from '../LiteAdviceCard'
import { AskCard } from '../AskCard'
import { LitePanZoom } from '../LitePanZoom'
import type { LiteStreamLine, LiteSpeaker } from '../streamSource'

// feat-024 · lite 屏 3：The room 薄建——ADR-0022 决策 1。
// live SSE 控制台（终端 chrome 与 story 同 CSS，代码独立）+ 8 字段卡。
// 不搬 1400 行剧场 NexusScene：无 rail、无 case 编排、无 world 坐标。
// feat-025 Q3(a)：加一层薄可拖拽/缩放画布（LitePanZoom，lite 自有 wrapper，不碰 story
// PanZoomCanvas）容纳终端 + 8 字段卡；composer 留在画布外恒定可点（门相位 F2 驱动它）。

const SPEAKER_META: Record<LiteSpeaker, { label: string; className: string }> = {
  agent: { label: 'AVERY', className: 'is-agent' },
  tool: { label: 'TOOL', className: 'is-tool' },
  system: { label: '·', className: 'is-system' },
}

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

// live 终端：直接吃 LiteStreamLine[]。等待/滚动全走 DOM，不依赖动画帧（headless rAF 坑）。
function LiteTerminal({ lines, running }: { lines: LiteStreamLine[]; running: boolean }) {
  const logRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [lines.length])

  return (
    <section className="nexus-terminal" aria-label="How it's thinking it through">
      <header className="nexus-terminal-bar" aria-hidden="true">
        <span className="nexus-terminal-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="nexus-terminal-title">thinking it through</span>
      </header>
      <div className="nexus-terminal-log" ref={logRef}>
        {lines.map((line) => {
          const meta = SPEAKER_META[line.speaker]
          const prefix = line.type === 'manifest' ? 'MANIFEST' : meta.label
          const prefixClass = line.type === 'manifest' ? 'is-manifest' : meta.className
          return (
            <p key={line.key} className={classNames(['terminal-line', `is-${line.type}`, 'is-new'])}>
              <span className={classNames(['terminal-prefix', prefixClass])}>{prefix}</span>
              <span className="terminal-text">{line.text}</span>
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
    </section>
  )
}

// live 提问 composer（空态 + 运行后追问共用）。走 store.askLive → feat-015 /advise SSE。
// feat-036：initialValue 承接分诊卡"带进议事室"的预填上下文（flowStore.composerDraft，
// 挂载时读一次——只预填、不自动提交，manager 审过再问）。
function LiteAskComposer({
  placeholder,
  submitLabel,
  onAsk,
  initialValue,
}: {
  placeholder: string
  submitLabel: string
  onAsk: (text: string) => void
  initialValue?: string
}) {
  const [draft, setDraft] = useState(initialValue ?? '')
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    onAsk(text)
    setDraft('')
  }
  return (
    <form className="nexus-followup-composer" aria-label="Ask your team" onSubmit={handleSubmit}>
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        aria-label="Live question"
      />
      <button type="submit">{submitLabel}</button>
    </form>
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

export function RoomScreen() {
  const run = useLite((s) => s.run)
  const ask = useLite((s) => s.ask)
  const askLive = useLite((s) => s.askLive)
  const { t } = useDict()

  // feat-036：分诊"带进议事室"的预填——读一次即消费，之后正常导航不会再带旧草稿回来。
  const composerDraft = useFlow((s) => s.composerDraft)
  const consumeComposerDraft = useFlow((s) => s.consumeComposerDraft)
  useEffect(() => {
    if (composerDraft) consumeComposerDraft()
    // 只在挂载时消费一次——依赖数组特意留空，effect 不该在 composerDraft 变化时重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const running = run.status === 'running'
  const hasStarted = run.status !== 'idle'
  const advice = run.advice

  return (
    <section className="scene scene-nexus is-active lite-room" aria-label="The room">
      {hasStarted ? (
        <>
          {/* 薄画布：终端 + brief HUD + 8 字段卡随 pan/zoom 移动缩放；composer 留画布外 */}
          <LitePanZoom>
            <div className="lite-room-board">
              <LiteTerminal lines={run.lines} running={running} />
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
              {advice ? (
                <div className="lite-room-card">
                  <LiteAdviceCard advice={advice} />
                </div>
              ) : null}
              {/* feat-034：第二种 artifact 卡——agent 起草的 Quick ask（manager 确认后出门） */}
              {ask ? (
                <div className="lite-room-card lite-room-ask">
                  <AskCard />
                </div>
              ) : null}
            </div>
          </LitePanZoom>
          <LiteAskComposer
            placeholder={t.nexus.askPlaceholder}
            submitLabel={t.nexus.ask}
            onAsk={(text) => askLive({ situation: text })}
            initialValue={composerDraft ?? undefined}
          />
        </>
      ) : (
        <section className="nexus-empty" aria-label="Working it through — ask your team">
          <p className="eyebrow">{t.nexus.liveThinking}</p>
          <h2>{t.lite2.roomEmptyTitle}</h2>
          <p>{t.lite2.roomEmptyBody}</p>
          <div className="nexus-empty-composer-wrap">
            <LiteAskComposer
              placeholder={t.nexus.askPlaceholder}
              submitLabel={t.nexus.ask}
              onAsk={(text) => askLive({ situation: text })}
              initialValue={composerDraft ?? undefined}
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
    </section>
  )
}
