import { useEffect, useRef, type ChangeEvent } from 'react'
import { useLite } from './store'
import {
  ONBOARD_STEPS,
  PLAYBOOK_CATALOG,
  useOnboard,
  type OnboardStep,
} from './onboardStore'
import { useDict } from '../shared/i18n/useDict'

// feat-045 · lite2 onboarding 向导（PRD F7）——覆盖层，非路由。首访 v02 自动弹出
// （onboardStore：unseen/in-progress 且本会话未 ×），可跳过（skipped 永不再弹）、
// 可中途 × 关闭（pause，下次访问从记住的 step 续进度）。
//
// 四步全部真接线（PRD 明令不做假"连接工具"/假"创建账号"步）：
//   ① 上传资料——真调 store.uploadFiles（与 UploadPanel 同一条 ingest 路径；stub 模式
//      即时就绪）；也可直接 Next 跳过。
//   ② 团队信息——公司/部门/称呼，本地配置（onboardStore → localStorage），供问候语用。
//   ③ 选 playbooks——8 项候选默认勾 3；勾选持久化，Playbooks tab 槽位按所选呈现。
//   ④ 完成页——所选摘要 + 进入。
//
// 🔴 红线：向导全程零人卡、零数字读数；文案不承诺没接线的能力（诚实 Coming 语法由
// Playbooks 屏延续）。门相位（nudgeVerdict D 组）按稳定 data-id 断言：
// .lite-onboard[data-onboard-step] / .lite-onboard-playbook[data-playbook-id] /
// .lite-onboard-summary-item[data-playbook-id]。

const ACCEPT = '.pdf,.docx,.doc,.xlsx,.xls,.csv,.md,.markdown,.txt'

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

