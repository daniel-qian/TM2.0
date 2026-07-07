import { useState, type ReactNode } from 'react'
import type { Signal } from '../data/fixtures'
import { useCanvas } from '../store/canvasStore'

// 共享详情壳（P3-01 员工页 / P3-02 项目页复用）。
// 统一：← Back 走 back() action · eyebrow / 标题 / 副标 · section 容器布局。
// ADR-0005：详情页静态恒显——本壳不读 thread、零条件渲染智能层。
export function DetailShell({
  ariaLabel,
  sceneClass,
  eyebrow,
  title,
  subtitle,
  media,
  children,
}: {
  ariaLabel: string
  sceneClass?: string
  eyebrow: string
  title: string
  subtitle?: ReactNode
  media?: ReactNode
  children: ReactNode
}) {
  const back = useCanvas((s) => s.back)
  return (
    <section
      className={['scene scene-detail is-active', sceneClass].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
    >
      <div className="canvas-grid" aria-hidden="true" />
      <div className="detail-scroll">
        <header className="detail-header">
          <button type="button" className="scene-tab detail-back" onClick={back}>
            ← Back
          </button>
          {media ? <div className="detail-hero-media">{media}</div> : null}
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          {subtitle ? <p className="detail-subtitle">{subtitle}</p> : null}
        </header>
        <div className="detail-sections">{children}</div>
      </div>
    </section>
  )
}

// 单个模块：统一标题 + eyebrow；empty 非空时走干净空态（不渲染占位灰条）。
export function DetailSection({
  eyebrow,
  title,
  empty,
  children,
}: {
  eyebrow?: string
  title: string
  empty?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="detail-section">
      <div className="detail-section-head">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h3>{title}</h3>
      </div>
      {empty != null ? <p className="detail-empty">{empty}</p> : children}
    </section>
  )
}

export function SourceAnchor({
  signals,
  label = 'Source',
}: {
  signals: Signal[]
  label?: string
}) {
  const [isOpen, setIsOpen] = useState(false)

  if (signals.length === 0) return null

  return (
    <span className={['source-anchor', isOpen ? 'is-open' : undefined].filter(Boolean).join(' ')}>
      <button
        type="button"
        className="source-anchor-button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((value) => !value)}
      >
        {label}
      </button>
      <span className="source-popover" role="note">
        {signals.map((signal) => (
          <span key={signal.id} className="source-popover-row">
            <strong>{signal.source}</strong>
            <span>
              {signal.summary} <em>{signal.ageDays}d ago</em>
            </span>
          </span>
        ))}
      </span>
    </span>
  )
}
