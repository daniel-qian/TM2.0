import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useLite } from './store'
import { useDict } from '../shared/i18n/useDict'
import { AttachIcon, StopIcon } from './icons'
import type { Dict } from '../shared/i18n'
import {
  MAX_REF_OPTIONS,
  pickRefOptions,
  searchAskRefs,
  type AskRef,
  type AskRefFilter,
} from './askRefs'

// #64 · @ 引用 composer——议事室常驻输入框与悬浮胶囊共用的一层（交互考古自 7b03982^ 的
// LiteComposer，抄交互不抄提交层：这里把选中的引用作为**结构化 refs** 交给 onSubmit，
// 织文/发请求归调用方）。
//
// 交互模型（combobox 模式）：
//   · 输入框里打 `@` → 弹候选层（光标前最近一个 @ 到光标之间的字就是搜索词，随打随筛）；
//   · 五个筛选 chip（全部/人员/项目/文件/方法）——旧引用菜单是 all/person/project 三个，
//     本票把候选轴扩到票面拍板的四类；
//   · ↑/↓ 走高亮、Enter 选中、Esc 关层（层关着时 Esc 才透传给宿主——悬浮胶囊靠它收起）；
//   · 选中：`@词` 从文字里摘掉、长出 chip；chip 上的移除键可点可 Tab（键盘可达）。
//   · 重名候选按部门消歧（FilesScreen dupeNames 口径，全量花名册算重名，不按检索结果算）。
//
// 🔴 DOM 纪律：静息态（无 chip、层没开）渲染出的 DOM 与改造前逐字节等价（只多了 input 上的
// combobox aria 属性）——像素基线与 room-usability 的几何判据都锚在静息态上。
// 🔴 按钮族：筛选 chip / 候选行 / 移除键复用 .lite-composer-filter / .lite-composer-option /
// .lite-composer-remove 三个族类名（verify-button-family 白名单既有条目，"筛选/切换 chip"
// 类目语义原样成立）；提交键由调用方给 .lite-btn 族类。
//
// ── #75 · Claude 化改造（2026-08-09）─────────────────────────────────────────────────
// 正文控件从 `<input type="text">` 换成 `<textarea>`（Enter 发送 / Shift+Enter 换行 / 自动长高）。
//
// 🔴 稳定钩子（不绑标签名）：门里所有抓手改用 data-composer-*，别再写 `input[type="text"]`
//    或 `button[type="submit"]`。开工侦察实测：那两个选择器换控件后命中 0 个 / 命中 2 个，
//    Playwright 是**抛错**不是判负——整份门 crash，连汇总行都不打印。
//      · [data-composer-input]  正文控件
//      · [data-composer-send]   发送键
//      · [data-composer-stop]   停止键（**type="button"**，不进 submit 计数）
//      · [data-composer-attach] 附件键（**type="button"**）
//      · [data-composer-file]   隐藏的 file input，**永远放在 form 的最后**
//
// 🔴 为什么 file input 必须垫底：`scripts/gates/live-frontend-gate.snippet.js` 的 F2 相位
//    （:689）选择器末尾有个没有类型限定的裸 `input` 子句，而 querySelector 按**文档序**取第一个
//    匹配任一子句的节点（不按子句书写顺序）。file input 若排在正文控件之前会被选中，紧接着
//    :694-702 用 HTMLInputElement value setter 往 type=file 上写字符串 → InvalidStateError，
//    那段没有 try/catch → composerAskLive() 整个 reject。垫底 + 同批改判 snippet 选择器，两道都做。
//
// 🔴 输入法：Enter 提交必须让开 IME 合成中的确认键（中文语境下这是必修课，不是可选项）。
//    合成态判据取 `nativeEvent.isComposing` 与自持的 composingRef 的并集——Safari 在
//    compositionend 那一拍的 isComposing 取值历史上不一致，两个都看更稳。
//    门用 pressSequentially 打字不触发合成，所以既有的裸 Enter 判据行为不变。

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

