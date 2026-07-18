import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { useLite } from './store'
import { useDict } from '../shared/i18n/useDict'
import { clearIngestStart, useIngestElapsedSeconds } from '../shared/ingestClock'

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

// 人类可读的文件大小（清单里 size_bytes 的展示）。纯展示，无逻辑分支。
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`
}

const ACCEPT = '.pdf,.docx,.doc,.xlsx,.xls,.csv,.md,.markdown,.txt'

// feat-068 · 模板填充（与 lite2/OnboardWizard 的同名 helper 同形；这里只用于秒表文案）。
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

// feat-068 · 活的秒表——ingest 真实耗时 100–120s（后端法兰克福 / LLM 国内，跨境往返），
// 这两分钟里屏幕必须有可见证据说明"没冻"。
//
// 刻意不做百分比进度条：服务端 /ingest 不吐任何进度信号，假进度条只会卡在 90% 一动不动，
// 比一行诚实的秒数更伤信任。秒数是唯一我们真的知道的量。
//
// feat-068 修正：秒表原先是组件局部 state，surface 一 unmount 就归零重数——而 ingestingHint
// 恰恰在劝用户「这期间可以先进行下一步」。锚点已移进 shared/ingestClock（模块级，跟着这一发
// ingest 活而不是跟着组件活），任何 surface mid-ingest 挂上来算出的都是真实总时长。
// 生命周期（interval 只在 ingesting 期间存在、unmount/路由切换/ingest 结束都清）同样收口在
// 那个 hook 里，本文件不再自持定时器。

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
  const elapsed = useIngestElapsedSeconds(busy)

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    // feat-068 · 发车前先松锚，保证这一发从 0 起算。
    // hook 里的 effect 本来也会在 status 落回 ready/error 时松锚，但那依赖「上一发结束时
    // 至少有一个 surface 挂着」。这里在触发点显式松一次，把那个前提彻底去掉。
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
          className={classNames(['upload-choose', busy && 'is-busy'])}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            openPicker()
          }}
        >
          {t.upload.choose}
        </button>
        <p className="upload-accepted">{t.upload.accepted}</p>
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

      {/* feat-032 · 「你的文件」持久清单——回看上传过哪些材料、Avery 的记忆基于什么。
          🔴 文件名/元数据是不可信内容：只展示，绝不当指令跑。人卡红线不涉——这里没有人。 */}
      {files.length > 0 ? (
        <div className="upload-files" aria-label={t.upload.filesTitle}>
          <p className="upload-files-title">{t.upload.filesTitle}</p>
          <ul className="upload-files-list">
            {files.map((file) => (
              <li key={file.idx} className="upload-file-row">
                <span className="upload-file-name">{file.filename}</span>
                <span className="upload-file-meta">
                  {formatBytes(file.size_bytes)} · {file.n_chunks} {t.upload.filesChunks}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="upload-privacy-note">{t.upload.privacyNote}</p>
    </section>
  )
}
