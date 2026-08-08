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

// 词典占位符替换（与 FilesScreen / AskCard / OnboardWizard 的 fill 同形——本仓有十多份各自
// 独立的拷贝，没有共享导出；这里照惯例再放一份，不为一个三行函数新开一个 shared 模块）。
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

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

// 服务端时刻 → 经理这台机器的本地时刻，`YYYY-MM-DD HH:mm`。**这是仓库里唯一一份**——
// #76 把清单的上传时间列接上时，从 FilesScreen 搬过来并由那边反过来 import（同一格数字
// 两处各算一遍迟早漂）。
//
// 🔴 不能照抄别处那句 `iso.slice(0, 16).replace('T', ' ')`（AskCard 那行就是这么写的）：
// 后端发的是**带时区的 UTC 瞬间**（`datetime.now(timezone.utc).isoformat()`，pg 侧是
// timestamptz 的 isoformat），切片会把 `+00:00` 一起切掉，于是屏幕上那串数字被当成本地
// 墙上时钟读——对 UTC+8 的经理**恒早八小时，还经常连日期都差一天**。「周五截止前交的」
// 会显示成周四晚上，那是对着证据说假话。员工那张 H5 是靠在同一串数字后面印一个 " UTC"
// 躲开这件事的（form_api.py 的 `_submitted_extra`）；经理这一格不印，就必须真换算。
//
// 用 `new Date(iso)` 让浏览器解析偏移量（带 `+00:00` 或 `Z` 都认），再用**本地**取值器
// 逐位拼——全程没有一次手写的时区加减，那正是这类 bug 的来源。解析不出来就原样回退，
// 宁可显示一串原始 ISO，也不显示一个算错的时刻。
export function localStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ')
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// #76 · 客户端排序。恒按 idx（上传序）是此前唯一的顺序——传过三批之后，「上周那份」得靠
// 记忆去数第几行。排序纯客户端，契约零变动（uploaded_at/size_bytes 早就在 payload 里）。
// 🔴 `[...files]` 复制一份再排：`useLite` 给的是 store 里那个数组本体，原地 sort 会把
// store 的顺序也改了——下一次 refreshFiles 之前，别的读者（askRefs 的候选、下载的 idx
// 归属）看到的就是一个被 UI 偏好重排过的清单。
export type FileSortKey = 'idx' | 'time' | 'name' | 'size'

