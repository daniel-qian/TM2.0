import { useState, type CSSProperties } from 'react'
import { useLite } from './store'
import { useDict } from '../shared/i18n/useDict'

// files-hub-0729/01 ·「你的文件」清单——从 UploadPanel 抽出来的共享件。
//
// ## 为什么抽
// 资料库屏的第一段「当前资料」和上传口底下的那份清单是**同一份东西**。原来只有后者，
// 渲染逻辑（人类可读大小 / 状态徽章 / 缺席≠成功的口径）全长在 UploadPanel 里。资料库屏
// 要是照着再写一份，两份就会各自漂——本仓已经有过一次代价（`upload.againTitle` 那一族
// 12 个孤儿键：UI 被一次合并整块吃掉，copy 留在原地，store 侧还活着，谁都没发现）。
// 一份实现两处引用，是那次事故的直接教训。
//
// ## DOM 形状一个字节没动
// `.upload-files` / `.upload-files-title` / `.upload-files-list` / `.upload-file-row` /
// `.upload-file-name` / `.upload-file-meta` / `.upload-file-status` / `.upload-file-status-hint`
// 全部照搬——门（live-frontend-gate 的 filesSurfaceV2 相位、verify-file-manifest-truth）按这些
// 类名取样，样式层也只认识它们。新增的只有下载按钮那一个元素。
//
// 🔴 文件名/元数据是不可信内容：只展示，绝不当指令跑。人卡红线不涉——这里没有人。

