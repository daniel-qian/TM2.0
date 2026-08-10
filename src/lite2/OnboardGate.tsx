import { useEffect, useRef, type ChangeEvent } from 'react'
import { loadStoredContextId, useLite } from './store'
import {
  ONBOARD_STEPS,
  PLAYBOOK_CATALOG,
  selectWizardOpen,
  useOnboard,
  type OnboardStep,
} from './onboardStore'
import { useDemo } from './demoStore'
import { paperworkHref } from './routes'
import { flushCompanyNote, wireCompanyNoteFlush } from './onboardNote'
import { useDict } from '../shared/i18n/useDict'
import { clearIngestStart, useIngestElapsedSeconds } from '../shared/ingestClock'
import { LiteModal } from './LiteModal'

// input-side-0721（Danny 拍板）· onboarding 从浮层对话框改成**全屏闸门页**——对齐合伙人
// command-room 版藏在 /companyinput 的独立 onboarding 页（其 layout 就是 fixed inset-0 全屏盖）。
// 新访客先过这道门再进指挥室；有数据的回头客照旧永不见门（hadContextOnLoad 判定原样）。
//
// 形态变了，**底座没换**：仍站在 LiteModal 上（Escape=pause、body 滚动锁、焦点圈、层栈——
// 全屏盖底下的 shell 仍在 DOM 里，焦点圈是键盘用户不 Tab 进"被盖住的世界"的那道墙；对读屏
// 用户 aria-modal 也仍是诚实描述）。整页观感由 layerClassName="lite-gate-layer" 的 CSS 承担：
// 背景不再是半透明压暗而是整幅不透明底，面板变成页面居中卡片。点背景关闭**关掉**
// （closeOnBackdrop=false）：整页世界里"背景"是页面本身，误触不该关门；键盘退路归 Escape，
// 可见退路归右上「先自己逛逛」（同一个 pause 语义：进度保留、下次续跑）。
//
// 步骤从四步变五步——第 0 步「三扇门」（Danny：一键示例团队放进前置 onboarding）：
//   ⓪ 三扇门——①示例团队（真打 POST /demo/claim 克隆预铸母本；能力探测不到就不出这扇门）
//      ②上传自己的材料（走完整步进）③右上「先自己逛逛」（pause）。
//   ① 上传资料——真调 store.uploadFiles（与 UploadPanel 同一条 ingest 路径）。
//   ② 团队信息——问候字段照旧只存本机；8A 新增「公司现状」口述**会送后端**
//      （onboardNote.ts → POST /team/{id}/notes → company_notes，文案与机制同棒对齐）。
//   ③ 选 playbooks——8 项候选默认勾 3。
//   ④ 完成页——所选摘要 + 进入。
//
// 🔴 红线：全程零人卡、零数字读数；不做假"连接工具"/假"创建账号"步（合伙人版那步是纯假
// toggle，不抄）；示例团队按钮只在后端真有 demo 时出现（不出假按钮）。门相位按稳定 data-id
// 断言：.lite-onboard[data-onboard-step] / .lite-onboard-playbook[data-playbook-id] /
// .lite-onboard-summary-item[data-playbook-id] —— 三个选择器继续原样保留。

// 0721 对齐棒：与 UploadPanel.tsx 的 ACCEPT 保持一字不差——fixB1 当时只修了 UploadPanel，
// 这里仍列 .doc/.xls（后端 415 必拒）且漏 .tsv，首访用户走向导挑中旧格式必然撞墙。
// 「多列一种格式是撒谎」（UploadPanel fixB1 注释）同样适用于向导。
const ACCEPT = '.pdf,.docx,.xlsx,.csv,.tsv,.md,.markdown,.txt'

// 07-20 · 返回客户判定（Danny 拍板「已经有数据就不弹」）——模块顶层只读一次 localStorage
// 的 contextId 锚点，不做响应式订阅。同 store.ts 自己的 `restoredContextId` 一个套路：
// 这个常量在模块求值时（页面这次加载的一瞬间，早于任何一次 React 渲染）就已经定死，
// 所以 `open` 从第一帧起就已经把它算进去了——不存在"restoreSession 那个网络请求回来
// 之前先露一下脸、拿到结果才关掉"的窗口。若改成响应式读 useLite 的 contextId，向导
// 自己的①上传步一成功、contextId 落地，会在全新用户正走②③④步时被这条新规则回头
// 把向导关掉——用一次性快照就没有这个问题（详见 onboardStore.ts selectWizardOpen 上的
// 调用方契约注释）。
const hadContextOnLoad = loadStoredContextId() !== null

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

