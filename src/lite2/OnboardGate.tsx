import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { loadStoredContextId, useLite } from './store'
import { IntakeTables } from './intake/IntakeTables'
import { useIntake } from './intake/intakeStore'
import { blockingIssues, countRows, pruneTables, validateTables } from './intake/validate'
import { StructuredRedlineError, type StructuredCellViolation } from './transport'
import {
  FRAMEWORK_CATALOG,
  TOOL_CATALOG,
  WIZARD_STEPS,
  selectWizardOpen,
  useOnboard,
  visibleSteps,
  type OnboardStep,
} from './onboardStore'
import { useDemo } from './demoStore'
import { useAuth } from './auth/authStore'
import { authConfigured } from './auth/supabaseClient'
import { paperworkHref } from './routes'
import { flushCompanyNote, wireCompanyNoteFlush } from './onboardNote'
import { useDict } from '../shared/i18n/useDict'
import { clearIngestStart, useIngestElapsedSeconds } from '../shared/ingestClock'
import { LiteModal } from './LiteModal'

// input-side-0721（Danny 拍板）· onboarding 从浮层对话框改成**全屏闸门页**——对齐合伙人
// command-room 版藏在 /companyinput 的独立 onboarding 页。新访客先过这道门再进指挥室；
// 有数据的回头客照旧永不见门（hadContextOnLoad 判定原样）。
//
// 形态变了，**底座没换**：仍站在 LiteModal 上（Escape=pause、body 滚动锁、焦点圈、层栈）。
// 点背景关闭**关掉**（closeOnBackdrop=false）：整页世界里"背景"是页面本身，误触不该关门；
// 键盘退路归 Escape，可见退路归右上「先自己逛逛」（同一个 pause 语义）。
//
// ── onboarding-accounts-0805 ③（ADR-0034 拍板 7/8/9/10）：五步向导 ─────────────────────
//   ⓪ 三扇门（**保留**，拍板 7）——示例团队是唯一零成本尝鲜路径，砍掉等于让所有访客直面
//      五步向导。第三扇「先看看每一步」进的是预览模式。
//   ① 录入标准数据包——7 张表 + 文件上传并存，一发提交 = 一个 context（票 #41 接手表格侧）。
//   ② 连接日常工作工具——六张卡，点选**只登记意向**，同屏明说「暂未开通连接」（拍板 9）。
//   ③ 确认管理范围——公司/部门/人数/称呼/岗位；「公司现状」口述仍**会送后端**（8A 机制不动）。
//   ④ 选择管理偏好——合伙人的 5 个管理框架，只存本地、界面如实标注（拍板 9）。
//   ⑤ 创建管理者账号——可跳过（游客路径是硬性产品要求）；未配置 Supabase 时整步隐去。
//   ⑥ 完成页——所选摘要 + 进入。
//
// 🔴 红线的措辞随事实更新了，约束没松：以前这里写「不做假『连接工具』/假『创建账号』步」。
// 现在两步都真的做了，但②只登记意向、不造连接态，⑤接的是真 Supabase。红线从来不是
// 「不许有这一步」，而是「屏幕上不许出现假的状态」。全程仍是零人卡、零人身数字读数。
//
// 门相位按稳定 data-id 断言，本轮的清单（新门写判据照这个抄，别照行号）：
//   .lite-onboard[data-onboard-step] · [data-onboard-preview]
//   .lite-gate-door[data-gate-door="demo|upload|preview"]
//   .lite-onboard-chip[data-step-id][data-chip-state="done|current|todo"]
//   .lite-onboard-tool[data-tool-id] · .lite-onboard-framework[data-framework-id]
//   .lite-gate-preview-banner（预览横幅）· .lite-gate-preview-exit（退出预览）

// 0721 对齐棒：与 UploadPanel.tsx 的 ACCEPT 保持一字不差——「多列一种格式是撒谎」。
const ACCEPT = '.pdf,.docx,.xlsx,.csv,.tsv,.md,.markdown,.txt'

// 07-20 · 返回客户判定（Danny 拍板「已经有数据就不弹」）——模块顶层只读一次 localStorage
// 的 contextId 锚点，不做响应式订阅。这个常量在模块求值时就已经定死，所以 `open` 从第一帧
// 起就把它算进去了。若改成响应式读 useLite 的 contextId，向导自己①录入步一成功、contextId
// 落地，会在全新用户正走②③④步时被这条新规则回头把向导关掉（详见 onboardStore.ts
// selectWizardOpen 上的调用方契约注释）。
const hadContextOnLoad = loadStoredContextId() !== null

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

/** 这份部署到底有没有账号能力 —— 与 AuthPanel 的**双闸**判据逐字同源（票 #43）。
 *
 * 两道闸缺一不可：`authConfigured()` 说的是"前端配了 Supabase key 没有"，
 * `accountCapability === 'supported'` 说的是"这份后端到底挂没挂账号路由"。07-20 生产实测
 * 过 key 配了但 `/account/status` 404 的组合——只看第一道，用户会走到一个能填、能注册进
 * Supabase、然后处处 404 的步骤。不确定就不出这一步（'unknown' 与 'unsupported' 同处理）。 */
function useAccountStepAvailable(): boolean {
  const capability = useAuth((s) => s.accountCapability)
  return authConfigured() && capability === 'supported'
}

