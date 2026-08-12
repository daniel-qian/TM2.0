import { useState, type CSSProperties, type ReactNode } from 'react'
import { useLite } from './store'
import { useDict } from '../shared/i18n/useDict'
import { CaretDownIcon, DocIcon, DownloadIcon, OverflowIcon, TrashIcon } from './icons'

// files-hub-0729/01 ·「你的文件」清单——从 UploadPanel 抽出来的共享件。
//
// ## 为什么抽
// 资料库屏的第一段「当前资料」和上传口底下的那份清单是**同一份东西**。原来只有后者，
// 渲染逻辑（人类可读大小 / 状态徽章 / 缺席≠成功的口径）全长在 UploadPanel 里。资料库屏
// 要是照着再写一份，两份就会各自漂——本仓已经有过一次代价（「这台电脑上传过的公司」
// 那一族 12 个孤儿键：UI 被一次合并整块吃掉，copy 留在原地，store 侧还活着，谁都没发现。
// 那些键最终在 #88 随「新建一家公司」整条撤除，但教训是**抽出来的这一份**）。
// ⚠ 这里刻意**不写具体键名**：`i18n-orphans` 的 `bareAccessRe` 扫的是文件原文、
//   注释一并算数，在注释里点名一个键就等于**永久**把它从孤儿名单上摘掉。
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
// #84 · `export`：工作台页头那一行「9 份 · 共 18.8 KB · 212 处可引用片段」要用同一把尺子
// 换算合计字节。抄第二份出去 = 表格里每行说 KB、页头合计说另一种进位。
export function formatBytes(bytes: number): string {
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
  labelKey:
    | 'fileStatusIngested'
    | 'fileStatusEmpty'
    | 'fileStatusFailed'
    | 'fileStatusUnknown'
    | 'fileStatusReading'
  hintKey: 'fileStatusEmptyHint' | 'fileStatusFailedHint' | null
  tone: 'ok' | 'warn' | 'bad' | 'unknown' | 'busy'
}