// 光标前最近的活跃 `@词`：@ 与光标之间无空白、无另一个 @。刻意**不**要求 @ 前有空格——
// 中文语境「问问@张三」没有空格可依。代价是邮箱形状也会弹层，Esc 即关，可接受。
function detectToken(value: string, caret: number): { start: number; query: string } | null {
  const upto = value.slice(0, caret)
  const m = /@([^\s@]*)$/.exec(upto)
  if (!m) return null
  return { start: upto.length - m[0].length, query: m[1] }
}

const FILTERS: Array<{ id: AskRefFilter; label: (l: Dict['lite2']) => string }> = [
  { id: 'all', label: (l) => l.refAll },
  { id: 'person', label: (l) => l.refPeople },
  { id: 'project', label: (l) => l.refProjects },
  { id: 'file', label: (l) => l.refFiles },
  { id: 'playbook', label: (l) => l.refPlaybooks },
]

const KIND_LABEL: Record<AskRef['kind'], (l: Dict['lite2']) => string> = {
  person: (l) => l.refPeople,
  project: (l) => l.refProjects,
  file: (l) => l.refFiles,
  playbook: (l) => l.refPlaybooks,
}

// ── #66 · 弹层可用空间感知的常数（px）────────────────────────────────────────
// PICKER_GAP 对应 CSS `bottom/top: calc(100% + 8px)` 的 8；LIST_MAX_HEIGHT 与 lite2.css
// `.lite-ref-picker-list { max-height: 240px }` 同值（CSS 那条是静态兜底，这里是动态钳制
// 的上限，改一处必须同步另一处）；PICKER_CHROME 是弹层里列表之外的固定高度（padding 20 +
// 筛选行 ~26 + gap 8 + 边框 2，取 64 留余量）；LIST_MIN_HEIGHT 是钳制地板——比它还矮就
// 没法挑候选了，极端矮窗口宁可溢出也不给一条缝。
const PICKER_GAP = 8
const PICKER_CHROME = 64
const LIST_MAX_HEIGHT = 240
const LIST_MIN_HEIGHT = 72

// #75 · textarea 自动长高的封顶（px）。与 lite2.css `.nexus-followup-composer textarea`
// 的 max-height 同值——改一处必须同步另一处（同 LIST_MAX_HEIGHT ↔ .lite-ref-picker-list 的
// 既有双份义务）。超过就内滚，不再顶高整个 composer（顶高会吃掉会话流的可视高度，
// 而 room-usability 的让位判据量的正是 composer 顶沿）。
const TEXTAREA_MAX_HEIGHT = 168

