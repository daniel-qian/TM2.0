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
  initialValue,
  initialRefs,
  autoFocusInput = false,
  idPrefix,
  onSubmit,
  onEscapeClosed,
}: {
  formClassName: string
  formAriaLabel?: string
  inputClassName?: string
  inputAriaLabel: string
  placeholder: string
  submitClassName: string
  submitLabel: ReactNode
  submitAriaLabel?: string
  disableEmptySubmit?: boolean
  initialValue?: string
  initialRefs?: AskRef[]
  autoFocusInput?: boolean
  idPrefix: string
  onSubmit: (text: string, refs: AskRef[]) => void
  onEscapeClosed?: () => void
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
  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

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

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (menuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex(Math.min(active + 1, options.length - 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex(Math.max(active - 1, 0))
      } else if (event.key === 'Enter') {
        // 层开着时 Enter 归选中，不归提交——半个 @词 掉进问题里发出去是最难看的失手。
        event.preventDefault()
        if (options[active]) pick(options[active])
      } else if (event.key === 'Escape') {
        event.preventDefault()
        if (token) mutedRef.current = token.start
        closeMenu()
      }
    } else if (event.key === 'Escape' && onEscapeClosed) {
      event.preventDefault()
      onEscapeClosed()
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    onSubmit(text, refs)
    setDraft('')
    setRefs([])
    closeMenu()
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

      <input
        ref={inputRef}
        type="text"
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
      <button
        type="submit"
        className={submitClassName}
        aria-label={submitAriaLabel}
        disabled={disableEmptySubmit ? draft.trim() === '' : undefined}
      >
        {submitLabel}
      </button>
    </form>
  )
}