export function OnboardGate() {
  const { t } = useDict()
  const l = t.lite2

  const step = useOnboard((s) => s.step)
  const status = useOnboard((s) => s.status)
  const preview = useOnboard((s) => s.preview)
  // 向导是否该露面。open-loop-0720：`forceOpen` 单独 `||` 进来，不改 selectWizardOpen 本身
  // ——那个函数的契约只管"要不要自动弹"，手动重看/预览是另一件事。
  const open = useOnboard((s) => s.forceOpen || selectWizardOpen(s, hadContextOnLoad))
  const begin = useOnboard((s) => s.begin)
  const goStep = useOnboard((s) => s.goStep)
  const pause = useOnboard((s) => s.pause)
  const skip = useOnboard((s) => s.skip)
  const finish = useOnboard((s) => s.finish)
  const exitPreview = useOnboard((s) => s.exitPreview)
  const initAuth = useAuth((s) => s.init)

  const accountAvailable = useAccountStepAvailable()
  const steps = visibleSteps(accountAvailable)

  // 首访：挂载即把 unseen 落成 in-progress（持久化）——从此刻起进度可续。
  useEffect(() => {
    if (status === 'unseen') begin()
    // input-side-0721 · 8A：接上「公司现状」的延迟送出线（contextId 每落一个新值送一次）。
    wireCompanyNoteFlush()
    // 账号能力探测：AuthPanel 也会 init()（模块级 guard 幂等），但闸门可能先它一步需要
    // 答案——第⑤步出不出场就是这个探测的结果，等不到就少一步。
    initAuth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 站在一个**已经不存在**的步骤上（探测回来说这份部署没有账号能力，而用户恰好停在第⑤步、
  // 或旧持久状态指着它）→ 落到完成页。不这么做的话，body 会渲染一个 chips 上没有的幽灵步，
  // 而 Back/Next 的下标算在一条不含它的序上，按钮会跳得莫名其妙。
  useEffect(() => {
    if (!steps.includes(step)) goStep('done')
  }, [steps, step, goStep])

  const stepIndex = Math.max(0, steps.indexOf(step))
  const goNext = () => {
    const next = steps[stepIndex + 1]
    if (next) goStep(next)
  }
  const goBack = () => {
    const prev = steps[stepIndex - 1]
    if (prev) goStep(prev)
  }

  // 完成 = 关门 + 立刻尝试送出「公司现状」（此刻若已有 context——录入成功/示例领取——订阅
  // 线不会再触发，得在这里补一脚；没有 context 则由订阅线在未来落地时送）。
  // 预览态里 finish() 只是退出预览，flushCompanyNote 自己也认预览态（双保险，见彼处注释）。
  const onFinish = () => {
    finish()
    void flushCompanyNote()
  }

  return (
    <LiteModal
      open={open}
      onClose={pause}
      ariaLabel={l.onboardEyebrow}
      backdropLabel={l.onboardCloseAria}
      layerClassName="lite-gate-layer"
      panelClassName="lite-onboard lite-gate"
      panelData={{ 'data-onboard-step': step, 'data-onboard-preview': preview ? 'on' : 'off' }}
      closeOnBackdrop={false}
    >
      <header className="lite-onboard-head">
        <p className="eyebrow lite-onboard-eyebrow">
          {l.onboardEyebrow}
          {step !== 'doors' && step !== 'done' ? (
            <span className="lite-gate-step-count">
              {' · '}
              {fill(l.onboardStepOf, {
                n: stepIndex,
                total: steps.length - 2, // doors 与 done 不是编号步
              })}
            </span>
          ) : null}
        </p>
        {/* 静态稿的头部 badge。它是一句**产品立场**：Avery 只吃结构化的管理信息，不吃
            截图、聊天记录、自由格式文档——与 xlsx 说明页第一段逐字同一个口径。 */}
        {/* 内层 span 不是多余的：截断三件套必须落在**非 flex 容器**上才生效，
            而 aurora 皮把 .lite-badge 做成了 inline-flex 的 pill（见 lite2.css 该处注释）。 */}
        <span className="lite-badge lite-gate-badge">
          <span className="lite-gate-badge-text">{l.onboardStructuredBadge}</span>
        </span>
        {/* 整页闸门没有 ×（它不是可随手拍掉的弹窗）；可见退路是这句诚实的话——pause 语义
            与 Escape 完全一致：进度保留、下次续跑。
            预览态下**藏起来**（checker 逮到）：那时横幅右侧已经有「退出页面预览」，两个措辞
            相近的出口上下贴着 40px，用户得先分辨哪个是"离开预览"哪个是"离开向导"。预览的
            出口只留一个，语义就不必分辨了。 */}
        {!preview ? (
          <button
            type="button"
            className="lite-btn lite-btn--ghost lite-gate-browse"
            title={l.onboardCloseAria}
            onClick={pause}
          >
            {l.onboardBrowse} →
          </button>
        ) : (
          // 🔴 占位不是补丁，是保持三段式头部的**列结构**（checker 第二轮逮到两条，同一个根因）：
          // 直接把按钮摘掉之后，居中的 badge 是"居剩余空间的中"而不是居卡片中轴——它会向右
          // 漂 113px；同时那颗按钮本来在撑行高，一走头部矮 7px，进/出预览时整块内容跳一下。
          // 一个 aria-hidden 的空位把两件事一起按住，比给 badge 算绝对定位便宜也稳。
          <span className="lite-gate-head-spacer" aria-hidden="true" />
        )}
      </header>

      {/* ── 预览模式横幅（ADR-0034 拍板 8）。常驻、不可关——它是这个模式的**唯一**可见证据，
          可关的话用户会在一个自己以为在填真表的界面里输入半小时。 */}
      {preview ? (
        <div className="lite-gate-preview-banner" role="status">
          <span className="lite-gate-preview-text">{l.onboardPreviewBanner}</span>
          <button
            type="button"
            className="lite-btn lite-btn--ghost lite-gate-preview-exit"
            onClick={exitPreview}
          >
            {l.onboardPreviewExit}
          </button>
        </div>
      ) : null}

      <div className="lite-onboard-body">
        {step === 'doors' ? (
          <StepDoors />
        ) : step === 'intake' ? (
          <StepIntake />
        ) : step === 'tools' ? (
          <StepTools />
        ) : step === 'scope' ? (
          <StepScope />
        ) : step === 'prefs' ? (
          <StepPrefs />
        ) : step === 'account' ? (
          <StepAccount />
        ) : (
          <StepDone accountAvailable={accountAvailable} />
        )}
      </div>

      {/* ── 底部步骤 chips（静态稿）：已完成绿勾 / 当前高亮 / 未到灰 ────────────────────── */}
      {step !== 'doors' ? (
        <StepChips
          steps={steps}
          current={step}
          currentIndex={stepIndex}
          interactive={preview}
          onPick={goStep}
        />
      ) : null}

      <footer className="lite-onboard-nav">
        {step !== 'done' ? (
          <button type="button" className="lite-btn lite-btn--ghost lite-onboard-skip" onClick={skip}>
            {preview ? l.onboardPreviewExit : l.onboardSkip}
          </button>
        ) : (
          <span />
        )}
        {/* 三扇门自己就是导航——Back/Next 只在真步进里出现。 */}
        {step !== 'doors' ? (
          <div className="lite-onboard-nav-main">
            {stepIndex > 0 ? (
              <button type="button" className="lite-btn lite-btn--ghost lite-onboard-back" onClick={goBack}>
                {l.onboardBack}
              </button>
            ) : null}
            {step !== 'done' ? (
              // 末一个编号步上不能还叫「下一步」：抬头写着「第 5 步，共 5 步」，脚下却说
              // 「下一步」，读起来像还有第 6 步（checker 逮到）。后面那一屏是总结页，不是
              // 第 6 步，所以按钮如实说它是什么。
              <button type="button" className="lite-btn lite-btn--primary lite-onboard-next" onClick={goNext}>
                {steps[stepIndex + 1] === 'done' ? l.onboardSeeSummary : l.onboardNext}
              </button>
            ) : (
              <button type="button" className="lite-btn lite-btn--primary lite-onboard-finish" onClick={onFinish}>
                {preview ? l.onboardPreviewExit : l.onboardFinish}
              </button>
            )}
          </div>
        ) : null}
      </footer>
    </LiteModal>
  )
}

// ── 底部步骤 chips ────────────────────────────────────────────────────────────────────────
// 🔴 显示值与判据值分开（ownerNameRaw 模式的旧账）：状态走 `data-chip-state`，绿勾只是它的
// 视觉表现。门断言 data-chip-state，不去数勾号——文字/图标改一次判据就瞎了。
//
// interactive 只在**预览模式**下为真。这不是抠门：横幅答应的是「可以直接查看全部步骤」，
// 自由步进是那句话的兑现物；正常填表时 chips 是进度指示，跳步的退路是 Back/Next。
// 两种模式下的可点性不同，本身就是"我现在在哪个模式"的第二个可见证据。
function StepChips({
  steps, current, currentIndex, interactive, onPick,
}: {
  steps: OnboardStep[]
  current: OnboardStep
  currentIndex: number
  interactive: boolean
  onPick: (step: OnboardStep) => void
}) {
  const { t } = useDict()
  const l = t.lite2
  const labels: Record<string, string> = {
    intake: l.onboardChipIntake,
    tools: l.onboardChipTools,
    scope: l.onboardChipScope,
    prefs: l.onboardChipPrefs,
    account: l.onboardChipAccount,
  }
  const numbered = steps.filter((s) => (WIZARD_STEPS as string[]).includes(s))

  return (
    <nav className="lite-onboard-chips" aria-label={l.onboardStepsAria}>
      {numbered.map((s, i) => {
        const index = steps.indexOf(s)
        const state = s === current ? 'current' : index < currentIndex ? 'done' : 'todo'
        const label = `${i + 1}. ${labels[s] ?? s}`
        const shared = {
          className: `lite-onboard-chip is-${state}`,
          'data-step-id': s,
          'data-chip-state': state,
        }
        return interactive ? (
          <button
            key={s}
            type="button"
            {...shared}
            aria-current={state === 'current' ? 'step' : undefined}
            onClick={() => onPick(s)}
          >
            <span className="lite-onboard-chip-mark" aria-hidden="true" />
            {label}
          </button>
        ) : (
          <span key={s} {...shared} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="lite-onboard-chip-mark" aria-hidden="true" />
            {label}
          </span>
        )
      })}
    </nav>
  )
}

// ── ⓪ 三扇门——闸门页第一眼（input-side-0721 + 拍板 7/8）。──────────────────────────
function StepDoors() {
  const { t } = useDict()
  const l = t.lite2
  const availability = useDemo((s) => s.availability)
  const probe = useDemo((s) => s.probe)
  const claiming = useLite((s) => s.demoClaiming)
  const claimError = useLite((s) => s.demoClaimError)
  const claimDemoTeam = useLite((s) => s.claimDemoTeam)
  const goStep = useOnboard((s) => s.goStep)
  const finish = useOnboard((s) => s.finish)
  const enterPreview = useOnboard((s) => s.enterPreview)

  // 能力探测在这一步第一次渲染时打（进程内缓存，重复挂载不重复打）。
  useEffect(() => {
    probe()
  }, [probe])

  const onDemo = async () => {
    await claimDemoTeam()
    const s = useLite.getState()
    // 领到了才算过门（诚实：失败就留在门口把错误亮出来，绝不假装完成）。
    if (s.contextId && !s.demoClaimError) {
      finish()
      void flushCompanyNote()
      s.goScreen('home')
    }
  }

  return (
    <div className="lite-onboard-step lite-gate-doors" data-gate-doors="">
      <h2>{l.onboardDoorsTitle}</h2>
      {/* ui-sweep-0802：正文与门数联动——示例团队门被能力闸藏起时（探测失败/离线），还念
          「两条路」就是向首访用户许诺一个屏上不存在的选项。 */}
      <p className="lite-onboard-step-body">
        {availability === 'yes' ? l.onboardDoorsBody : l.onboardDoorsBodySolo}
      </p>
      <div className="lite-gate-door-grid">
        {/* 🔴 示例团队门只在后端真有 demo 时出现（demoStore 能力探测）——不出假按钮。 */}
        {availability === 'yes' ? (
          <button
            type="button"
            className="lite-gate-door lite-gate-door-demo"
            data-gate-door="demo"
            disabled={claiming}
            aria-busy={claiming}
            onClick={() => void onDemo()}
          >
            <span className="lite-gate-door-title">{l.onboardDoorDemoTitle}</span>
            <span className="lite-gate-door-body">
              {claiming ? l.onboardDoorDemoBusy : l.onboardDoorDemoBody}
            </span>
          </button>
        ) : null}
        <button
          type="button"
          className="lite-gate-door lite-gate-door-upload"
          data-gate-door="upload"
          onClick={() => goStep('intake')}
        >
          <span className="lite-gate-door-title">{l.onboardDoorUploadTitle}</span>
          <span className="lite-gate-door-body">{l.onboardDoorUploadBody}</span>
        </button>
        {/* 拍板 8 的入口：先看看每一步。这扇门永远在——它不依赖任何后端能力，也正因如此
            它是"探测全挂了"时仍然存在的那条路。 */}
        <button
          type="button"
          className="lite-gate-door lite-gate-door-preview"
          data-gate-door="preview"
          onClick={() => enterPreview()}
        >
          <span className="lite-gate-door-title">{l.onboardDoorPreviewTitle}</span>
          <span className="lite-gate-door-body">{l.onboardDoorPreviewBody}</span>
        </button>
      </div>
      {claimError ? (
        <p className="lite-gate-door-error" role="alert">
          {l.onboardDoorDemoErrorLead} {claimError}
        </p>
      ) : null}
    </div>
  )
}

// ── ① 录入标准数据包（ADR-0034 拍板 1/2/3/4）────────────────────────────────────────────
// 表格与文件**并存**，提交时打包成一发 multipart 打 POST /ingest/structured —— 一次提交 =
// 一个 context（拍板 3）。不做两个割裂工作区，也不碰 append 难题（后端传旧 context_id 是
// 重建并覆盖，会就地毁掉第一份数据——store.switchContext 上面记着这条）。
function StepIntake() {
  const { t } = useDict()
  const l = t.lite2
  const preview = useOnboard((s) => s.preview)
  const submitIntake = useLite((s) => s.submitIntake)
  const ingestStatus = useLite((s) => s.ingestStatus)
  const ingestError = useLite((s) => s.ingestError)
  const rawTeam = useLite((s) => s.rawTeam)
  const rows = useIntake((s) => s.rows)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // 选中的文件留在本步的 state 里，等提交时与表格行一起发出去——这是"合一发"的实现处。
  // 选完就发（旧行为）会各自建一个 context，正是拍板 3 否决的形状。
  const [files, setFiles] = useState<File[]>([])
  const [serverCells, setServerCells] = useState<StructuredCellViolation[]>([])

  const issues = useMemo(() => validateTables(rows), [rows])
  const blocking = blockingIssues(issues)
  const rowCount = countRows(rows)
  const busy = ingestStatus === 'ingesting'
  const elapsed = useIngestElapsedSeconds(busy)
  // 等待态分两种（票 #41）：纯表格提交是秒级的，不该出那句「通常两三分钟」的秒表——
  // 它会把一次一秒钟的操作说成两分钟，用户等到第三秒就开始怀疑是不是卡了。
  const willBeSlow = files.length > 0

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    setFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const canSubmit = !preview && !busy && blocking.length === 0 && (rowCount > 0 || files.length > 0)

  const onSubmit = async () => {
    if (!canSubmit) return
    setServerCells([])
    // feat-068 · 发车前先松锚，保证这一发从 0 起算。
    clearIngestStart()
    try {
      await submitIntake(pruneTables(rows), files)
    } catch (err) {
      // 红线整发拒：把格坐标交给网格去标红（票 #41 的「422 violations 映射回具体表/行/格」）。
      // 其余错误已由 store 落进 ingestError，这里不再重复展示。
      if (err instanceof StructuredRedlineError) setServerCells(err.cells)
    }
  }

  const warnings = rawTeam?.intake_warnings ?? []

  return (
    <div className="lite-onboard-step lite-onboard-step--intake">
      <h2>{l.onboardIntakeTitle}</h2>
      <p className="lite-onboard-step-body">{l.onboardIntakeBody}</p>

      <IntakeTables serverCells={serverCells} readOnly={preview} />

      {/* ── 文件侧：与表格并存，同一发提交 ─────────────────────────────────────────── */}
      <div className="lite-intake-files">
        <p className="lite-intake-files-lead">{l.intakeFilesLead}</p>
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
          className="lite-btn lite-btn--ghost lite-onboard-upload-choose"
          disabled={busy || preview}
          onClick={() => { if (!busy && !preview) inputRef.current?.click() }}
        >
          {l.onboardUploadChoose}
        </button>
        {files.length > 0 ? (
          <ul className="lite-intake-file-list">
            {files.map((f) => (
              <li key={f.name} className="lite-intake-file">{f.name}</li>
            ))}
          </ul>
        ) : null}
        {/* partner-docs-0728 · 首访者第一次面对「传什么」就在这一步，这条链接最该在这儿。
            🔴 用裸 <a target="_blank"> 而不是 <Link>：闸门是覆盖全屏的 modal，站内导航只会把
            /paperwork 渲染在**它底下**——用户以为自己离开了向导，实际什么都没发生。 */}
        <p className="lite-onboard-upload-forms">
          <a href={paperworkHref()} target="_blank" rel="noopener noreferrer">
            {l.onboardUploadFormsLink}
          </a>
        </p>
      </div>

      {/* ── 提交 + 等待态 ─────────────────────────────────────────────────────────── */}
      <div className="lite-intake-submit-bar">
        <button
          type="button"
          className="lite-btn lite-btn--primary lite-intake-submit"
          disabled={!canSubmit}
          aria-busy={busy}
          onClick={() => void onSubmit()}
        >
          {fill(l.intakeSubmit, { rows: rowCount, files: files.length })}
        </button>
        {blocking.length > 0 ? (
          <p className="lite-intake-blocked" role="status" data-blocking={blocking.length}>
            {fill(l.intakeBlocked, { n: blocking.length })}
          </p>
        ) : null}
      </div>

      <div className="lite-onboard-upload-status" aria-live="polite">
        {preview ? (
          <p className="lite-onboard-upload-idle">{l.onboardPreviewStepNote}</p>
        ) : busy ? (
          <div className="lite-onboard-upload-waiting">
            <p className="lite-onboard-upload-reading">
              <span className="lite-onboard-upload-dot" aria-hidden="true" />
              {willBeSlow ? l.onboardUploadReading : l.intakeSubmitting}
            </p>
            {/* feat-068 的秒表只在**真的会慢**的时候出。🔴 整块 aria-hidden：外层是
                aria-live="polite"，每秒变一次的数字若进无障碍树，读屏会被刷屏两分钟；
                "在忙"这件事由按钮的 aria-busy 表达即可。 */}
            {willBeSlow ? (
              <>
                <p className="lite-onboard-upload-hint">{l.onboardUploadHint}</p>
                <p className="lite-onboard-upload-elapsed" aria-hidden="true">
                  {fill(l.onboardUploadElapsed, { seconds: elapsed })}
                </p>
              </>
            ) : null}
            <div className="lite-onboard-upload-bar" aria-hidden="true">
              <span />
            </div>
          </div>
        ) : ingestStatus === 'ready' ? (
          <p className="lite-onboard-upload-ready">{l.onboardUploadReady}</p>
        ) : ingestStatus === 'error' ? (
          <p className="lite-onboard-upload-error">
            {serverCells.length > 0 ? l.intakeRedlineRejected : l.onboardUploadError}
            {ingestError && serverCells.length === 0 ? (
              <span className="lite-onboard-upload-error-detail"> {ingestError}</span>
            ) : null}
          </p>
        ) : (
          <p className="lite-onboard-upload-idle">{l.onboardUploadIdle}</p>
        )}
        {/* 后端映射时记下的黄色提醒（悬空引用 / 读不懂的值 / 重复 ID）。**不拒**这一发，
            但用户有权知道哪几格没能长成卡片——静默丢一列数据是这条线上最不该犯的错。 */}
        {warnings.length > 0 ? (
          <ul className="lite-intake-warnings" data-warning-count={warnings.length}>
            {warnings.map((w, i) => (
              <li key={i} className="lite-intake-warning" data-kind={w.kind}>
                {fill(l.intakeWarningAt, { table: w.table, row: w.row, column: w.column })}
                {w.detail}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

// ── ② 连接日常工作工具（拍板 9：纯登记意向，诚实说明）────────────────────────────────
function StepTools() {
  const { t } = useDict()
  const l = t.lite2
  const tools = useOnboard((s) => s.tools)
  const toggleTool = useOnboard((s) => s.toggleTool)

  return (
    <div className="lite-onboard-step">
      <h2>{l.onboardToolsTitle}</h2>
      <p className="lite-onboard-step-body">{l.onboardToolsBody}</p>
      {/* 🔴 这句话与卡片同屏、同等字号级别，不是脚注。它是这一步唯一能让它诚实的东西：
          点亮一张卡什么都没连上，屏幕必须当场说清楚。 */}
      <p className="lite-onboard-honesty" data-honesty="tools">
        {l.onboardToolsHonesty}
      </p>
      <div className="lite-onboard-choice-grid">
        {TOOL_CATALOG.map((entry) => {
          const on = tools.includes(entry.id)
          return (
            <button
              key={entry.id}
              type="button"
              className={`lite-onboard-choice lite-onboard-tool${on ? ' is-on' : ''}`}
              data-tool-id={entry.id}
              aria-pressed={on}
              onClick={() => toggleTool(entry.id)}
            >
              <span className="lite-onboard-choice-title">{entry.title(l)}</span>
              <span className="lite-onboard-choice-body">{entry.body(l)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── ③ 确认管理范围——问候字段只存本机；8A「公司现状」口述会送后端（诚实分界逐字段标明）。──
function StepScope() {
  const { t } = useDict()
  const l = t.lite2
  const company = useOnboard((s) => s.company)
  const dept = useOnboard((s) => s.dept)
  const yourName = useOnboard((s) => s.yourName)
  const teamCount = useOnboard((s) => s.teamCount)
  const yourRole = useOnboard((s) => s.yourRole)
  const companyNote = useOnboard((s) => s.companyNote)
  const setField = useOnboard((s) => s.setField)
  const preview = useOnboard((s) => s.preview)
  // 「公司现状」的去向提示按真实状态二选一：已有工作区 → 「会存进你团队的笔记」；
  // 还没有 → 「等你的材料就位后一起交给 Avery」。两句都是真话，没有第三句。
  // 预览态是第三种真话：这一格哪儿也不会去。
  const hasContext = useLite((s) => s.contextId !== null)
  const noteHint = preview
    ? l.onboardPreviewFieldNote
    : hasContext
      ? l.onboardCompanyNoteHint
      : l.onboardCompanyNoteHintLater

  return (
    <div className="lite-onboard-step">
      <h2>{l.onboardScopeTitle}</h2>
      <p className="lite-onboard-step-body">{l.onboardScopeBody}</p>
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
        <div className="lite-onboard-field-row">
          <label className="lite-onboard-field">
            <span>{l.onboardTeamCountLabel}</span>
            <input
              type="text"
              inputMode="numeric"
              className="lite-onboard-teamcount"
              value={teamCount}
              placeholder={l.onboardTeamCountPlaceholder}
              onChange={(e) => setField('teamCount', e.target.value)}
            />
          </label>
          <label className="lite-onboard-field">
            <span>{l.onboardRoleLabel}</span>
            <input
              type="text"
              className="lite-onboard-role"
              value={yourRole}
              placeholder={l.onboardRolePlaceholder}
              onChange={(e) => setField('yourRole', e.target.value)}
            />
          </label>
        </div>
        {/* 8A 的正主：公司现状口述——这一格**会送后端**（company_notes），提示逐字说明去向。 */}
        <label className="lite-onboard-field lite-onboard-field-note">
          <span>{l.onboardCompanyNoteLabel}</span>
          <textarea
            className="lite-onboard-companynote"
            value={companyNote}
            rows={3}
            maxLength={2000}
            placeholder={l.onboardCompanyNotePlaceholder}
            onChange={(e) => setField('companyNote', e.target.value)}
          />
          <span
            className="lite-onboard-field-hint"
            data-note-hint={preview ? 'preview' : hasContext ? 'now' : 'later'}
          >
            {noteHint}
          </span>
        </label>
      </div>
    </div>
  )
}

// ── ④ 选择管理偏好——合伙人的 5 个管理框架（拍板 9）。────────────────────────────────
function StepPrefs() {
  const { t } = useDict()
  const l = t.lite2
  const frameworks = useOnboard((s) => s.frameworks)
  const toggleFramework = useOnboard((s) => s.toggleFramework)

  return (
    <div className="lite-onboard-step">
      <h2>{l.onboardPrefsTitle}</h2>
      <p className="lite-onboard-step-body">{l.onboardPrefsBody}</p>
      {/* 拍板 9 明写「选择只存本地、不影响分析——界面如实标注」。这句就是那个标注。 */}
      <p className="lite-onboard-honesty" data-honesty="prefs">
        {l.onboardPrefsHonesty}
      </p>
      <div className="lite-onboard-choice-grid">
        {FRAMEWORK_CATALOG.map((entry) => {
          const on = frameworks.includes(entry.id)
          return (
            <button
              key={entry.id}
              type="button"
              className={`lite-onboard-choice lite-onboard-framework${on ? ' is-on' : ''}`}
              data-framework-id={entry.id}
              aria-pressed={on}
              onClick={() => toggleFramework(entry.id)}
            >
              <span className="lite-onboard-choice-title">{entry.title(l)}</span>
              <span className="lite-onboard-choice-body">{entry.body(l)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── ⑤ 创建管理者账号（ADR-0034 拍板 5）───────────────────────────────────────────────
// 账号系统是**真的**（feat-053 的 Supabase GoTrue，生产实探 /account/status 200）。本步只做
// 两件事：把注册搬进向导 + 注册成功后自动认领当前 context。认领架构一个字没动。
//
// 🔴 三条不许动的边界：
//   ① **可跳过**。游客路径是硬性产品要求（authStore 文件头的第 2 条硬性质），不是将就。
//      「稍后再说」与走完向导等价——跳过之后一切照常能用。
//   ② **邮箱确认分支必须做**。Supabase 项目若开了 email confirmation，signUp 拿不到 session
//      （authStore 的 pendingVerification）。此时绝不能假装已登录，要如实说去收信，并告诉他
//      登录之后顶栏还能认领——AuthPanel 那个入口是现成兜底，不是新做一条路。
//      🔴 别假设配置：两个分支都在，探测不到就都别猜。
//   ③ **不造第二套状态机**。注册走的是 authStore.signUp，认领走的是 transport.claimContext，
//      与顶栏 AuthPanel 同一条链——向导只是同一个状态机的第二个入口。
function StepAccount() {
  const { t } = useDict()
  const l = t.lite2

  const status = useAuth((s) => s.status)
  const email = useAuth((s) => s.email)
  const busy = useAuth((s) => s.busy)
  const error = useAuth((s) => s.error)
  const pendingVerification = useAuth((s) => s.pendingVerification)
  const signUp = useAuth((s) => s.signUp)

  const contextId = useLite((s) => s.contextId)
  const ownerToken = useLite((s) => s.ownerToken)
  const rawTeam = useLite((s) => s.rawTeam)
  const transport = useLite((s) => s.transport)

  const preview = useOnboard((s) => s.preview)
  const goStep = useOnboard((s) => s.goStep)
  const tools = useOnboard((s) => s.tools)
  const frameworks = useOnboard((s) => s.frameworks)
  const rows = useIntake((s) => s.rows)

  const [emailInput, setEmailInput] = useState('')
  const [password, setPassword] = useState('')
  const [claim, setClaim] = useState<'idle' | 'claiming' | 'claimed' | 'failed'>('idle')
  // 自动认领只跑一次（每个 context 一次）。ref 而不是 state：它是"这一发做过没有"的账本，
  // 不该引起重渲染，也不该在 claim 失败后被 setState 的时序绕回来再打一次。
  const claimedFor = useRef<string | null>(null)

  const authed = status === 'authed'
  // 已经绑好了：后端在已登录上传时当场就绑了（/ingest 回 account_linked），或者本步刚认领成功。
  // 🔴 不看这一条的话，面板会对着一份**已经归属**的数据说"还没绑"——AuthPanel 修过同一个 bug。
  const alreadyLinked = rawTeam?.account_linked === true || claim === 'claimed'
  const canClaim = authed && Boolean(contextId) && Boolean(ownerToken) && !alreadyLinked

  const doClaim = async () => {
    const claimContext = transport.claimContext
    if (!claimContext || !contextId || !ownerToken) return
    setClaim('claiming')
    try {
      await claimContext.call(transport, contextId, ownerToken)
      setClaim('claimed')
    } catch {
      // 认领失败**不是**注册失败：账号已经建好了，只是这份数据还没绑上。顶栏 AuthPanel 的
      // 认领入口仍然可用，文案要如实这么说，别把两件事混成一句"出错了"。
      setClaim('failed')
    }
  }

  // 注册成功且拿到 session → 自动认领当前 context（拍板 5）。
  useEffect(() => {
    if (preview) return                       // 预览态不发请求
    if (!canClaim) return
    if (claimedFor.current === contextId) return
    claimedFor.current = contextId
    void doClaim()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canClaim, contextId, preview])

  const filledTables = Object.values(rows).filter((list) =>
    list.some((r) => Object.values(r).some((v) => v.trim() !== ''))).length

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (busy !== 'idle' || preview) return
    void signUp(emailInput, password)
  }

  return (
    <div className="lite-onboard-step" data-account-step={authed ? 'authed' : pendingVerification ? 'pending' : 'form'}>
      <h2>{l.onboardAccountTitle}</h2>
      <p className="lite-onboard-step-body">{l.onboardAccountBody}</p>

      {/* 步顶摘要 chips（静态稿）。🔴 中间那颗**不叫「已连接工具」**：第②步同屏刚说过
          「目前还没有开通任何连接」，总结里再说"已连接"就是自己打自己脸。叫「已登记」。 */}
      <ul className="lite-onboard-account-summary" aria-label={l.onboardAccountSummaryAria}>
        <li className="lite-badge" data-summary="tables">{fill(l.onboardAccountSummaryTables, { n: filledTables })}</li>
        <li className="lite-badge" data-summary="tools">{fill(l.onboardAccountSummaryTools, { n: tools.length })}</li>
        <li className="lite-badge" data-summary="frameworks">{fill(l.onboardAccountSummaryFrameworks, { n: frameworks.length })}</li>
      </ul>

      {authed ? (
        <div className="lite-onboard-account-state">
          <p className="lite-onboard-account-who">
            {fill(l.onboardAccountSignedIn, { email: email ?? '' })}
          </p>
          {alreadyLinked ? (
            <p className="lite-onboard-account-claimed" data-claim="done">{l.onboardAccountClaimed}</p>
          ) : !contextId ? (
            // 还没有工作区可绑（跳过了第①步）。诚实说明，不出一颗点了没反应的按钮。
            <p className="lite-onboard-account-note" data-claim="nothing">{l.onboardAccountNothingToClaim}</p>
          ) : claim === 'claiming' ? (
            <p className="lite-onboard-account-note" data-claim="claiming">{l.onboardAccountClaiming}</p>
          ) : (
            <div className="lite-onboard-account-claim">
              {claim === 'failed' ? (
                <p className="lite-onboard-account-error" role="alert" data-claim="failed">
                  {l.onboardAccountClaimFailed}
                </p>
              ) : null}
              <button
                type="button"
                className="lite-btn lite-btn--primary lite-onboard-account-claimbtn"
                onClick={() => void doClaim()}
                disabled={preview}
              >
                {claim === 'failed' ? l.onboardAccountClaimRetry : l.onboardAccountClaimAction}
              </button>
            </div>
          )}
        </div>
      ) : pendingVerification ? (
        // 邮箱确认分支：有 user、没 session。绝不假装已登录。
        <div className="lite-onboard-account-state">
          <p className="lite-onboard-account-pending" data-account-branch="pending">
            {l.onboardAccountPending}
          </p>
          <p className="lite-onboard-account-note">{l.onboardAccountPendingHow}</p>
        </div>
      ) : (
        <form className="lite-onboard-account-form" onSubmit={submit}>
          <label className="lite-onboard-field">
            <span>{l.onboardAccountEmailLabel}</span>
            <input
              type="email"
              autoComplete="email"
              className="lite-onboard-account-email"
              value={emailInput}
              placeholder={l.onboardAccountEmailPlaceholder}
              onChange={(e) => setEmailInput(e.target.value)}
              disabled={preview}
            />
          </label>
          <label className="lite-onboard-field">
            <span>{l.onboardAccountPasswordLabel}</span>
            <input
              type="password"
              autoComplete="new-password"
              className="lite-onboard-account-password"
              value={password}
              placeholder={l.onboardAccountPasswordPlaceholder}
              onChange={(e) => setPassword(e.target.value)}
              disabled={preview}
            />
          </label>
          {error ? (
            <p className="lite-onboard-account-error" role="alert">{error}</p>
          ) : null}
          <div className="lite-onboard-account-actions">
            {/* 🔴 6 位是**同一个框的占位符自己写着的**要求（也是 Supabase 的默认下限）。
                首版只判非空，于是填一个字符按钮就亮了——屏幕在自己打自己的脸，而且点下去必然
                换回一次「密码太短了」的往返（checker 逮到）。校验与承诺对齐，不是加严。 */}
            <button
              type="submit"
              className="lite-btn lite-btn--primary lite-onboard-account-create"
              disabled={busy !== 'idle' || preview || !emailInput.trim() || password.length < 6}
              aria-busy={busy === 'signing-up'}
            >
              {busy === 'signing-up' ? l.onboardAccountCreating : l.onboardAccountCreate}
            </button>
            {/* 拍板 5：可跳过。它与「下一步」并列，不藏在角落——跳过是一条正当的路。 */}
            <button
              type="button"
              className="lite-btn lite-btn--ghost lite-onboard-account-later"
              onClick={() => goStep('done')}
            >
              {l.onboardAccountLater}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ── ⑥ 完成页——问候 + 所选摘要 + 进入。────────────────────────────────────────────────
function StepDone({ accountAvailable }: { accountAvailable: boolean }) {
  const { t } = useDict()
  const l = t.lite2
  const yourName = useOnboard((s) => s.yourName)
  const tools = useOnboard((s) => s.tools)
  const frameworks = useOnboard((s) => s.frameworks)
  const chosenTools = TOOL_CATALOG.filter((entry) => tools.includes(entry.id))
  const chosenFrameworks = FRAMEWORK_CATALOG.filter((entry) => frameworks.includes(entry.id))
  // 账号步整步隐去时，摘要里也不该出现它——否则总结在替一个屏上不存在的步骤说话。
  void accountAvailable

  return (
    <div className="lite-onboard-step">
      <h2>{l.onboardDoneTitle}</h2>
      <p className="lite-onboard-step-body lite-onboard-greeting">
        {yourName.trim()
          ? fill(l.onboardDoneGreeting, { name: yourName.trim() })
          : l.onboardDoneGreetingNoName}
      </p>
      {chosenFrameworks.length > 0 || chosenTools.length > 0 ? (
        <div className="lite-onboard-summary">
          {chosenFrameworks.length > 0 ? (
            <>
              <p className="eyebrow lite-onboard-summary-lead">{l.onboardDoneFrameworksLead}</p>
              <ul className="lite-onboard-summary-list">
                {chosenFrameworks.map((entry) => (
                  <li
                    key={entry.id}
                    className="lite-onboard-summary-item"
                    data-framework-id={entry.id}
                  >
                    {entry.title(l)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {chosenTools.length > 0 ? (
            <>
              <p className="eyebrow lite-onboard-summary-lead">{l.onboardDoneToolsLead}</p>
              <ul className="lite-onboard-summary-list">
                {chosenTools.map((entry) => (
                  <li key={entry.id} className="lite-onboard-summary-item" data-tool-id={entry.id}>
                    {entry.title(l)}
                  </li>
                ))}
              </ul>
              <p className="lite-onboard-honesty" data-honesty="done-tools">
                {l.onboardToolsHonesty}
              </p>
            </>
          ) : null}
        </div>
      ) : (
        <p className="lite-onboard-summary-none">{l.onboardDoneNoPicks}</p>
      )}
    </div>
  )
}
