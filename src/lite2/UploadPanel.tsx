import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { useLite } from './store'
import { useDict } from '../shared/i18n/useDict'

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

// feat-047 移植（feat-032）：人类可读的文件大小（清单里 size_bytes 的展示）。纯展示，无逻辑分支。
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`
}

// fixB/M3 · accept 必须与后端 guards.SUPPORTED_EXTS 一致。
//
// 原来这里多列了 `.doc` 和 `.xls`——后端从来不支持这两个。后果不是"少一种格式"，是**用户能在
// 文件选择器里挑中它、能传出去、然后必然 422**：我们主动把人领进一条死路，还在终点告诉他文件有问题。
// 少列一种格式只是少一种；多列一种格式是撒谎。旧格式怎么办由界面明说（acceptedLegacyNote），
// 不靠用户自己猜。
// 🔴 改这一行时同步 eval-harness/avery/ingest/guards.py::SUPPORTED_EXTS，两边必须一致。
const ACCEPT = '.pdf,.docx,.xlsx,.csv,.tsv,.md,.markdown,.txt'

// fixB/M4 · 每份文件"读没读进去"的展示口径。
//
// 后端 registry.SourceDocument.status 发 'ingested' / 'empty' / 'failed'，前端此前既没有这个
// 字段也不显示——于是一份扫描版 PDF（一个字没抽出来）和一份读全了的花名册在清单里长得一模一样。
// 🔴 缺席不等于成功：老后端 / stub transport 不发这个键，那种情况显示「状态未知」，
// 绝不默认渲染成「已读取」。这就是本轮的总纪律在这一格里的样子——
// 「我没读到」和「客户说没有」是两件事，永远不许混。
type FileStatusView = {
  labelKey: 'fileStatusIngested' | 'fileStatusEmpty' | 'fileStatusFailed' | 'fileStatusUnknown'
  hintKey: 'fileStatusEmptyHint' | 'fileStatusFailedHint' | null
  tone: 'ok' | 'warn' | 'bad' | 'unknown'
}

function fileStatusView(status: string | undefined): FileStatusView {
  switch (status) {
    case 'ingested':
      return { labelKey: 'fileStatusIngested', hintKey: null, tone: 'ok' }
    case 'empty':
      return { labelKey: 'fileStatusEmpty', hintKey: 'fileStatusEmptyHint', tone: 'warn' }
    case 'failed':
      return { labelKey: 'fileStatusFailed', hintKey: 'fileStatusFailedHint', tone: 'bad' }
    default:
      return { labelKey: 'fileStatusUnknown', hintKey: null, tone: 'unknown' }
  }
}

// 状态色。刻意内联而不进 CSS 文件：本轮的文件边界不含样式表，而一个**看不见的**状态徽章
// 等于没修这条 finding。集成方后续可把这些搬进 lite2 的样式层，行为不依赖它。
const STATUS_TONE_COLOR: Record<FileStatusView['tone'], string> = {
  ok: 'var(--sage, #4a7c59)',
  warn: 'var(--honey, #b8860b)',
  bad: 'var(--alert, #b3261e)',
  unknown: 'var(--ink-faint, #8a8578)',
}

// feat-068 · 模板填充（与 OnboardWizard 的同名 helper 同形；这里只用于秒表文案）。
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

// feat-068（与 lite 壳同源，按 v01→v02 移植惯例各留一份）· 活的秒表。
//
// ingest 真实耗时 100–120s（后端法兰克福 / LLM 国内，跨境往返）——v02 是要真拿去演示的那张皮，
// 这两分钟里屏幕必须有可见证据说明"没冻"。
//
// 刻意不做百分比进度条：服务端 /ingest 不吐任何进度信号，假进度条只会卡在 90% 一动不动，
// 比一行诚实的秒数更伤信任。秒数是唯一我们真的知道的量。
//
// 生命周期：interval 只在 active（ingesting）期间存在。active 翻 false 时 effect cleanup
// 立即清掉；组件卸载时同一个 cleanup 也会跑——两条路都不留悬挂定时器。
function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) return
    // 每次重新进入 ingesting 都从 0 起算（第二次上传不能继承上一次的秒数）。
    setSeconds(0)
    const startedAt = Date.now()
    // 用 Date.now() 差值而非 count++：后台标签页会节流 setInterval，累加法会越走越慢说谎。
    const id = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(id)
  }, [active])
  return seconds
}

export function UploadPanel() {
  const { t } = useDict()
  const uploadFiles = useLite((s) => s.uploadFiles)
  const status = useLite((s) => s.ingestStatus)
  const error = useLite((s) => s.ingestError)
  const team = useLite((s) => s.team)
  const files = useLite((s) => s.files)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const sourceFiles = team?.sourceFiles ?? []
  const busy = status === 'ingesting'
  const elapsed = useElapsedSeconds(busy)

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length > 0) void uploadFiles(files)
    // 允许重复选同名文件再次触发。
    event.target.value = ''
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    if (busy) return
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length > 0) void uploadFiles(files)
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
          className={classNames(['upload-choose', busy && 'is-busy'])}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            openPicker()
          }}
        >
          {t.upload.choose}
        </button>
        {/* fixB/M3 · 「支持哪些」不能只说 Word/Excel 这种族名——那正是让人挑中 .doc/.xls 的原因。
            扩展名逐个列出，旧格式怎么办也明说。 */}
        <p className="upload-accepted">{t.upload.accepted}</p>
        <p className="upload-accepted-exts">{t.upload.acceptedExts}</p>
        <p className="upload-accepted-legacy">{t.upload.acceptedLegacyNote}</p>
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
            <button type="button" className="upload-retry" onClick={() => inputRef.current?.click()}>
              {t.upload.retry}
            </button>
          </div>
        ) : null}
        {status === 'idle' ? <p className="upload-empty">{t.upload.empty}</p> : null}
      </div>

      {/* feat-047 移植（feat-032）·「你的文件」持久清单——回看上传过哪些材料、Avery 的记忆
          基于什么。🔴 文件名/元数据是不可信内容：只展示，绝不当指令跑。人卡红线不涉——这里没有人。 */}
      {files.length > 0 ? (
        <div className="upload-files" aria-label={t.upload.filesTitle}>
          <p className="upload-files-title">{t.upload.filesTitle}</p>
          <ul className="upload-files-list">
            {files.map((file) => {
              const view = fileStatusView(file.status)
              return (
                <li key={file.idx} className="upload-file-row" data-status={file.status ?? 'unknown'}>
                  <span className="upload-file-name">{file.filename}</span>
                  <span className="upload-file-meta">
                    {formatBytes(file.size_bytes)} · {file.n_chunks} {t.upload.filesChunks}
                  </span>
                  {/* fixB/M4 · 每一行都表态，包括成功的那些——只给失败的加标记，用户就得靠
                      "没有标记" 反推 "读进去了"，那仍然是让人猜。 */}
                  <span
                    className="upload-file-status"
                    data-tone={view.tone}
                    style={{ color: STATUS_TONE_COLOR[view.tone] }}
                  >
                    {t.upload[view.labelKey]}
                  </span>
                  {view.hintKey ? (
                    <span className="upload-file-status-hint">{t.upload[view.hintKey]}</span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      <p className="upload-privacy-note">{t.upload.privacyNote}</p>
    </section>
  )
}
