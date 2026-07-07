import { useLayoutEffect } from 'react'
import { SCRIPT, useRail } from '../store/railStore'

// P6-07：E3 = email staged 拍——Send 不进 SCRIPT（ADR-0006 决策 5），Danny 现场手点，
// 与 B2 / B9 同样标 free-click（"→ your turn"）。
const FREE_CLICK_BEATS = new Set(['B2', 'B9', 'E3'])
const BEAT_SEQUENCE = SCRIPT.reduce<string[]>((beats, step) => {
  if (beats.includes(step.beat)) return beats
  return [...beats, step.beat]
}, [])
const BEAT_TOTAL = BEAT_SEQUENCE.length

function getCaptionParts(index: number) {
  const step = SCRIPT[index]
  const beatIndex = BEAT_SEQUENCE.indexOf(step.beat) + 1
  const stepsInBeat = SCRIPT.filter((candidate) => candidate.beat === step.beat).length
  const stepInBeat = SCRIPT.slice(0, index + 1).filter((candidate) => candidate.beat === step.beat).length

  return {
    label: step.label,
    beatProgress: `${beatIndex} / ${BEAT_TOTAL}`,
    subProgress: stepsInBeat > 1 ? `${stepInBeat}/${stepsInBeat}` : null,
    isFreeClick: FREE_CLICK_BEATS.has(step.beat),
    titleCard: step.titleCard ?? null,
  }
}

export function DemoControls() {
  const index = useRail((s) => s.index)
  const hidden = useRail((s) => s.hidden)
  const capture = useRail((s) => s.capture)
  const caption = getCaptionParts(index)

  useLayoutEffect(() => {
    useRail.getState().seek(0)
  }, [])

  useLayoutEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return

      if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault()
        useRail.getState().next()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        useRail.getState().prev()
      } else if (event.key.toLowerCase() === 'r') {
        useRail.getState().restart()
      } else if (event.key.toLowerCase() === 'h') {
        useRail.getState().toggleHidden()
      } else if (event.key.toLowerCase() === 'c') {
        // feat-006：clean capture mode 的黏性开关（录屏前按一次，全程干净帧）。
        useRail.getState().toggleCapture()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // capture（录屏）= 藏掉全部 rail chrome（进度栏 + title card），键盘驱动仍在
  //（handler 在上面的 effect 里，与渲染无关）；hidden = 旧的快速窥视。
  if (hidden || capture) return null

  return (
    <>
      {/* P6-07 (ADR-0013 决策 9)：case 间隔 title card = rail chrome——由 SCRIPT step
          元数据驱动，渲染在本层、不进 canvasStore；hidden / 删 rail 即无（ADR-0003）。
          key=index：每张卡独立入场动效（只动 transform/opacity，reduced-motion 全局兜底）。 */}
      {caption.titleCard ? (
        <div key={index} className="rail-title-card" role="status">
          <p className="rail-title-card-eyebrow">Use case</p>
          <h2>{caption.titleCard}</h2>
        </div>
      ) : null}
      <aside className="demo-controls rail-controls" aria-label="Demo rail progress">
        <div className="rail-caption" aria-live="polite">
          <strong>{caption.label}</strong>
          <span aria-hidden="true">·</span>
          <small>{caption.beatProgress}</small>
          {caption.subProgress ? (
            <>
              <span aria-hidden="true">·</span>
              <small>{caption.subProgress}</small>
            </>
          ) : null}
          {caption.isFreeClick ? (
            <>
              <span aria-hidden="true">·</span>
              <em>→ your turn · free-click</em>
            </>
          ) : null}
        </div>
      </aside>
    </>
  )
}