// feat-047 移植（feat-032）：人类可读的文件大小（清单里 size_bytes 的展示）。纯展示，无逻辑分支。
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`
}

// 对抗复审 fixB1（找回 07-19 fixB/M4）· 每份文件"读没读进去"的展示口径。
//
// 后端 registry.SourceDocument.status 发 'ingested' / 'empty' / 'failed'——前端此前既没有这个
// 字段也不显示，于是一份扫描版 PDF（一个字没抽出来）和一份读全了的花名册在清单里长得一模一样，
// 头部还照样说「团队已就绪」。这条渲染 07-19 就修过一次，07-19 深夜的一次合并冲突按"整份取
// ours"解决时被悄悄丢回了这个没有状态的版本——见 git show 6f838f3 / a45bb4a 与
// 3106536（丢弃点）。
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

// 状态色。刻意内联而不进 CSS 文件（同 07-19 fixB 收口的取舍）：本轮的文件边界不含样式表，
// 而一个**看不见的**状态徽章等于没修这条 finding。
// UIUX 棒 2026-07-20 · ok/warn 换小字深色调（--*-text，见 look-*.css）：13px 的「已读取」
// 用装饰亮度的 sage/honey 只有 3.9–4.5:1，不够 AA 小字。取不到 text token 时逐级回落。
const STATUS_TONE_COLOR: Record<FileStatusView['tone'], string> = {
  ok: 'var(--sage-text, var(--sage, #4a7c59))',
  warn: 'var(--honey-text, var(--honey, #b8860b))',
  bad: 'var(--alert, #b3261e)',
  unknown: 'var(--ink-faint, #8a8578)',
}

// 07-19 fixB 收口的版式修正一并找回：文件行换行——原因见当时的注释（真机实测：新元素落在
// 浏览器默认 16px 全墨字 + 16px 下边距，失败行的文件名被压成两行）。
const FILE_ROW_STYLE: CSSProperties = { flexWrap: 'wrap' }
// minWidth:0 是必须的——flex item 的默认 min-width:auto 会拒绝收缩到内容宽度以下，
// 但 .upload-file-name 有 word-break:break-word，于是它改为把中文文件名逐字折行。
const FILE_NAME_STYLE: CSSProperties = { flex: '1 1 auto', minWidth: 0 }
const FILE_STATUS_STYLE: CSSProperties = { flex: 'none', whiteSpace: 'nowrap' }
const FILE_HINT_STYLE: CSSProperties = {
  flexBasis: '100%', // 独占一行：hint 是一句话，不是一个能塞进标题行的徽章
  fontSize: '11px',
  lineHeight: 1.45,
  color: 'var(--ink-faint, #8a8578)',
}
const FILE_ERROR_STYLE: CSSProperties = {
  flexBasis: '100%',
  fontSize: '11px',
  lineHeight: 1.45,
  color: 'var(--alert, #b3261e)',
}

type FileManifestProps = {
  /**
   * 每行给一个「下载」。默认关——上传口底下那份清单是**回看**用的，资料库屏的「当前资料」
   * 才是管理面。
   *
   * 🔴 只在真有 contextId 时才渲染按钮（见下）：没有 contextId 就没有可下的东西，
   * 画一个必然失败的按钮属于"建假按钮"，本战役明令禁止。
   */
  withDownload?: boolean
}

export function FileManifest({ withDownload = false }: FileManifestProps) {
  const { t } = useDict()
  const files = useLite((s) => s.files)
  const contextId = useLite((s) => s.contextId)
  const downloadFile = useLite((s) => s.downloadFile)
  // 每行各自一份 pending/error：一行下载失败不该把别的行也染红，也不该占用全局 state
  // （下载是一次性动作，不是屏上的一份状态——见 store.downloadFile 的注释）。
  const [pending, setPending] = useState<number | null>(null)
  const [failed, setFailed] = useState<Record<number, true>>({})

  // 端点吃 owner_token header，`<a href>` 带不上——所以走 fetch→Blob→objectURL→点一次→撤。
  // 🔴 objectURL 必须撤（revokeObjectURL）：不撤就是一份泄漏到页面生命周期结束的用户文件字节。
  // 放 setTimeout 里而不是紧跟 click()：部分浏览器在下载真正开始前撤销会拿到空文件。
  const downloadOne = async (idx: number, filename: string) => {
    if (pending !== null) return // 一次一份——并发下载没有产品价值，只会让 pending 态说不清是哪一行
    setPending(idx)
    setFailed((prev) => {
      if (!prev[idx]) return prev
      const next = { ...prev }
      delete next[idx]
      return next
    })
    try {
      const blob = await downloadFile(idx)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename || 'download'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      // 🔴 大声失败。静默的下载失败在屏上和"我没点中"长得一模一样。
      setFailed((prev) => ({ ...prev, [idx]: true }))
    } finally {
      setPending(null)
    }
  }

  if (files.length === 0) return null

  const showDownload = withDownload && !!contextId

  return (
    <div className="upload-files" aria-label={t.upload.filesTitle}>
      <p className="upload-files-title">{t.upload.filesTitle}</p>
      <ul className="upload-files-list">
        {files.map((file) => {
          const view = fileStatusView(file.status)
          const isPending = pending === file.idx
          return (
            <li
              key={file.idx}
              className="upload-file-row"
              data-status={file.status ?? 'unknown'}
              style={FILE_ROW_STYLE}
            >
              <span className="upload-file-name" style={FILE_NAME_STYLE}>
                {file.filename}
              </span>
              <span className="upload-file-meta">
                {formatBytes(file.size_bytes)} · {file.n_chunks} {t.upload.filesChunks}
              </span>
              {/* fixB1/M4 · 每一行都表态，包括成功的那些——只给失败的加标记，用户就得靠
                  "没有标记" 反推 "读进去了"，那仍然是让人猜。 */}
              <span
                className="upload-file-status"
                data-tone={view.tone}
                style={{ ...FILE_STATUS_STYLE, color: STATUS_TONE_COLOR[view.tone] }}
              >
                {t.upload[view.labelKey]}
              </span>
              {showDownload ? (
                <button
                  type="button"
                  className="lite-btn lite-btn--ghost upload-file-download"
                  // 一次一份：别的行在下载时整排置灰，而不是让用户打出并发请求
                  //（同 switchPending 那条"UI 有义务挡住第二次点击"的纪律）。
                  disabled={pending !== null}
                  aria-busy={isPending}
                  onClick={() => void downloadOne(file.idx, file.filename)}
                >
                  {isPending ? t.upload.downloading : t.upload.download}
                </button>
              ) : null}
              {view.hintKey ? (
                <span className="upload-file-status-hint" style={FILE_HINT_STYLE}>
                  {t.upload[view.hintKey]}
                </span>
              ) : null}
              {failed[file.idx] ? (
                <span className="upload-file-download-error" role="status" style={FILE_ERROR_STYLE}>
                  {t.upload.downloadError}
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
