import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLite } from '../store'
import { useDict } from '../../shared/i18n/useDict'
import { LiteAdviceCard } from '../LiteAdviceCard'
import { AskCard } from '../AskCard'
import { LitePanZoom } from '../LitePanZoom'
import { localizeStreamLine } from '../../shared/streamCopy'
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
  const { t } = useDict()
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [lines.length])

  return (
    <section className="nexus-terminal" aria-label={t.lite.terminalAria}>
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
              {/* feat-069：**不要**改回 {line.text}——系统行的 text 是空的，句子在字典里
                  （见 src/shared/streamCopy.ts）。后端原文行 code 为空，照旧逐字透传。 */}
              <span className="terminal-text">{localizeStreamLine(line, t.lite)}</span>
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
function LiteAskComposer({
  placeholder,
  submitLabel,
  onAsk,
}: {
  placeholder: string
  submitLabel: string
  onAsk: (text: string) => void
}) {
  const { t } = useDict()
  const [draft, setDraft] = useState('')
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    onAsk(text)
    setDraft('')
  }
  return (
    <form className="nexus-followup-composer" aria-label={t.lite.roomAskAria} onSubmit={handleSubmit}>
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        aria-label={t.lite.roomLiveQuestionAria}
      />
      <button type="submit">{submitLabel}</button>
    </form>
  )
}

export function RoomScreen() {
  const run = useLite((s) => s.run)
  const ask = useLite((s) => s.ask)
  const askLive = useLite((s) => s.askLive)
  const noteJustAdded = useLite((s) => s.noteJustAdded)
  const goScreen = useLite((s) => s.goScreen)
  const { t } = useDict()

  const running = run.status === 'running'
  const hasStarted = run.status !== 'idle'
  const advice = run.advice

  return (
    <section className="scene scene-nexus is-active lite-room" aria-label={t.lite.tabRoom}>
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
                  {/* feat-033：advise 完成且后端确认新笔记落库才出 nudge（丢弃则不出、不显占位）。
                      样式对齐 .lite-metric-chip / .upload-source-chip 视觉族；点击切到 notes tab。 */}
                  {noteJustAdded ? (
                    <button
                      type="button"
                      className="lite-notes-nudge"
                      onClick={() => goScreen('notes')}
                    >
                      {t.lite.notesNudge} →
                    </button>
                  ) : null}
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
          />
        </>
      ) : (
        <section className="nexus-empty" aria-label={t.lite.roomEmptyAria}>
          <p className="eyebrow">{t.nexus.liveThinking}</p>
          <h2>{t.lite.roomEmptyTitle}</h2>
          <p>{t.lite.roomEmptyBody}</p>
          <div className="nexus-empty-composer-wrap">
            <LiteAskComposer
              placeholder={t.nexus.askPlaceholder}
              submitLabel={t.nexus.ask}
              onAsk={(text) => askLive({ situation: text })}
            />
          </div>
        </section>
      )}
    </section>
  )
}