function fileStatusView(status: string | undefined): FileStatusView {
  switch (status) {
    case 'ingested':
      return { labelKey: 'fileStatusIngested', hintKey: null, tone: 'ok' }
    case 'empty':
      return { labelKey: 'fileStatusEmpty', hintKey: 'fileStatusEmptyHint', tone: 'warn' }
    case 'failed':
      return { labelKey: 'fileStatusFailed', hintKey: 'fileStatusFailedHint', tone: 'bad' }
    // #90/#91 · 中间态：字节已收下、worker 还在逐页读。store 的内部轮询每一轮都把清单写回
    // state，所以这一行是**活**的——任务落定它就翻成上面三个终态之一（失败时整行被服务端收走）。
    // 无 hint：上传进度块（表格顶那一行）已经在讲同一件事，行内再来一句就是第二个真相。
    case 'reading':
      return { labelKey: 'fileStatusReading', hintKey: null, tone: 'busy' }
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
  // #91 · 'reading' 中间态与等待块的 honey 同族（正在进行，不是警告也不是完成）；
  // 文字用 AA 校准过的 --honey-text 档，转点动画吃 currentColor（见 lite2.css 的
  // `[data-status='reading']` 那条——tone 只管颜色，动没动由 data-status 说了算）。
  busy: 'var(--honey-text, var(--honey, #b8860b))',
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

// #84 · 自绘排序控件。原生 `<select>` 是"没上皮肤"在资料库那块屏上最刺眼的一处
//（系统箭头 + 系统字号 + 系统焦点环，三样都不跟皮肤走）。
// 🔴 标签与当前值之间的分隔靠 CSS 间距，**不写任何标点字面量**——同一族碑在
//    FilesScreen 的 `{l.formsFieldsLead}：{preview}` 上立过：硬编码的全角冒号会原样漏进
//    英文壳，而 i18n 门看不见它。
export function FileSortControl(
  { sort, onChange }: { sort: FileSortKey; onChange: (k: FileSortKey) => void },
) {
  const { t } = useDict()
  const [open, setOpen] = useState(false)
  const options: Array<{ key: FileSortKey; label: string }> = [
    { key: 'idx', label: t.upload.filesSortDefault },
    { key: 'time', label: t.upload.filesSortTime },
    { key: 'name', label: t.upload.filesSortName },
    { key: 'size', label: t.upload.filesSortSize },
  ]
  const current = options.find((o) => o.key === sort) ?? options[0]
  return (
    <div
      className="upload-files-sort"
      // 点到控件外面就收起。用 blur 而不是 document 级 mousedown 监听：后者要在 effect 里
      // 装卸，而这枚控件在表格重渲染时进进出出，装卸时序出错就会留下一个永远关不上的菜单。
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false)
      }}
    >
      <button
        type="button"
        className="lite-btn lite-btn--ghost upload-files-sort-toggle"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="upload-files-sort-label">{t.upload.filesSortLabel}</span>
        <span className="upload-files-sort-current">{current.label}</span>
        <CaretDownIcon />
      </button>
      {open ? (
        <div className="upload-files-sort-menu" role="listbox" aria-label={t.upload.filesSortLabel}>
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              role="option"
              aria-selected={o.key === sort}
              className="lite-btn lite-btn--ghost upload-files-sort-option"
              data-sort-key={o.key}
              onClick={() => {
                onChange(o.key)
                setOpen(false)
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
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
  /**
   * #84 · 资料库工作台的**真列表格**形态（`grid-template-columns` 钉死列宽）。
   * 缺省仍是上传口底下那份紧凑清单——那一份的 DOM 一个字节没动（`.upload-file-meta`
   * 那个合并格还在），因为它的消费者（首页骨架卡、引导闸、v01 镜像）没有列可对齐。
   */
  table?: boolean
  /**
   * 受控排序。工作台把控件摆到**工具条**上（规格 §2.4.6），所以状态得提到屏那一层；
   * 不传就是组件自己管、自己在清单头上画一枚。
   */
  sort?: FileSortKey
  onSortChange?: (k: FileSortKey) => void
  /**
   * 工具条那格「按文件名筛」。只筛**文件名**，不筛内容——后端没有全文检索端点，
   * 一个许诺"在这些文件里找"的框会让人以为搜得到正文（原型上那句 copy 就是这么写的，
   * 产品里改成了「按文件名筛…」）。
   */
  filter?: string
  /** 表格顶端那一行（上传进度）。只在 `table` 形态下渲染。 */
  topRow?: ReactNode
}

export function FileManifest({
  withDownload = false, table = false, sort: sortProp, onSortChange, filter, topRow,
}: FileManifestProps) {
  const { t } = useDict()
  const files = useLite((s) => s.files)
  const contextId = useLite((s) => s.contextId)
  const downloadFile = useLite((s) => s.downloadFile)
  // 每行各自一份 pending/error：一行下载失败不该把别的行也染红，也不该占用全局 state
  // （下载是一次性动作，不是屏上的一份状态——见 store.downloadFile 的注释）。
  const [pending, setPending] = useState<number | null>(null)
  const [failed, setFailed] = useState<Record<number, true>>({})
  // #76 排序偏好 / #77 删除的两段确认——都是这一屏的本地展示态，不进 store。
  // #84 · 排序可受控（工作台把控件摆到工具条上）。不受控时仍走这一格。
  const [sortLocal, setSortLocal] = useState<FileSortKey>('idx')
  const sort = sortProp ?? sortLocal
  const setSort = onSortChange ?? setSortLocal
  // #84 · ≤860 的行尾溢出菜单。桌面那两枚钮 hover 即现、这枚开关被 CSS 收起，
  // 所以这一格 state 在桌面**永远不会被写**（不是「写了没用」，是根本点不到）。
  const [actsOpenKey, setActsOpenKey] = useState<string | null>(null)
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

  // #84 · 表格形态下，「还没有一行」也可能要渲染：第一次上传时表里 0 行，而进度就长在
  // 表格顶端那一行上（规格 §2.4.5）。缺了这条判断，首次上传的两分钟里整块表消失，
  // 进度条跟着一起消失——那正是「上传的东西最终会变成这张表的一行」要修的观感。
  if (files.length === 0 && !(table && topRow)) return null

  const showDownload = withDownload && !!contextId
  // #77 · 能力探测：这条通道没有 deleteFile（stub / 老后端）就**一个删除键都不渲染**。
  // 「不建假按钮」红线在这一格的样子——同 AppendSection 的 canAppend 先例。
  const showDelete = withDownload && !!contextId && canDelete
  const needle = (filter ?? '').trim().toLowerCase()
  // 🔴 筛掉的行是**看不见**，不是**不存在**：`files` 一个字节没动，所以 @ 引用候选、
  //    下载的 idx 归属、删除的 source_key 都不受这一格影响（同 sortFiles 复制一份再排
  //    的理由——UI 偏好不许改 store 里那份清单）。
  const rows = sortFiles(files, sort)
    .filter((f) => !needle || f.filename.toLowerCase().includes(needle))

  // ── 行动作（下载 / 删除 / 确认条）。两种形态共用一份接线，只有壳不同 ──────────────
  const downloadBtn = (file: (typeof rows)[number], isPending: boolean) => (
    <button
      type="button"
      className="lite-btn lite-btn--ghost upload-file-download"
      // 一次一份：别的行在下载时整排置灰，而不是让用户打出并发请求
      //（同 switchPending 那条"UI 有义务挡住第二次点击"的纪律）。
      disabled={pending !== null}
      aria-busy={isPending}
      aria-label={fill(isPending ? t.upload.downloadingAria : t.upload.downloadAria,
        { name: file.filename })}
      onClick={() => void downloadOne(file.idx, file.filename)}
    >
      {table ? <DownloadIcon /> : isPending ? t.upload.downloading : t.upload.download}
    </button>
  )

  const deleteBtn = (file: (typeof rows)[number], key: string, isDeleting: boolean) => (
    <button
      type="button"
      className="lite-btn lite-btn--ghost upload-file-delete"
      disabled={isDeleting || deletingKey !== null}
      aria-busy={isDeleting}
      aria-label={fill(t.upload.deleteAria, { name: file.filename })}
      onClick={() => setConfirmKey(key)}
    >
      {table ? <TrashIcon /> : isDeleting ? t.upload.deleting : t.upload.delete}
    </button>
  )

  const confirmBlock = (file: (typeof rows)[number], key: string) => (
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
  )

  // ══ #84 · 真列表格（资料库工作台）══════════════════════════════════════════════════
  // 🔴 这不是"给旧清单换个皮"，是把 **flex-wrap 的汤**换成结构固定的格子。旧实现整行是
  //    `flexWrap:'wrap'`，折行位置由**文件名长度**决定——390px 上 9 行量出 4 种高度、
  //    3 种内部顺序（`_shots-0810/files-mobile.png`）。这里每一格都有自己的类名：桌面靠
  //    `grid-template-columns` 钉死列宽，手机靠**逐格写死 grid-column/grid-row** 落位，
  //    两处都与内容长度无关。
  // 🔴 刻意**不用 `:nth-child()` 落位**（原型是那么写的，那里没有条件渲染）：hint /
  //    删除确认条 / 两种错误行都是条件渲染的兄弟节点，nth-child 会随它们的出现整体错位
  //    ——一条判据都不会红，屏上却是错乱的。所以额外内容一律收进**一个**
  //    `.upload-file-aside`，它自己也有显式落位。
  if (table) {
    return (
      <div className="upload-files upload-files--table" aria-label={t.upload.filesTitle}>
        <ul className="upload-files-list">
          {/* 列头是**视觉**表头：每一格的语义已经由它自己的文本承载（大小带单位、时刻是
              时刻、状态是一句话），读屏再听一遍列名只是重复。所以整条 aria-hidden。
              🔴 它必须**住在滚动容器里面**（sticky），不能当 `<ul>` 的兄弟：列表是
                 `overflow-y:auto` 的，滚动条一出现就把行的内容宽压窄 2px 而列头不变——
                 于是整张表的列头与数据错开 2px。写这道门时当场量到（572 vs 570）。 */}
          {rows.length > 0 ? (
            <li className="upload-files-colhead" aria-hidden="true">
              <span className="upload-file-name">{t.upload.filesColName}</span>
              <span className="upload-file-size">{t.upload.filesColSize}</span>
              <span className="upload-file-chunks">{t.upload.filesColChunks}</span>
              <span className="upload-file-time">{t.upload.filesColTime}</span>
              <span className="upload-file-status">{t.upload.filesColStatus}</span>
              <span className="upload-file-acts" />
            </li>
          ) : null}
          {/* 上传进度就长在表格顶端那一行里——上传的东西最终会变成这张表的一行，
              进度就不该另开一块面板（规格 §2.4.5）。 */}
          {topRow}
          {rows.map((file) => {
            const view = fileStatusView(file.status)
            const isPending = pending === file.idx
            const key = file.source_key || file.filename
            const isDeleting = deletingKey === key
            const confirming = confirmKey === key
            const actsOpen = actsOpenKey === key
            const aside = Boolean(view.hintKey) || (showDelete && confirming) ||
              deleteError === key || Boolean(failed[file.idx]) || actsOpen
            return (
              <li
                key={file.idx}
                className="upload-file-row"
                data-status={file.status ?? 'unknown'}
                data-acts-open={actsOpen ? '1' : '0'}
              >
                <span className="upload-file-name">
                  <DocIcon />
                  <span className="upload-file-name-text">{file.filename}</span>
                </span>
                <span className="upload-file-size">{formatBytes(file.size_bytes)}</span>
                <span className="upload-file-chunks">
                  {file.n_chunks}
                  {/* 手机上没有列头，所以数字要自带单位，否则 18 是个无名数。
                      🔴 单位走词典、**不写进 CSS 的 `content`**：::after 的字面量在英文壳上
                         照样印中文，而 i18n 门与 zh-purity 都扫不到 CSS。原型里那句
                         `content:' 片段'` 是原型的自由，产品代码不许抄。 */}
                  <span className="upload-file-chunks-unit">{t.upload.filesChunksShort}</span>
                </span>
                <span className="upload-file-time">
                  {file.uploaded_at ? localStamp(file.uploaded_at) : ''}
                </span>
                {/* fixB1/M4 · 每一行都表态，包括成功的那些——只给失败的加标记，用户就得靠
                    "没有标记" 反推 "读进去了"，那仍然是让人猜。
                    🔴 圆点吃 `currentColor` 而不是自己一套色阶：文字色是 AA 校准过的
                       `--*-text` 档，圆点另开一档就会出现「点是亮的、字是深的」两种真相。 */}
                <span
                  className="upload-file-status"
                  data-tone={view.tone}
                  style={{ color: STATUS_TONE_COLOR[view.tone] }}
                >
                  <i className="upload-file-status-dot" aria-hidden="true" />
                  {t.upload[view.labelKey]}
                </span>
                {/* 🔴 这一格**恒占位**（showDownload 为假时是个空格子）：列数一变，整张表的
                    竖轴就跟着变——而"每一格都在同一条竖线上"正是本票要买的东西。 */}
                <span className="upload-file-acts">
                  {showDownload ? downloadBtn(file, isPending) : null}
                  {showDelete && !confirming ? deleteBtn(file, key, isDeleting) : null}
                  {/* ≤860 的行尾溢出菜单开关。桌面被 CSS 收起（那里 hover 直接现两枚钮）。 */}
                  {showDownload || showDelete ? (
                    <button
                      type="button"
                      className="lite-btn lite-btn--ghost upload-file-overflow"
                      aria-expanded={actsOpen}
                      aria-label={fill(t.upload.rowActionsAria, { name: file.filename })}
                      onClick={() => setActsOpenKey(actsOpen ? null : key)}
                    >
                      <OverflowIcon />
                    </button>
                  ) : null}
                </span>
                {aside ? (
                  <div className="upload-file-aside">
                    {view.hintKey ? (
                      <span className="upload-file-status-hint" style={FILE_HINT_STYLE}>
                        {t.upload[view.hintKey]}
                      </span>
                    ) : null}
                    {/* 手机溢出菜单展开后两枚钮落在这一格里（桌面这一支永不成立：
                        开关钮 display:none，actsOpenKey 写不进去）。 */}
                    {actsOpen ? (
                      <span className="upload-file-acts-menu">
                        {showDownload ? downloadBtn(file, isPending) : null}
                        {showDelete && !confirming ? deleteBtn(file, key, isDeleting) : null}
                      </span>
                    ) : null}
                    {showDelete && confirming ? confirmBlock(file, key) : null}
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
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
        {/* 筛没筛到要说出来。零结果时什么都不画，屏上和"这个档案是空的"长得一模一样
            ——而这两件事差着一个用户刚打进去的关键词。 */}
        {needle && rows.length === 0 ? (
          <p className="upload-files-nomatch" role="status">
            {fill(t.upload.filesNoMatch, { q: filter ?? '' })}
          </p>
        ) : null}
      </div>
    )
  }

  // ══ 紧凑清单（上传口底下那份）· DOM 一个字节没动 ═══════════════════════════════════
  return (
    <div className="upload-files" aria-label={t.upload.filesTitle}>
      <div className="upload-files-head">
        <p className="upload-files-title">{t.upload.filesTitle}</p>
        {/* #76 · 排序。两份以下没有可排的东西，控件也就不该占位。
            #84 · 原生 `<select>` 换自绘控件——两个消费者共用同一枚（那枚系统箭头在资料库屏
            上最刺眼，但它在别处也一样没上皮肤）。 */}
        {files.length > 1 ? <FileSortControl sort={sort} onChange={setSort} /> : null}
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
              <span
                className="upload-file-status"
                data-tone={view.tone}
                style={{ ...FILE_STATUS_STYLE, color: STATUS_TONE_COLOR[view.tone] }}
              >
                {t.upload[view.labelKey]}
              </span>
              {showDownload ? downloadBtn(file, isPending) : null}
              {/* ── #77 · 删除。销毁类**必须二段**：第一下只把确认条打开，真删在第二下。 ──
                  逐条置灰不整排（同 formsVoiding 的理由：整排置灰会让连删两份的第二下看
                  起来像没反应）；下载那颗按钮的整排置灰是它自己的并发语义，别抄过来。 */}
              {showDelete && !confirming ? deleteBtn(file, key, isDeleting) : null}
              {view.hintKey ? (
                <span className="upload-file-status-hint" style={FILE_HINT_STYLE}>
                  {t.upload[view.hintKey]}
                </span>
              ) : null}
              {showDelete && confirming ? confirmBlock(file, key) : null}
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