export function AskRefComposer({
  formClassName,
  formAriaLabel,
  inputClassName,
  inputAriaLabel,
  placeholder,
  submitClassName,
  submitLabel,
  submitAriaLabel,
  disableEmptySubmit = false,
  busy = false,
  initialValue,
  initialRefs,
  autoFocusInput = false,
  idPrefix,
  onSubmit,
  onEscapeClosed,
  onStop,
  stopLabel,
  stopAriaLabel,
  attachments,
  attachAriaLabel,
  attachAccept,
  attachBusy = false,
  attachError,
  onAttach,
  onRemoveAttachment,
  removeAttachmentAria,
}: {
  formClassName: string
  formAriaLabel?: string
  inputClassName?: string
  inputAriaLabel: string
  placeholder: string
  submitClassName: string
  submitLabel: ReactNode
  submitAriaLabel?: string
  // #69 · 空文本时把发送键置灰。此前默认 false＝键恒可点，点了走 handleSubmit 的静默
  // return——「空着点发送什么也没发生」那个坑就是这么来的。
  disableEmptySubmit?: boolean
  // #71 · 上一轮还在流的时候把发送键置灰（对齐 codex/claude：生成中不收新消息）。
  // 为什么不是"打断上一轮"：中止的流会在微任务里被收成 'complete'（transport abort 走
  // onDone() 无 error），那一轮在会话流里就成了一条"看着答完了其实被砍了"的假记录；
  // 要诚实地表达"被打断"得新起一套状态与文案，本票不做。
  busy?: boolean
  initialValue?: string
  initialRefs?: AskRef[]
  autoFocusInput?: boolean
  idPrefix: string
  onSubmit: (text: string, refs: AskRef[]) => void
  onEscapeClosed?: () => void
  // #75 · 停止生成。给了 onStop 才长出停止键（悬浮胶囊没有在飞的流，不给）。
  // 🔴 停止键与发送键**并存**，且是 type="button"：form 内 `button[type="submit"]` 恒只有
  //    一个（room-conversation:66/95 的 count()===1 自证 + snippet:1796/2208 都锚在这上面）。
  onStop?: () => void
  stopLabel?: ReactNode
  stopAriaLabel?: string
  // #73 · 现场附件。给了 onAttach 才长出附件键与隐藏 file input。
  // 🔴 预览用 .lite-attachment-pill / [data-attachment-pill]，**零射程重叠**于
  //    .lite-room-chip（nomaterial 门数 4）与 [data-followup-chip]（conversation 门数 2）。
  attachments?: Array<{ key: string; label: string; state: 'uploading' | 'ready' | 'failed'; note?: string }>
  attachAriaLabel?: string
  attachAccept?: string
  attachBusy?: boolean
  /** 整批级的诚实报错（预检没过 / 这一趟上传失败）。行内、就地，不弹 toast。 */
  attachError?: string | null
  onAttach?: (files: File[]) => void
  onRemoveAttachment?: (key: string) => void
  removeAttachmentAria?: (label: string) => string
}) {
  const { t } = useDict()
  const l = t.lite2
  const team = useLite((s) => s.team)
  const files = useLite((s) => s.files)
  const rawTeam = useLite((s) => s.rawTeam)
  const playbooks = rawTeam?.playbooks ?? []

  const [draft, setDraft] = useState(initialValue ?? '')
  const [refs, setRefs] = useState<AskRef[]>(initialRefs ?? [])
  const [token, setToken] = useState<{ start: number; query: string } | null>(null)
  // Esc 静音位：被 Esc 关掉的那个 @词 的 start。没有它，redetect 会按「光标前仍有活跃 @词」
  // 把层当场重开——Esc 永远关不住（门⑦实测逮到）。
  // 🔴 必须是 ref 不是 state：React 的 SelectEventPlugin 在**同一个 keydown 派发批次**里、
  //   onKeyDown 之后紧跟着派发 onSelect（探针实录 kd→apply 同批），两个 handler 出自同一次
  //   render——state 版的 muted 在那个 onSelect 闭包里恒是旧值，Esc 关掉的层会被原地重开。
  //   ref 的写入同批次立即可见，onSelect 的 redetect 才拦得住。
  // 同一 start 的 token 保持静音（继续打字不重开）；@词 消失（选中摘掉/删掉）即解除。
  const mutedRef = useRef<number | null>(null)
  const [filter, setFilter] = useState<AskRefFilter>('all')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // #75 · IME 合成位。中文/日文输入法按 Enter 是「确认候选词」，不是「发送」——没有这道闸，
  // 经理打完拼音按 Enter 会把半截候选直接发出去（@ 弹层开着时更糟：Enter 归选中）。
  // 用 ref 不用 state：与 mutedRef 同款理由，同一批事件里要立即可见。
  const composingRef = useRef(false)

  const menuOpen = token !== null
  const listId = `${idPrefix}-ref-list`

  // #66 · 弹层朝向与列表钳高。null = 还没量（层刚开，layout effect 在首帧 paint 前补上）。
  const [placement, setPlacement] = useState<{ down: boolean; listMax: number } | null>(null)

  // #66 · 可用空间感知：默认上弹（既有审美）；量「锚点 → 裁剪窗口」的上下余量，上边装不下
  // 整层且下边更宽裕就翻转向下（is-down），哪边都不够就把列表 max-height 钳进余量。
  // 🔴 裁剪窗口 = 视口 ∩ 一切 overflow 非 visible 的祖先——议事室宿主在 `.scene`
  //   （overflow:hidden + 非 none transform，00-base.css）里，只看视口会漏掉硬裁（票 #66
  //   病根 2：rect 在视口内 ≠ 真的画出来了）。
  // 只在开层与 resize 时量：锚点不随打字移动，选中即关层；胶囊是 fixed、议事室两态的
  // composer 也不在滚动区里，不用监听 scroll。
  useLayoutEffect(() => {
    if (!menuOpen) {
      setPlacement(null)
      return
    }
    const measure = () => {
      const form = formRef.current
      if (!form) return
      let clipTop = 0
      let clipBottom = window.innerHeight
      for (let el = form.parentElement; el; el = el.parentElement) {
        const cs = window.getComputedStyle(el)
        if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') {
          const r = el.getBoundingClientRect()
          clipTop = Math.max(clipTop, r.top)
          clipBottom = Math.min(clipBottom, r.bottom)
        }
      }
      const rect = form.getBoundingClientRect()
      const spaceAbove = rect.top - clipTop - PICKER_GAP
      const spaceBelow = clipBottom - rect.bottom - PICKER_GAP
      const full = LIST_MAX_HEIGHT + PICKER_CHROME
      const down = spaceAbove < full && spaceBelow > spaceAbove
      const avail = down ? spaceBelow : spaceAbove
      setPlacement({
        down,
        listMax: Math.max(LIST_MIN_HEIGHT, Math.min(LIST_MAX_HEIGHT, avail - PICKER_CHROME)),
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [menuOpen])

  useEffect(() => {
    if (autoFocusInput) inputRef.current?.focus()
    // 只在挂载时聚焦一次（悬浮胶囊展开的既有行为）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // #75 · 自动长高：先归零再按 scrollHeight 量，否则缩短文本时高度只增不减（scrollHeight
  // 恒 >= 当前 height）。用 layout effect 在 paint 前落地，避免长高那一帧的跳动。
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`
  }, [draft])

  // #70 · 收敛到上限走 pickRefOptions（按类目轮转分配名额）而不是裸 slice——裸 slice 在
  // 16 人 8 项目的团队里把文件/方法卡整类挤出「全部」视图。筛选 chip 视图只有一类候选，
  // 轮转退化成 slice，行为不变。
  const options = useMemo(
    () => pickRefOptions(searchAskRefs(team, files, playbooks, token?.query ?? '', filter), MAX_REF_OPTIONS),
    [team, files, playbooks, token, filter],
  )
  // 零候选的两句话必须分开：这一类根本没数据（refEmpty）vs 有数据但这个词没搜到
  //（searchEmpty）——zh.ts:76 的既有措辞纪律。
  const filterHasAny = useMemo(
    () => searchAskRefs(team, files, playbooks, '', filter).length > 0,
    [team, files, playbooks, filter],
  )
  const active = Math.min(activeIndex, Math.max(0, options.length - 1))

  // token 变更的唯一入口（onChange 与 redetect 共用）：静音位在这里执法。
  function applyToken(next: { start: number; query: string } | null) {
    if (next === null) {
      setToken(null)
      mutedRef.current = null
      return
    }
    if (mutedRef.current !== null && next.start === mutedRef.current) {
      setToken(null)
      return
    }
    setToken((prev) => (prev && prev.start === next.start && prev.query === next.query ? prev : next))
  }

  // 光标移动（点击/方向键）也要重判活跃 @词——onChange 采不到纯光标移动。
  function redetect() {
    const el = inputRef.current
    if (!el) return
    applyToken(detectToken(el.value, el.selectionStart ?? el.value.length))
  }

  function closeMenu() {
    setToken(null)
    setActiveIndex(0)
  }

  function pick(opt: AskRef) {
    setRefs((current) =>
      current.some((r) => r.kind === opt.kind && r.id === opt.id) ? current : [...current, opt],
    )
    if (token) {
      const end = token.start + 1 + token.query.length
      setDraft((v) => v.slice(0, token.start) + v.slice(end))
    }
    closeMenu()
    inputRef.current?.focus()
  }

  function removeRef(ref: AskRef) {
    setRefs((current) => current.filter((r) => !(r.kind === ref.kind && r.id === ref.id)))
    inputRef.current?.focus()
  }

  // 输入法正在合成候选词时，Enter 属于输入法（确认候选），一律不归我们。
  function isComposing(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    return composingRef.current || (event.nativeEvent as { isComposing?: boolean }).isComposing === true
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex(Math.min(active + 1, options.length - 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex(Math.max(active - 1, 0))
      } else if (event.key === 'Enter') {
        if (isComposing(event)) return
        // 层开着时 Enter 归选中，不归提交——半个 @词 掉进问题里发出去是最难看的失手。
        event.preventDefault()
        if (options[active]) pick(options[active])
      } else if (event.key === 'Escape') {
        event.preventDefault()
        if (token) mutedRef.current = token.start
        closeMenu()
      }
      return
    }
    if (event.key === 'Escape' && onEscapeClosed) {
      event.preventDefault()
      onEscapeClosed()
      return
    }
    // #75 · 多行输入的键位：Enter 发送、Shift+Enter 换行。
    // 🔴 为什么不是「Enter 换行 / Ctrl+Enter 发送」：at-references 的共享探针 submitRoom()
    //    用的是裸 Enter，被 ⑨ 段 7 个入口全复用；改键位后那一行不会报错，只会往框里敲个
    //    换行符，7 个入口的 waitForPosts 全超时，28 条判据以「入口没接上引用」的**误诊断
    //    形态**假红。键位选择本身就是在保护这 28 条判据的可读性。
    // textarea 不会像 input 那样把 Enter 变成隐式提交，所以这里必须自己发。
    if (event.key === 'Enter' && !event.shiftKey) {
      if (isComposing(event)) return
      event.preventDefault()
      submitDraft()
    }
  }

  // 提交的唯一实现。表单 onSubmit（点发送键）与 Enter 两条路都收口到这里。
  function submitDraft() {
    const text = draft.trim()
    // 🔴 这两句是**兜底**不是主闸：主闸在下面 submit 键的 disabled 上（#69 判据落在
    // 那个属性上）。留着是因为 Enter 那条路绕不过它——textarea 上的 Enter 由我们自己
    // 派发，浏览器不会替我们看 disabled。
    if (busy || !text) return
    onSubmit(text, refs)
    setDraft('')
    setRefs([])
    closeMenu()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    submitDraft()
  }

  // #73 · 附件选择。file input 的 value 每次用完必须清空，否则连着选同一个文件不触发 change。
  function handleFilePicked(event: { currentTarget: HTMLInputElement }) {
    const el = event.currentTarget
    const picked = Array.from(el.files ?? [])
    el.value = ''
    if (picked.length > 0) onAttach?.(picked)
  }

  // 静息态（无 chip、层没开）className 与改造前逐字节相同；状态类只在交互态出现——
  // 像素基线与几何门都锚在静息态上，这一行是那个承诺的实现处。
  const formClasses = `${formClassName}${refs.length > 0 ? ' has-refs' : ''}${menuOpen ? ' is-picking' : ''}`

  return (
    <form
      ref={formRef}
      className={formClasses}
      aria-label={formAriaLabel}
      onSubmit={handleSubmit}
      data-ask-refs=""
    >
      {menuOpen ? (
        <div
          className={placement?.down ? 'lite-ref-picker is-down' : 'lite-ref-picker'}
          data-ref-picker=""
        >
          <div className="lite-ref-picker-filters" role="group" aria-label={l.composerFilterAria}>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={f.id === filter ? 'lite-composer-filter is-active' : 'lite-composer-filter'}
                aria-pressed={f.id === filter}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setFilter(f.id)
                  setActiveIndex(0)
                  inputRef.current?.focus()
                }}
              >
                {f.label(l)}
              </button>
            ))}
          </div>
          <div
            className="lite-ref-picker-list"
            role="listbox"
            id={listId}
            aria-label={l.refMenuAria}
            style={placement ? { maxHeight: placement.listMax } : undefined}
          >
            {options.length === 0 ? (
              <p className="lite-ref-empty">{filterHasAny ? l.searchEmpty : l.refEmpty}</p>
            ) : (
              options.map((opt, i) => (
                <button
                  key={`${opt.kind}-${opt.id}`}
                  id={`${idPrefix}-ref-opt-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={
                    i === active
                      ? `lite-composer-option is-${opt.kind} is-active`
                      : `lite-composer-option is-${opt.kind}`
                  }
                  data-ref-kind={opt.kind}
                  data-ref-id={opt.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(opt)}
                >
                  <span className="lite-ref-option-label">{opt.label}</span>
                  {/* 重名消歧：部门紧跟人名。分隔靠 CSS 间距，零标点字面量。 */}
                  {opt.dupeTeam ? <small className="lite-ref-option-team">{opt.dupeTeam}</small> : null}
                  {opt.meta ? <small className="lite-ref-option-meta">{opt.meta}</small> : null}
                  {/* 「全部」视图里四类混排，补一个类目词免得项目与方法长得一样。 */}
                  {filter === 'all' ? (
                    <small className="lite-ref-option-kind">{KIND_LABEL[opt.kind](l)}</small>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}

      {refs.length > 0 ? (
        <div className="lite-ref-chips" aria-label={l.composerRefsAria}>
          {refs.map((r) => (
            <span
              key={`${r.kind}-${r.id}`}
              className={`lite-ref-chip is-${r.kind}`}
              data-ref-chip={r.kind}
              data-ref-id={r.id}
            >
              <span className="lite-ref-chip-label">{r.label}</span>
              {r.dupeTeam ? <small className="lite-ref-chip-team">{r.dupeTeam}</small> : null}
              <button
                type="button"
                className="lite-composer-remove"
                aria-label={fill(l.composerRemoveRefAria, { label: r.label })}
                onClick={() => removeRef(r)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {/* #73 · 附件预览。类名/属性族与 .lite-room-chip、[data-followup-chip] 零重叠——
          那两套各自被 nomaterial（数 4）与 conversation（数 2）当计数判据用，蹭一下就撑破。 */}
      {attachments && attachments.length > 0 ? (
        <div className="lite-attachment-row" aria-label={l.roomAttachRowAria}>
          {attachments.map((a) => (
            <span
              key={a.key}
              className={`lite-attachment-pill is-${a.state}`}
              data-attachment-pill={a.state}
            >
              <span className="lite-attachment-name">{a.label}</span>
              {a.note ? <small className="lite-attachment-note">{a.note}</small> : null}
              {onRemoveAttachment && a.state !== 'uploading' ? (
                <button
                  type="button"
                  className="lite-composer-remove"
                  aria-label={removeAttachmentAria?.(a.label)}
                  onClick={() => onRemoveAttachment(a.key)}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {/* 诚实报错就地说，不弹 toast——经理的注意力就在这一行上，错就错在他刚做的动作。 */}
      {attachError ? (
        <p className="lite-attachment-error" data-attachment-error="" role="status">
          {attachError}
        </p>
      ) : null}

      <textarea
        ref={inputRef}
        rows={1}
        data-composer-input=""
        className={inputClassName}
        role="combobox"
        aria-expanded={menuOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={menuOpen && options[active] ? `${idPrefix}-ref-opt-${active}` : undefined}
        value={draft}
        placeholder={placeholder}
        aria-label={inputAriaLabel}
        autoComplete="off"
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={() => {
          composingRef.current = false
        }}
        onChange={(event) => {
          setDraft(event.currentTarget.value)
          const next = detectToken(
            event.currentTarget.value,
            event.currentTarget.selectionStart ?? event.currentTarget.value.length,
          )
          applyToken(next)
          if (next) setActiveIndex(0)
        }}
        onSelect={redetect}
        onKeyDown={handleKeyDown}
      />

      {/* ── #81 · 控件行 ────────────────────────────────────────────────────────────
          Claude 式双行 composer：正文占满上面一行，控件另起一行（附件靠左、停止/发送靠右）。
          改造前是单行 flex-wrap，桌面上 `[textarea][📎][停止][提问]` 挤在一条线上，
          ≤860 才被动换行——那不是版式，是塞不下之后的结果。

          🔴 多包这一层 div **不破任何既有门**：room-claude-rework ① 判的是
             `.nexus-followup-composer` 的 count / 是不是 `.lite-room` 直接子 / 在不在 board 与
             滚动区外 / form 内 `button[type="submit"]` 恰 1，全是计数与祖先关系，不是子序。
          🔴 但它必须排在**隐藏 file input 之前**：snippet F2(:689) 的选择器末尾有个没有类型
             限定的裸 `input` 子句，querySelector 按文档序取第一个匹配——file input 只要还是
             form 里最后一个，那条兜底就仍然轮不到它。
          🔴 胶囊（.lite-ask-avery-form）用同一棵树但**不换行**：CSS 里给它
             `.lite-composer-actions { flex: 0 0 auto }`，输入与发送钮仍在同一行。 */}
      <div className="lite-composer-actions">
        {/* #73 · 附件键。type="button" 是硬约束：漏写的话 HTML 默认它就是 submit，
            form 内 `button[type="submit"]` 从 1 变 2，门里的 count()===1 自证会**抛错**
            （strict mode 命中多个），不是判负。 */}
        {onAttach ? (
          <button
            type="button"
            className="lite-btn lite-btn--ghost lite-composer-attach"
            data-composer-attach=""
            aria-label={attachAriaLabel}
            disabled={attachBusy ? true : undefined}
            onClick={() => fileRef.current?.click()}
          >
            <AttachIcon />
          </button>
        ) : null}

        {/* #75 · 停止生成。只在真有流在跑时出现；同样 type="button"。
            #81 · 换成 icon-only（方块停止符），壳仍是 danger 描边。
            🔴 与发送键**并存**（不做「原位变身」）：`[data-composer-stop]` 在场 +
               `button[type="submit"]` 恒 1 是 room-claude-rework ①③ 的硬约束，变身要连
               三处判据一起改判，本票不做——并存形态本来就有门背书。
            🔴 icon-only 之后可见文字没了，`stopAriaLabel` 就是它的可及名；`stopLabel` 退成
               tooltip（title），值一个字没改。 */}
        {onStop && busy ? (
          <button
            type="button"
            className="lite-btn lite-btn--ghost lite-composer-stop"
            data-composer-stop=""
            aria-label={stopAriaLabel}
            title={typeof stopLabel === 'string' ? stopLabel : undefined}
            onClick={onStop}
          >
            <StopIcon />
          </button>
        ) : null}

        <button
          type="submit"
          className={submitClassName}
          data-composer-send=""
          aria-label={submitAriaLabel}
          // #69/#71：空文本置灰（`disableEmptySubmit`）或上一轮还在跑时置灰（`busy`）。
          // 🔴 显式合取，别改成替换或 OR/AND 写反——写坏了的现象是「有文本却仍然灰」，
          //    很容易被误诊成生成态判断出问题，其实是空闲态那一半被污染了。
          // 两者都不成立时给 undefined 而不是 false——静息态 DOM 上一个属性都不多长，
          // 像素基线与 button-family 的既有判据都锚在那个静息态上。
          disabled={busy || (disableEmptySubmit && draft.trim() === '') ? true : undefined}
        >
          {submitLabel}
        </button>
      </div>

      {/* 🔴 隐藏 file input **必须垫底**：snippet F2(:689) 的选择器末尾有个没有类型限定的
          裸 `input` 子句，querySelector 按文档序取第一个匹配——它若排在 textarea 之前会被
          选中，随后那段往 type=file 上写 value 抛 InvalidStateError 且无 try/catch，
          整个 composerAskLive() reject。放最后 + 同批改判 snippet，两道都做。 */}
      {onAttach ? (
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          data-composer-file=""
          accept={attachAccept}
          onChange={handleFilePicked}
        />
      ) : null}
    </form>
  )
}

// #81 · 手绘 `PaperclipIcon` 已退役 —— 改用 `./icons` 的 Phosphor 包装（一族一个 weight）。
// 手绘那份是 16×16 viewBox 的单 path fill，与铃铛的 24 viewBox stroke 1.8 画风本来就不是一家；
// 「绝不手绘新 icon」是设计技能的硬纪律，这里是执行它的第一处。
