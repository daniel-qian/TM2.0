import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLite } from './store'
import { useDict } from '../shared/i18n/useDict'
import { searchTeam } from './searchDerive'

// 棒E · 顶栏真搜索（布局与真部件战役 2026-07-22）。
//
// 裁决（battle-map §2.4）：纯客户端内存检索——零后端 endpoint、零 transport。检索逻辑走
// 公共 selector `searchTeam`（LiteComposer 的引用菜单同源），同一个词两处同一个结果。
//
// 🔴 硬约束（全部来自 battle-map §2.4 / topbar-budget.md）：
//   · DOM 位置：LiteTopbar 的 `</nav>` 之后、`<LiteBell/>` 之前——**绝不能进 .scene-tabs**
//     （live-frontend-gate 按 `.scene-tabs .scene-tab` 数 9 个并逐字比对，混进非 tab 即红）。
//   · pointer-events:auto（.prototype-topbar 容器是 pointer-events:none，子块各自 auto 回来）。
//   · 断点 1280（她 hidden xl:block）：<1280 整块 hidden，几何在 CSS 媒体级隔离里。
//   · 结果行零数字（她 `sub:${status}·${progress}%` 那半句在 searchDerive 就已丢掉）。
//   · absent≠none：项目缺负责人用 projectsUnknownValue 兜底，绝不写「未分配」。
//   · 输入框**必须给 aria-label**（走 t.*）——placeholder 两道中文门都够不着。
//   · 无材料 gate：contextId===null 时整块不渲染（复用 Room 的判据；用 contextId 不用 team——
//     contextId 在模块求值期就从 localStorage 恢复，回访者第一帧非空）。
//
// 只预填/只跳转，零 transport：点结果 = openDetail(kind, id) 打开只读详情浮层（全局渲染，
// 不依赖当前屏）。不发问、不写数据。

const MAX_RESULTS = 8

export function LiteSearch() {
  const { t } = useDict()
  const l = t.lite2
  const contextId = useLite((s) => s.contextId)
  const team = useLite((s) => s.team)
  const openDetail = useLite((s) => s.openDetail)

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const q = query.trim()
  const results = useMemo(() => (q ? searchTeam(team, q).slice(0, MAX_RESULTS) : []), [team, q])
  const showPanel = open && q !== ''

  // 外点关闭（Esc 在输入框 onKeyDown 里处理）。仅在展开时挂监听。
  useEffect(() => {
    if (!showPanel) return
    function onDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showPanel])

  function select(kind: 'person' | 'project', id: string) {
    openDetail(kind, id)
    setQuery('')
    setOpen(false)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      const first = results[0]
      if (first) select(first.kind, first.id) // 跳第一条
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  // 无材料：整块不出（复用 Room gate 的 contextId 判据）。
  if (contextId === null) return null

  const people = results.filter((r) => r.kind === 'person')
  const projects = results.filter((r) => r.kind === 'project')

  return (
    <div className="lite-search" ref={rootRef}>
      <input
        ref={inputRef}
        type="search"
        className="lite-search-input"
        value={query}
        placeholder={l.searchPlaceholder}
        aria-label={l.searchAria}
        aria-expanded={showPanel}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.currentTarget.value)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
      />

      {showPanel ? (
        <div className="lite-search-pop" role="listbox" aria-label={l.searchAria}>
          {results.length === 0 ? (
            <p className="lite-search-empty">{l.searchEmpty}</p>
          ) : (
            <>
              {people.length > 0 ? (
                <div className="lite-search-group">
                  <p className="lite-search-group-label">{l.refPeople}</p>
                  {people.map((r) => (
                    <button
                      key={`person-${r.id}`}
                      type="button"
                      className="lite-search-option"
                      onClick={() => select('person', r.id)}
                    >
                      <span className="lite-search-option-label">{r.label}</span>
                      {r.meta ? <small className="lite-search-option-meta">{r.meta}</small> : null}
                    </button>
                  ))}
                </div>
              ) : null}
              {projects.length > 0 ? (
                <div className="lite-search-group">
                  <p className="lite-search-group-label">{l.refProjects}</p>
                  {projects.map((r) => (
                    <button
                      key={`project-${r.id}`}
                      type="button"
                      className="lite-search-option"
                      onClick={() => select('project', r.id)}
                    >
                      <span className="lite-search-option-label">{r.label}</span>
                      {/* 缺负责人兜底在渲染层（absent≠none），绝不写「未分配」。 */}
                      <small className="lite-search-option-meta">
                        {r.meta || l.projectsUnknownValue}
                      </small>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