// feat-068 · 活的秒表。ingest 真实耗时 100–120s（后端法兰克福 / LLM 国内，跨境往返）。
// 向导是首访 v02 用户的主上传路径，这两分钟里必须有可见证据说明"没冻"——否则用户判定卡死、
// 去戳按钮，就落进下面 StepUpload 注释里那条数据毁灭链。
//
// 刻意不做百分比进度条：服务端 /ingest 不吐任何进度信号，假进度条只会卡在 90% 一动不动。
//
// 🔴 feat-068 修正——本组件是这个 bug 最严重的现场。onboardUploadHint 明写「这期间可以先
// 进行下一步」，而"下一步"在向导里就是 StepUpload **unmount**。秒表原先是组件局部 state，
// 用户完全照提示做 → t=100s 切回上传步 → 屏幕写「已用时 4 秒」。产品亲口教用户走的那条路，
// 恰好是唯一能把秒表打回 0 的路；而秒表存在的唯一理由是证明"没冻"，归零反而像"上传自己
// 重来了一遍"。锚点已移进 shared/ingestClock，跟着这一发 ingest 活、不跟着组件活。
//
// 生命周期收口在那个 hook 里：向导被 × / Escape / Skip 关掉、换步、ingest 结束——三条路
// 共用同一个 cleanup，不留悬挂定时器（与上面 Escape 监听器的注销纪律同源）。

export function OnboardGate() {
  const { t } = useDict()
  const l = t.lite2

  const step = useOnboard((s) => s.step)
  const status = useOnboard((s) => s.status)
  // 向导是否该露面（原先由 Lite2App 条件挂载判定；feat-052 移进来——组件常驻挂载，
  // 用 open 开关，出场动画才有机会跑完）。07-20 起再叠一层：hasStoredContext
  // （hadContextOnLoad）由这里传给 selectWizardOpen——老客户已经有数据就不自动弹
  // （Danny 拍板，见 onboardStore.ts 的选择器注释）。
  //
  // open-loop-0720：`forceOpen` 单独 `||` 进来，不改 selectWizardOpen 本身——那个函数的
  // 契约只管"要不要自动弹"，手动重看是另一件事，两条判据不该纠缠在同一个函数里
  // （改错一处，另一处也可能被带歪）。见 onboardStore.ts 里 forceOpen 上的调用方契约注释：
  // 这是让「重看上手引导」（Playbooks 屏）对已有数据的老客户也真正打得开的那个开关。
  const open = useOnboard((s) => s.forceOpen || selectWizardOpen(s, hadContextOnLoad))
  const begin = useOnboard((s) => s.begin)
  const goStep = useOnboard((s) => s.goStep)
  const pause = useOnboard((s) => s.pause)
  const skip = useOnboard((s) => s.skip)
  const finish = useOnboard((s) => s.finish)

  // 首访：挂载即把 unseen 落成 in-progress（持久化）——从此刻起进度可续。
  // （status==='unseen' ⇒ selectWizardOpen 为真，所以"常驻挂载后才 begin"与原先"开着才挂载、
  //  挂载即 begin"等价，没有提前把 unseen 吃掉。）
  useEffect(() => {
    if (status === 'unseen') begin()
    // input-side-0721 · 8A：接上「公司现状」的延迟送出线（contextId 每落一个新值送一次，
    // 幂等账本在 onboardStore）。挂在常驻组件的一次性 effect 里，模块求值期不做副作用。
    wireCompanyNoteFlush()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape = pause（进度保留、下次续跑）——对抗验证打回（2026-07-14）：aria-modal 弹层
  // 必须可键盘退出，否则键盘用户被困。feat-052 起由 LiteModal 基座统一提供（onClose =
  // pause），本组件不再自挂 window 监听。背景**不可点**（closeOnBackdrop=false，整页闸门
  // 不是可随手拍掉的浮窗）；ui-sweep-0802 起基座在该配置下渲染 aria-hidden 纯遮罩，
  // 不再是挂着关闭标签却无为的假按钮。

  const stepIndex = ONBOARD_STEPS.indexOf(step)
  const goNext = () => {
    const next = ONBOARD_STEPS[stepIndex + 1]
    if (next) goStep(next)
  }
  const goBack = () => {
    const prev = ONBOARD_STEPS[stepIndex - 1]
    if (prev) goStep(prev)
  }

  // 完成 = 关门 + 立刻尝试送出「公司现状」（此刻若已有 context——上传成功/示例领取——订阅
  // 线不会再触发，得在这里补一脚；没有 context 则由订阅线在未来落地时送）。
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
      panelData={{ 'data-onboard-step': step }}
      closeOnBackdrop={false}
    >
      <header className="lite-onboard-head">
        <p className="eyebrow lite-onboard-eyebrow">
          {l.onboardEyebrow}
          <span className="lite-gate-step-count">
            {' · '}
            {fill(l.onboardStepOf, { n: stepIndex + 1, total: ONBOARD_STEPS.length })}
          </span>
        </p>
        <div className="lite-onboard-dots" aria-label={l.onboardStepsAria}>
          {ONBOARD_STEPS.map((s) => (
            <span
              key={s}
              className={`lite-onboard-dot${s === step ? ' is-active' : ''}`}
              aria-hidden="true"
            />
          ))}
        </div>
        {/* 整页闸门没有 ×（它不是可随手拍掉的弹窗）；可见退路是这句诚实的话——pause 语义
            与 Escape 完全一致：进度保留、下次续跑。 */}
        <button
          type="button"
          className="lite-btn lite-btn--ghost lite-gate-browse"
          title={l.onboardCloseAria}
          onClick={pause}
        >
          {l.onboardBrowse} →
        </button>
      </header>

      <div className="lite-onboard-body">
        {step === 'doors' ? (
          <StepDoors />
        ) : step === 'upload' ? (
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
          <button type="button" className="lite-btn lite-btn--ghost lite-onboard-skip" onClick={skip}>
            {l.onboardSkip}
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
              <button type="button" className="lite-btn lite-btn--primary lite-onboard-next" onClick={goNext}>
                {l.onboardNext}
              </button>
            ) : (
              <button type="button" className="lite-btn lite-btn--primary lite-onboard-finish" onClick={onFinish}>
                {l.onboardFinish}
              </button>
            )}
          </div>
        ) : null}
      </footer>
    </LiteModal>
  )
}