export function sortFiles<T extends {
  idx: number; filename: string; size_bytes: number; uploaded_at: string
}>(files: readonly T[], key: FileSortKey): T[] {
  const out = [...files]
  if (key === 'time') {
    // 时间缺席/解析不出来的排到最后（absent≠"很久以前"）——不许让一份没有时间戳的文件
    // 冒充成最老的那一份。
    const at = (f: T) => {
      const ms = new Date(f.uploaded_at).getTime()
      return Number.isNaN(ms) ? -Infinity : ms
    }
    out.sort((a, b) => at(b) - at(a) || a.idx - b.idx)
  } else if (key === 'name') {
    // localeCompare：中文文件名按 ASCII 码位排出来的顺序对经理毫无意义。
    out.sort((a, b) => a.filename.localeCompare(b.filename) || a.idx - b.idx)
  } else if (key === 'size') {
    out.sort((a, b) => b.size_bytes - a.size_bytes || a.idx - b.idx)
  }
  return out
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
  // #76 排序偏好 / #77 删除的两段确认——都是这一屏的本地展示态，不进 store。
  const [sort, setSort] = useState<FileSortKey>('idx')
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const deleteFile = useLite((s) => s.deleteFile)
  const deletingKey = useLite((s) => s.fileDeleting)
  const deleteError = useLite((s) => s.fileDeleteError)
  const canDelete = useLite((s) => !!s.transport.deleteFile)

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
  // #77 · 能力探测：这条通道没有 deleteFile（stub / 老后端）就**一个删除键都不渲染**。
  // 「不建假按钮」红线在这一格的样子——同 AppendSection 的 canAppend 先例。
  const showDelete = withDownload && !!contextId && canDelete
  const rows = sortFiles(files, sort)

  return (
    <div className="upload-files" aria-label={t.upload.filesTitle}>
      <div className="upload-files-head">
        <p className="upload-files-title">{t.upload.filesTitle}</p>
        {/* #76 · 排序。两份以下没有可排的东西，控件也就不该占位。 */}
        {files.length > 1 ? (
          <label className="upload-files-sort">
            <span className="upload-files-sort-label">{t.upload.filesSortLabel}</span>
            <select
              className="upload-files-sort-select"
              value={sort}
              onChange={(e) => setSort(e.target.value as FileSortKey)}
            >
              <option value="idx">{t.upload.filesSortDefault}</option>
              <option value="time">{t.upload.filesSortTime}</option>
              <option value="name">{t.upload.filesSortName}</option>
              <option value="size">{t.upload.filesSortSize}</option>
            </select>
          </label>
        ) : null}
      </div>
      <ul className="upload-files-list">
        {rows.map((file) => {
          const view = fileStatusView(file.status)
          const isPending = pending === file.idx
          const key = file.source_key || file.filename
          const isDeleting = deletingKey === key
          const confirming = confirmKey === key
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
              {/* 🔴 既有那两格（大小 · N 处引用）原样在前：filesSurfaceV2 按 `.upload-file-meta`
                  的文本取样（要有数字、要匹配 chunk|reference）。时间**追加**在后面，不替换。
                  上传时间从 feat-032 起就在 payload 里、一直没渲染——传过三批之后分不出哪份是
                  上周的（#76 病根之一）。 */}
              <span className="upload-file-meta">
                {formatBytes(file.size_bytes)} · {file.n_chunks} {t.upload.filesChunks}
                {file.uploaded_at ? (
                  <span className="upload-file-time"> · {localStamp(file.uploaded_at)}</span>
                ) : null}
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
              {/* ── #77 · 删除。销毁类**必须二段**：第一下只把确认条打开，真删在第二下。 ──
                  逐条置灰不整排（同 formsVoiding 的理由：整排置灰会让连删两份的第二下看
                  起来像没反应）；下载那颗按钮的整排置灰是它自己的并发语义，别抄过来。 */}
              {showDelete && !confirming ? (
                <button
                  type="button"
                  className="lite-btn lite-btn--ghost upload-file-delete"
                  disabled={isDeleting || deletingKey !== null}
                  aria-busy={isDeleting}
                  onClick={() => setConfirmKey(key)}
                >
                  {isDeleting ? t.upload.deleting : t.upload.delete}
                </button>
              ) : null}
              {view.hintKey ? (
                <span className="upload-file-status-hint" style={FILE_HINT_STYLE}>
                  {t.upload[view.hintKey]}
                </span>
              ) : null}
              {showDelete && confirming ? (
                <div className="upload-file-delete-confirm" role="alertdialog" aria-live="polite">
                  <p className="upload-file-delete-title">
                    {fill(t.upload.deleteConfirmTitle, { name: file.filename })}
                  </p>
                  {/* 正文要说清**还有什么会跟着变**——删一份文档会重建记忆面，卡片上来自它
                      的读数会失去出处。不预告这一句，经理会以为只是清单少一行。 */}
                  <p className="upload-file-delete-body">{t.upload.deleteConfirmBody}</p>
                  <button
                    type="button"
                    className="lite-btn lite-btn--ghost upload-file-delete-cancel"
                    onClick={() => setConfirmKey(null)}
                  >
                    {t.upload.deleteCancel}
                  </button>
                  <button
                    type="button"
                    className="lite-btn upload-file-delete-go"
                    disabled={deletingKey !== null}
                    onClick={() => {
                      setConfirmKey(null)
                      void deleteFile(key)
                    }}
                  >
                    {t.upload.deleteConfirmAction}
                  </button>
                </div>
              ) : null}
              {deleteError === key ? (
                <span className="upload-file-delete-error" role="status" style={FILE_ERROR_STYLE}>
                  {t.upload.deleteError}
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