export function OnboardWizard() {
  const { t } = useDict()
  const l = t.lite2

  const step = useOnboard((s) => s.step)
  const status = useOnboard((s) => s.status)
  const begin = useOnboard((s) => s.begin)
  const goStep = useOnboard((s) => s.goStep)
  const pause = useOnboard((s) => s.pause)
  const skip = useOnboard((s) => s.skip)
  const finish = useOnboard((s) => s.finish)

  // 首访：挂载即把 unseen 落成 in-progress（持久化）——从此刻起进度可续。
  useEffect(() => {
    if (status === 'unseen') begin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stepIndex = ONBOARD_STEPS.indexOf(step)
  const goNext = () => {
    const next = ONBOARD_STEPS[stepIndex + 1]
    if (next) goStep(next)
  }
  const goBack = () => {
    const prev = ONBOARD_STEPS[stepIndex - 1]
    if (prev) goStep(prev)
  }

  return (
    <div className="lite-onboard-backdrop">
      <section
        className="lite-onboard"
        data-onboard-step={step}
        role="dialog"
        aria-modal="true"
        aria-label={l.onboardEyebrow}
      >
        <header className="lite-onboard-head">
          <p className="eyebrow lite-onboard-eyebrow">{l.onboardEyebrow}</p>
          <div className="lite-onboard-dots" aria-label={l.onboardStepsAria}>
            {ONBOARD_STEPS.map((s) => (
              <span
                key={s}
                className={`lite-onboard-dot${s === step ? ' is-active' : ''}`}
                aria-hidden="true"
              />
            ))}
          </div>
          <button
            type="button"
            className="lite-onboard-close"
            aria-label={l.onboardCloseAria}
            title={l.onboardCloseAria}
            onClick={pause}
          >
            ×
          </button>
        </header>

        <div className="lite-onboard-body">
          {step === 'upload' ? (
            <StepUpload />
          ) : step === 'team' ? (
            <StepTeam />
          ) : step === 'playbooks' ? (
            <StepPlaybooks />
          ) : (
            <StepDone />
          )}
        </div>

        <footer className="lite-onboard-nav">
          {step !== 'done' ? (
            <button type="button" className="lite-onboard-skip" onClick={skip}>
              {l.onboardSkip}
            </button>
          ) : (
            <span />
          )}
          <div className="lite-onboard-nav-main">
            {stepIndex > 0 ? (
              <button type="button" className="lite-onboard-back" onClick={goBack}>
                {l.onboardBack}
              </button>
            ) : null}
            {step !== 'done' ? (
              <button type="button" className="lite-onboard-next" onClick={goNext}>
                {l.onboardNext}
              </button>
            ) : (
              <button type="button" className="lite-onboard-finish" onClick={finish}>
                {l.onboardFinish}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  )
}

// ── ① 上传资料——真调 store.uploadFiles（与 Your team 的 UploadPanel 同一条路径）。──
function StepUpload() {
  const { t } = useDict()
  const l = t.lite2
  const uploadFiles = useLite((s) => s.uploadFiles)
  const ingestStatus = useLite((s) => s.ingestStatus)
  const ingestError = useLite((s) => s.ingestError)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length > 0) void uploadFiles(files)
    event.target.value = ''
  }

  return (
    <div className="lite-onboard-step">
      <h2>{l.onboardUploadTitle}</h2>
      <p className="lite-onboard-step-body">{l.onboardUploadBody}</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="lite-onboard-upload-input"
        onChange={onPick}
        aria-hidden="true"
        tabIndex={-1}
      />
      <button
        type="button"
        className="lite-onboard-upload-choose"
        onClick={() => inputRef.current?.click()}
      >
        {l.onboardUploadChoose}
      </button>
      <div className="lite-onboard-upload-status" aria-live="polite">
        {ingestStatus === 'ingesting' ? (
          <p className="lite-onboard-upload-reading">{l.onboardUploadReading}</p>
        ) : ingestStatus === 'ready' ? (
          <p className="lite-onboard-upload-ready">{l.onboardUploadReady}</p>
        ) : ingestStatus === 'error' ? (
          <p className="lite-onboard-upload-error">
            {l.onboardUploadError}
            {ingestError ? <span className="lite-onboard-upload-error-detail"> {ingestError}</span> : null}
          </p>
        ) : (
          <p className="lite-onboard-upload-idle">{l.onboardUploadIdle}</p>
        )}
      </div>
    </div>
  )
}

// ── ② 团队信息——本地配置（供问候语用；只存本机）。──────────────────────────────
function StepTeam() {
  const { t } = useDict()
  const l = t.lite2
  const company = useOnboard((s) => s.company)
  const dept = useOnboard((s) => s.dept)
  const yourName = useOnboard((s) => s.yourName)
  const setField = useOnboard((s) => s.setField)

  return (
    <div className="lite-onboard-step">
      <h2>{l.onboardTeamTitle}</h2>
      <p className="lite-onboard-step-body">{l.onboardTeamBody}</p>
      <div className="lite-onboard-fields">
        <label className="lite-onboard-field">
          <span>{l.onboardCompanyLabel}</span>
          <input
            type="text"
            className="lite-onboard-company"
            value={company}
            placeholder={l.onboardCompanyPlaceholder}
            onChange={(e) => setField('company', e.target.value)}
          />
        </label>
        <label className="lite-onboard-field">
          <span>{l.onboardDeptLabel}</span>
          <input
            type="text"
            className="lite-onboard-dept"
            value={dept}
            placeholder={l.onboardDeptPlaceholder}
            onChange={(e) => setField('dept', e.target.value)}
          />
        </label>
        <label className="lite-onboard-field">
          <span>{l.onboardNameLabel}</span>
          <input
            type="text"
            className="lite-onboard-name"
            value={yourName}
            placeholder={l.onboardNamePlaceholder}
            onChange={(e) => setField('yourName', e.target.value)}
          />
        </label>
      </div>
    </div>
  )
}

// ── ③ 选 playbooks——8 项候选，默认勾 3；勾选真写 onboardStore（持久化）。────────
function StepPlaybooks() {
  const { t } = useDict()
  const l = t.lite2
  const playbooks = useOnboard((s) => s.playbooks)
  const togglePlaybook = useOnboard((s) => s.togglePlaybook)

  return (
    <div className="lite-onboard-step">
      <h2>{l.onboardPlaybooksTitle}</h2>
      <p className="lite-onboard-step-body">{l.onboardPlaybooksBody}</p>
      <div className="lite-onboard-playbook-grid">
        {PLAYBOOK_CATALOG.map((entry) => {
          const on = playbooks.includes(entry.id)
          return (
            <button
              key={entry.id}
              type="button"
              className={`lite-onboard-playbook${on ? ' is-on' : ''}`}
              data-playbook-id={entry.id}
              aria-pressed={on}
              onClick={() => togglePlaybook(entry.id)}
            >
              <span className="lite-onboard-playbook-title">{entry.title(l)}</span>
              <span className="lite-onboard-playbook-body">{entry.body(l)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── ④ 完成页——问候 + 所选摘要 + 进入。──────────────────────────────────────────
function StepDone() {
  const { t } = useDict()
  const l = t.lite2
  const yourName = useOnboard((s) => s.yourName)
  const playbooks = useOnboard((s) => s.playbooks)
  const chosen = PLAYBOOK_CATALOG.filter((entry) => playbooks.includes(entry.id))

  return (
    <div className="lite-onboard-step">
      <h2>{l.onboardDoneTitle}</h2>
      <p className="lite-onboard-step-body lite-onboard-greeting">
        {yourName.trim()
          ? fill(l.onboardDoneGreeting, { name: yourName.trim() })
          : l.onboardDoneGreetingNoName}
      </p>
      {chosen.length > 0 ? (
        <div className="lite-onboard-summary">
          <p className="eyebrow lite-onboard-summary-lead">{l.onboardDoneSummaryLead}</p>
          <ul className="lite-onboard-summary-list">
            {chosen.map((entry) => (
              <li
                key={entry.id}
                className="lite-onboard-summary-item"
                data-playbook-id={entry.id}
              >
                {entry.title(l)}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="lite-onboard-summary-none">{l.onboardDoneNoPicks}</p>
      )}
    </div>
  )
}