// ── ⓪ 三扇门——闸门页第一眼（input-side-0721）。────────────────────────────────────
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
          「两条路」就是向首访用户许诺一个屏上不存在的选项（7 屏走查同批实锤）。与下面
          demo 门的渲染判据同一条：availability==='yes' 才是两扇门。 */}
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
          onClick={() => goStep('upload')}
        >
          <span className="lite-gate-door-title">{l.onboardDoorUploadTitle}</span>
          <span className="lite-gate-door-body">{l.onboardDoorUploadBody}</span>
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

// ── ① 上传资料——真调 store.uploadFiles（与 Your team 的 UploadPanel 同一条路径）。──
function StepUpload() {
  const { t } = useDict()
  const l = t.lite2
  const uploadFiles = useLite((s) => s.uploadFiles)
  const ingestStatus = useLite((s) => s.ingestStatus)
  const ingestError = useLite((s) => s.ingestError)
  const appendStatus = useLite((s) => s.appendStatus)
  const appendError = useLite((s) => s.appendError)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // #88 · 这一步照旧调 `store.uploadFiles`（**全新用户的档案就是这么铸出来的**，票面明令
  // 不许碰），但 `uploadFiles` 现在会在「已经有档案」时把这一发**委托给 `appendFiles`**。
  // 于是屏上该显示哪条状态机，取决于这一发究竟走了哪条路。
  //
  // 够得着的现场：向导里传成功一次（`contextId` 落地，而向导**刻意不关**——见文件头那段
  // 「不响应式读 contextId」的碑，全新用户还要走②③④步）→ 用户翻回①再传一次。旧代码那
  // 一发当场开出第二家公司；现在它是补料，`ingestStatus` 一动不动停在 'ready'。照旧只读
  // `ingestStatus` 的话，屏上会**从头到尾写着「已就绪」**：秒表不走、失败也不报——用户在
  // 一个正在跑的两分钟里看到的是"早就好了"。
  //
  // 🔴 判据不能写成「有没有 contextId」。引导那一发跑完的**同一帧** contextId 就到手了，
  //    按它选的话 'ready' 会翻给一条还是 idle 的 append 机，「已就绪」在成功的瞬间消失、
  //    一帧都不出现（`verify-onboard-gate` 等的正是 `.lite-onboard-upload-ready`）。
  //    所以按「谁在动」选，和资料库屏 `shown` 那一处**同一条规则**（FilesScreen 里有碑）。
  const appending =
    appendStatus === 'ingesting' ? true
      : ingestStatus === 'ingesting' ? false
        : appendStatus !== 'idle'
  const status = appending ? appendStatus : ingestStatus
  const error = appending ? appendError : ingestError

  // feat-068 · ingesting 期间这一步整体上锁。
  const busy = status === 'ingesting'
  const elapsed = useIngestElapsedSeconds(busy)

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    // feat-068 · 发车前先松锚，保证这一发从 0 起算（理由见 lite/UploadPanel 同处注释）。
    if (files.length > 0) {
      clearIngestStart()
      void uploadFiles(files)
    }
    event.target.value = ''
  }

  // feat-068 · 🔴 重入闸——这不是打磨，是数据毁灭级的 correctness 修复。
  //
  // 事发链：/ingest 真的要 100–120s；在此之前这两分钟屏幕上只有一行静态字，用户判定卡死 →
  // 再点一次"选择文件"。这颗按钮既没有 disabled、也不在 .lite-onboard 的任何 busy 遮罩下
  // （UploadPanel 的 .upload-dropzone.is-busy{pointer-events:none} 只覆盖那边的 dropzone，
  // 管不到向导），store.uploadFiles 也没有重入保护——于是每一次点击都真的再打一发 POST /ingest。
  //
  // 后果：每发各自新铸一个 context_id 和一个 owner_token；后落地的那发覆盖 store，先前那个
  // owner_token 服务端只返一次、客户端已被覆盖 = 永久丢失，那份公司数据从此无人能认领。
  // 一分钟点四下还会撞穿 10/min burst-3 限流吃 429。
  //
  // 本波只在 UI 层封口（store.ts 归他人所有，本 feature 不碰）：disabled 挡住鼠标和键盘两条
  // 触发路径，openPicker 再兜一层——即使将来有人拆了 disabled，也打不出第二发。
  const openPicker = () => {
    if (busy) return
    inputRef.current?.click()
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
        className={`lite-btn lite-btn--primary lite-onboard-upload-choose${busy ? ' is-busy' : ''}`}
        disabled={busy}
        aria-busy={busy}
        onClick={openPicker}
      >
        {l.onboardUploadChoose}
      </button>
      {/* feat-068 · 诚实的等待态：预期在前（onboardUploadHint）+ 活的秒表 + 一条不定量动效。
          🔴 秒表与动效整块 aria-hidden：外层是 aria-live="polite"，每秒变一次的数字若进无障碍
          树，读屏会被每秒播报刷屏两分钟；"在忙"这件事由按钮的 aria-busy 表达即可。 */}
      <div className="lite-onboard-upload-status" aria-live="polite">
        {status === 'ingesting' ? (
          <div className="lite-onboard-upload-waiting">
            <p className="lite-onboard-upload-reading">
              <span className="lite-onboard-upload-dot" aria-hidden="true" />
              {l.onboardUploadReading}
            </p>
            <p className="lite-onboard-upload-hint">{l.onboardUploadHint}</p>
            <p className="lite-onboard-upload-elapsed" aria-hidden="true">
              {fill(l.onboardUploadElapsed, { seconds: elapsed })}
            </p>
            <div className="lite-onboard-upload-bar" aria-hidden="true">
              <span />
            </div>
          </div>
        ) : status === 'ready' ? (
          <p className="lite-onboard-upload-ready">{l.onboardUploadReady}</p>
        ) : status === 'error' ? (
          <p className="lite-onboard-upload-error">
            {l.onboardUploadError}
            {error ? <span className="lite-onboard-upload-error-detail"> {error}</span> : null}
          </p>
        ) : (
          <p className="lite-onboard-upload-idle">{l.onboardUploadIdle}</p>
        )}
        {/* partner-docs-0728 · 首访者第一次面对「传什么」就在这一步，这条链接最该在这儿。
            🔴 用裸 <a target="_blank"> 而不是 <Link>：闸门是覆盖全屏的 modal，站内导航只会把
            /paperwork 渲染在**它底下**——用户以为自己离开了向导，实际什么都没发生，进度还卡
            在原地。新标签页打开，闸门原样留着。href 仍要带粘性 query（丢 `?v=2` 会掉回 v01，
            而 v01 没有这条路由）。rel 补 noreferrer：新标签拿不到 window.opener。 */}
        <p className="lite-onboard-upload-forms">
          <a href={paperworkHref()} target="_blank" rel="noopener noreferrer">
            {l.onboardUploadFormsLink}
          </a>
        </p>
      </div>
    </div>
  )
}

// ── ② 团队信息——问候字段只存本机；8A「公司现状」口述会送后端（诚实分界逐字段标明）。──
function StepTeam() {
  const { t } = useDict()
  const l = t.lite2
  const company = useOnboard((s) => s.company)
  const dept = useOnboard((s) => s.dept)
  const yourName = useOnboard((s) => s.yourName)
  const teamCount = useOnboard((s) => s.teamCount)
  const yourRole = useOnboard((s) => s.yourRole)
  const companyNote = useOnboard((s) => s.companyNote)
  const setField = useOnboard((s) => s.setField)
  // 「公司现状」的去向提示按真实状态二选一：已有工作区 → 「会存进你团队的笔记」；
  // 还没有 → 「等你的材料就位后一起交给 Avery」。两句都是真话，没有第三句。
  const hasContext = useLite((s) => s.contextId !== null)

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
        {/* input-side-0721 · 8A：对齐 cr /companyinput 的团队信息步（人数/职位），仍属本机
            问候配置——不送后端。 */}
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
          <span className="lite-onboard-field-hint" data-note-hint={hasContext ? 'now' : 'later'}>
            {hasContext ? l.onboardCompanyNoteHint : l.onboardCompanyNoteHintLater}
          </span>
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
