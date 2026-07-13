import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
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

// 人类可读的文件大小（清单里 size_bytes 的展示）。纯展示，无逻辑分支。
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`
}

const ACCEPT = '.pdf,.docx,.doc,.xlsx,.xls,.csv,.md,.markdown,.txt'

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

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length > 0) void uploadFiles(files)
    // 允许重复选同名文件再次触发。
    event.target.value = ''
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length > 0) void uploadFiles(files)
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
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
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
        <button type="button" className="upload-choose" onClick={(e) => {
          e.stopPropagation()
          inputRef.current?.click()
        }}>
          {t.upload.choose}
        </button>
        <p className="upload-accepted">{t.upload.accepted}</p>
      </div>

      <div className="upload-status" aria-live="polite">
        {status === 'ingesting' ? <p className="upload-ingesting">{t.upload.ingestingLabel}</p> : null}
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
