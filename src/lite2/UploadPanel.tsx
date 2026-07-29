import { useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { paperworkHref } from './routes'
import { useLite } from './store'
import { useDict } from '../shared/i18n/useDict'
import { clearIngestStart, useIngestElapsedSeconds } from '../shared/ingestClock'
import { FileManifest } from './FileManifest'

// feat-017 · 上传 UI——ADR-0020 决策 2 / 施工图 §2 表 #1；feat-024 随 lite 壳入墙。
//
// 把脚本化"演"的 ingestion 做成真的：用户传文件 → store.uploadFiles →
// transport.ingest（feat-016）→ Your team 长出来。红线（施工图 §5）：上传产出的人卡在
// teamData 侧已剥净数字；这里只负责"传文件 + 显进度 + 显来源"。
//
// copy 全走 i18n（en/zh）。只在 lite 壳内渲染。

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

// 对抗复审 fixB1（找回 07-19 fixB/M3）· accept 必须与后端 guards.SUPPORTED_EXTS 一致。
//
// 这里曾经多列了 `.doc` 和 `.xls`——后端从来不支持这两个。后果不是"少一种格式"，是**用户能在
// 文件选择器里挑中它、能传出去、然后必然 422**：我们主动把人领进一条死路，还在终点告诉他文件有问题。
// 少列一种格式只是少一种；多列一种格式是撒谎。旧格式怎么办由界面明说（acceptedLegacyNote），
// 不靠用户自己猜。
// 🔴 改这一行时同步 eval-harness/avery/ingest/guards.py::SUPPORTED_EXTS，两边必须一致。
const ACCEPT = '.pdf,.docx,.xlsx,.csv,.tsv,.md,.markdown,.txt'

// 07-19 fixB 收口的版式修正：accepted 三行合并——原因见当时的注释（真机实测：新元素落在
// 浏览器默认 16px 全墨字 + 16px 下边距）。
// files-hub-0729/01：文件行那几条样式常量与状态徽章逻辑随渲染一起搬进 FileManifest.tsx，
// 本文件只留 dropzone 自己的版式。
const ACCEPTED_LINE_STYLE: CSSProperties = { display: 'block', marginTop: '2px' }

// feat-068 · 模板填充（与 OnboardWizard 的同名 helper 同形；这里只用于秒表文案）。
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

// feat-068 · 活的秒表。ingest 真实耗时 100–120s（后端法兰克福 / LLM 国内，跨境往返）
// ——v02 是要真拿去演示的那张皮，这两分钟里屏幕必须有可见证据说明"没冻"。
//
// 刻意不做百分比进度条：服务端 /ingest 不吐任何进度信号，假进度条只会卡在 90% 一动不动，
// 比一行诚实的秒数更伤信任。秒数是唯一我们真的知道的量。
//
// feat-068 修正：秒表原先在两个壳里各自持一份组件局部 state，surface 一 unmount 就归零重数。
// v02 受害最重——onboardUploadHint 劝用户「这期间可以先进行下一步」，向导换步就是 unmount，
// 用户照做必踩。锚点已移进 shared/ingestClock（模块级，跟着这一发 ingest 活），本壳的
// UploadPanel 与 OnboardWizard.StepUpload 从此读同一个起点：两边显示的秒数一致，且都是真值。
// 这一处**刻意不再按 v01→v02 惯例各留一份**——两个壳要的正是同一个时间锚。

type UploadPanelProps = {
  /**
   * files-hub-0729/01 · 底下那份「你的文件」清单渲不渲染。默认渲染（首页骨架卡、引导闸
   * 之外的既有用法一字不变）。
   *
   * 🔴 资料库屏传 `false`：那一屏在上传口**上方**已经有一份带下载列的清单，两处都渲染就是
   * 两个 `.upload-files` —— 门按类名全局取样（filesSurfaceV2 数 `.upload-file-row`），
   * 会数出双倍行数。这不是样式偏好，是断言正确性。
   */
  showFiles?: boolean
}

export function UploadPanel({ showFiles = true }: UploadPanelProps = {}) {
  const { t } = useDict()
  const uploadFiles = useLite((s) => s.uploadFiles)
  const status = useLite((s) => s.ingestStatus)
  const error = useLite((s) => s.ingestError)
  const team = useLite((s) => s.team)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const sourceFiles = team?.sourceFiles ?? []
  const busy = status === 'ingesting'
  const elapsed = useIngestElapsedSeconds(busy)

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    // feat-068 · 发车前先松锚，保证这一发从 0 起算（理由见 lite/UploadPanel 同处注释）。
    if (files.length > 0) {
      clearIngestStart()
      void uploadFiles(files)
    }
    // 允许重复选同名文件再次触发。
    event.target.value = ''
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    if (busy) return
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length > 0) {
      clearIngestStart()
      void uploadFiles(files)
    }
  }

  // feat-068 · 唯一的"开文件选择器"入口，ingesting 期间一律不开。
  //
  // 为什么不能只靠 CSS：.upload-dropzone.is-busy 的 pointer-events:none 只挡鼠标，挡不住键盘
  // ——dropzone 自身 tabIndex=0 + Enter/Space 处理、.upload-choose 又是真 <button>，键盘用户
  // 在这两分钟里回车两下就能打出第二发 POST /ingest。每一发都新铸一个 context_id 和一个
  // owner_token，后落地的覆盖 store，先前那个 token 服务端只返一次 = 永久丢失。
  const openPicker = () => {
    if (busy) return
    inputRef.current?.click()
  }

  return (
    <section className="upload-panel" aria-label={t.upload.title}>
      <header className="upload-panel-head">
        <h2>{t.upload.title}</h2>
        <p>{t.upload.caption}</p>
      </header>

      <div
        className={classNames(['upload-dropzone', dragOver && 'is-dragover', busy && 'is-busy'])}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        aria-label={t.upload.drop}
        aria-busy={busy}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openPicker()
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="upload-input"
          onChange={onPick}
          aria-hidden="true"
          tabIndex={-1}
        />
        <p className="upload-drop-label">{t.upload.drop}</p>
        <button
          type="button"
          className={classNames(['lite-btn', 'lite-btn--primary', 'upload-choose', busy && 'is-busy'])}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            openPicker()
          }}
        >
          {t.upload.choose}
        </button>
        {/* fixB1/M3 · 「支持哪些」不能只说 Word/Excel 这种族名——那正是让人挑中 .doc/.xls 的
            原因。扩展名逐个列出，旧格式怎么办也明说。三行合进同一个 <p className="upload-accepted">
            里：样式层只认识这一个类，后两行做成它的块级子元素，就直接继承 11px / --ink-faint /
            margin:0，不再各自退回浏览器默认的 16px 全墨字 + 16px 下边距。 */}
        <p className="upload-accepted">
          {t.upload.accepted}
          <span className="upload-accepted-exts" style={ACCEPTED_LINE_STYLE}>
            {t.upload.acceptedExts}
          </span>
          <span className="upload-accepted-legacy" style={ACCEPTED_LINE_STYLE}>
            {t.upload.acceptedLegacyNote}
          </span>
        </p>
      </div>

      <div className="upload-status" aria-live="polite">
        {/* feat-068 · 诚实的等待态。三层：① 一句话把 1–2 分钟的预期讲在前头（ingestingHint），
            ② 活的秒表证明没冻，③ 一条不定量动效（CSS，尊重 prefers-reduced-motion）。
            🔴 秒表和动效整块 aria-hidden：外层 .upload-status 是 aria-live="polite"，每秒变一次
            的数字若进无障碍树，读屏会被每秒播报一次刷屏两分钟。标签 + hint 播报一次即可，
            "没冻"这件事对读屏用户本来就由 aria-busy 表达。 */}
        {status === 'ingesting' ? (
          <div className="upload-ingesting-block">
            <p className="upload-ingesting">
              <span className="upload-ingesting-dot" aria-hidden="true" />
              {t.upload.ingestingLabel}
            </p>
            <p className="upload-ingesting-hint">{t.upload.ingestingHint}</p>
            <p className="upload-ingesting-elapsed" aria-hidden="true">
              {fill(t.upload.ingestingElapsed, { seconds: elapsed })}
            </p>
            <div className="upload-ingesting-bar" aria-hidden="true">
              <span />
            </div>
          </div>
        ) : null}
        {status === 'ready' ? (
          <div className="upload-ready">
            <p className="upload-ready-label">{t.upload.readyLabel}</p>
            {sourceFiles.length > 0 ? (
              <p className="upload-grown-from">
                {t.upload.grownFrom}:{' '}
                {sourceFiles.map((name) => (
                  <span key={name} className="upload-source-chip">
                    {name}
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        ) : null}
        {status === 'error' ? (
          <div className="upload-error">
            <p className="upload-error-label">{t.upload.errorLabel}</p>
            {error ? <p className="upload-error-detail">{error}</p> : null}
            <button type="button" className="lite-btn lite-btn--ghost upload-retry" onClick={() => inputRef.current?.click()}>
              {t.upload.retry}
            </button>
          </div>
        ) : null}
        {status === 'idle' ? <p className="upload-empty">{t.upload.empty}</p> : null}
      </div>

      {/* feat-047 移植（feat-032）·「你的文件」持久清单——回看上传过哪些材料、Avery 的记忆
          基于什么。files-hub-0729/01：渲染搬进共享件 FileManifest（资料库屏的「当前资料」
          用的是同一个组件，多带一个下载列）。DOM 形状与类名一个字节没动。
          🔴 `showFiles={false}` 是给资料库屏用的：那一屏在上传口**上方**已经有一份清单了，
          这里再渲染一遍会出现两个 `.upload-files`，门按类名全局取样会数出双倍行数。 */}
      {showFiles ? <FileManifest /> : null}

      <p className="upload-privacy-note">{t.upload.privacyNote}</p>

      {/* partner-docs-0728 · 上传口旁边的两条链接。顺序是首访者真实的提问顺序：
          先「我到底该发什么给你」，再「你拿到之后会怎么处理」。两条都去 /paperwork。
          🔴 用 <Link> + paperworkHref()（带粘性 query）而不是裸 <a href="/paperwork">：
          丢了 `?v=2` 整个壳会掉回 v01，而 v01 里根本没有这条路由（routes.ts 同款纪律）。
          站内导航不会打断正在跑的 ingest——上传状态活在模块级 store 里，不随路由卸载。 */}
      <p className="upload-paperwork-links">
        <Link className="upload-paperwork-link" to={paperworkHref()}>
          {t.upload.paperworkFormsLink}
        </Link>
        <Link className="upload-paperwork-link" to={paperworkHref()}>
          {t.upload.paperworkPrivacyLink}
        </Link>
      </p>
    </section>
  )
}
