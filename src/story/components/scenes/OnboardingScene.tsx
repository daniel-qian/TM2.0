import { useState } from 'react'
import { ONBOARDING, PEOPLE, PROJECTS } from '../../data/fixtures'
import { useCanvas } from '../../store/canvasStore'

// P3-03：B0 prologue = click-advance 4 步微流程（答 provenance + 首秀 Capabilities 护城河）。
// 步进是纯 UI → 全在本地 useState，零 store 改动。不 auto-play（节奏交给 rail，动效留 P5）。
// scene 卸载/重挂即重置（AmbientCanvasShell 条件渲染）→ goScene('onboarding') 天然可重入。

interface Stage {
  key: 'files' | 'connect' | 'parse' | 'capabilities' | 'ready'
  title: string
  cta: string
}

const STAGES: Stage[] = [
  { key: 'files', title: 'Reading what you already have', cta: 'Continue' },
  { key: 'connect', title: 'Following the work where it happens', cta: 'Continue' },
  { key: 'parse', title: 'Learning how your team works', cta: 'Continue' },
  { key: 'capabilities', title: 'Picking up the playbooks that fit you', cta: 'Continue' },
  { key: 'ready', title: 'Ready when you are', cta: 'Enter dashboard' },
]

function StageBody({ stageKey }: { stageKey: Stage['key'] }) {
  if (stageKey === 'files') {
    return (
      <div className="onboarding-files">
        {ONBOARDING.sampleFiles.map((file) => (
          <span key={file.name} className="file-chip">
            {file.name}
          </span>
        ))}
      </div>
    )
  }

  if (stageKey === 'connect') {
    // 连接 GitHub/Slack 听取团队动态 → 名字保密/整理/安检三道工序 → 产物只落本地。
    return (
      <>
        <p className="onboarding-status">Catching up on what's happening lately…</p>
        <div className="onboarding-files">
          {ONBOARDING.connectSources.map((source) => (
            <span key={source.name} className="file-chip">
              <span className="file-kind">{source.name}</span>
              {source.detail}
            </span>
          ))}
        </div>
        <div className="onboarding-parsed">
          {ONBOARDING.connectPipeline.map((stepLabel) => (
            <span key={stepLabel} className="parsed-chip">
              {stepLabel}
            </span>
          ))}
        </div>
        <p className="onboarding-local-note">🔒 {ONBOARDING.connectNote}</p>
      </>
    )
  }

  if (stageKey === 'parse') {
    return (
      <>
        <p className="onboarding-status">Getting the picture…</p>
        <div className="onboarding-parsed">
          {ONBOARDING.parsedInto.map((item) => (
            <span key={item} className="parsed-chip">
              {item}
            </span>
          ))}
        </div>
      </>
    )
  }

  if (stageKey === 'capabilities') {
    return (
      <>
        <p className="onboarding-status">Finding the playbooks that fit…</p>
        <div className="onboarding-capabilities">
          {ONBOARDING.capabilitiesMatched.map((capability) => (
            <span key={capability} className="capability-match">
              <span className="match-badge">Loaded for you</span>
              {capability}
            </span>
          ))}
        </div>
      </>
    )
  }

  // ready
  return (
    <>
      <p className="onboarding-status">Taking you in…</p>
      <div className="onboarding-ready-metrics">
        <span>
          <strong>{PEOPLE.length}</strong> people
        </span>
        <span>
          <strong>{PROJECTS.length}</strong> projects
        </span>
        <span>
          <strong>{ONBOARDING.capabilitiesMatched.length}</strong> playbook sets
        </span>
      </div>
    </>
  )
}

function doneSummary(stageKey: Stage['key']): string {
  switch (stageKey) {
    case 'files':
      return `${ONBOARDING.sampleFiles.length} files read`
    case 'connect':
      return `${ONBOARDING.connectSources.map((s) => s.name).join(' & ')} · learned · kept on your machine`
    case 'parse':
      return `Got the picture · ${ONBOARDING.parsedInto.length} areas`
    case 'capabilities':
      return `${ONBOARDING.capabilitiesMatched.length} playbook sets loaded for you`
    default:
      return ''
  }
}

export function OnboardingScene() {
  const goScene = useCanvas((s) => s.goScene)
  const [step, setStep] = useState(0)

  const advance = () => {
    if (step >= STAGES.length - 1) {
      goScene('home') // 第 4 步 → 进入卡片式今日主页（feat-014 / ADR-0017）
      return
    }
    setStep((current) => current + 1)
  }

  return (
    <section className="scene scene-onboarding is-active" aria-label="Onboarding">
      <div className="canvas-grid" aria-hidden="true" />
      <div className="onboarding-card">
        <header className="onboarding-head">
          <p className="eyebrow">Onboarding · prologue</p>
          <h2>Getting to know your team</h2>
          <p>{ONBOARDING.caption}</p>
        </header>

        <div className="onboarding-progress" aria-label={`Step ${step + 1} of ${STAGES.length}`}>
          {STAGES.map((stage, index) => (
            <span
              key={stage.key}
              className={[
                'progress-pip',
                index < step && 'is-done',
                index === step && 'is-active',
              ]
                .filter(Boolean)
                .join(' ')}
            />
          ))}
        </div>

        <ol className="onboarding-stages">
          {STAGES.map((stage, index) => {
            const state = index < step ? 'done' : index === step ? 'active' : 'upcoming'
            return (
              <li key={stage.key} className={`onboarding-stage is-${state}`}>
                <div className="stage-marker" aria-hidden="true">
                  {state === 'done' ? '✓' : state === 'active' ? '◉' : '○'}
                </div>
                <div className="stage-content">
                  <h3>{stage.title}</h3>
                  {state === 'active' ? <StageBody stageKey={stage.key} /> : null}
                  {state === 'done' ? <p className="stage-done">{doneSummary(stage.key)}</p> : null}
                </div>
              </li>
            )
          })}
        </ol>

        <div className="onboarding-actions">
          <button type="button" className="onboarding-continue" onClick={advance}>
            {STAGES[step].cta}
          </button>
        </div>
      </div>
    </section>
  )
}
