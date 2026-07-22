import { useMemo, useState, type FormEvent, type MouseEvent } from 'react'
import { useLite } from './store'
import { useDict } from '../shared/i18n/useDict'
import { searchTeam } from './searchDerive'

// feat-024 · lite composer——ADR-0022 决策 2。确诊渗漏第二现场的正版替身：
// story 的 TeamComposer 预填 HERO_QUESTION、@ 引用 fixtures、提交进 story 剧本机
//（askQuestion）；这里预填为空、引用只来自 live 语料（上传长出来的人/项目）、
// 提交走 store.askLive → feat-015 /advise SSE → The room。复用 .composer-* CSS chrome。

type LiteReferenceKind = 'person' | 'project'
type LiteReferenceFilter = 'all' | LiteReferenceKind

interface LiteReference {
  id: string
  kind: LiteReferenceKind
  label: string
  meta: string
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

export function LiteComposer() {
  const { t } = useDict()
  const team = useLite((s) => s.team)
  const askLive = useLite((s) => s.askLive)
  const goScreen = useLite((s) => s.goScreen)

  const [question, setQuestion] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [referenceMenuOpen, setReferenceMenuOpen] = useState(false)
  const [referenceFilter, setReferenceFilter] = useState<LiteReferenceFilter>('all')
  const [referenceQuery, setReferenceQuery] = useState('')
  const [references, setReferences] = useState<LiteReference[]>([])

  const filters: Array<{ id: LiteReferenceFilter; label: string }> = [
    { id: 'all', label: t.lite2.refAll },
    { id: 'person', label: t.lite2.refPeople },
    { id: 'project', label: t.lite2.refProjects },
  ]

  // 引用语料 = live payload（上传长出来的人/项目），零 fixtures。
  // 棒E：改成消费公共 selector `searchTeam`（顶栏搜索同源）——同一个词在引用菜单与顶栏
  // 给同一个结果，两处不再各写一套 `includes` 漂移。id 加 `${kind}-` 前缀是本组件的去重口径
  //（跨人/项目撞 id 时不误判为同一条），searchTeam 返回的是**原始实体 id**。
  // `t` 已退出 deps：meta 现在是原值（locale-free），缺失兜底移到渲染层的 <small>——
  // 切语言时那半句随渲染层重算，不再停在旧语言（正是原注释担心的 blocker 形状，现已从
  // 结构上消除：派生不焊 locale）。
  const referenceOptions = useMemo<LiteReference[]>(
    () =>
      searchTeam(team, referenceQuery, referenceFilter).map((r) => ({
        id: `${r.kind}-${r.id}`,
        kind: r.kind,
        label: r.label,
        meta: r.meta,
      })),
    [team, referenceFilter, referenceQuery],
  )

  const isExpanded = composerOpen || referenceMenuOpen || references.length > 0

  function stopPropagation(event: MouseEvent) {
    event.stopPropagation()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    event.stopPropagation()
    const text = question.trim()
    if (!text) return
    setReferenceMenuOpen(false)
    // 引用织进 situation 文本（后端吃自由文本情境；具名实体帮 recall 命中语料行）。
    const situation =
      references.length > 0
        ? `${text}\n\nAbout: ${references.map((r) => r.label).join(', ')}`
        : text
    askLive({ situation })
    goScreen('room')
  }

  function addReference(reference: LiteReference) {
    setReferences((current) =>
      current.some((existing) => existing.id === reference.id) ? current : [...current, reference],
    )
    setReferenceQuery('')
    setReferenceMenuOpen(false)
    setComposerOpen(true)
  }

  function removeReference(id: string) {
    setReferences((current) => current.filter((ref) => ref.id !== id))
  }

  return (
    <div className={`composer-layer lite-composer${isExpanded ? ' is-expanded' : ''}`} onClick={stopPropagation}>
      <form className="composer-card" onSubmit={handleSubmit}>
        <div className="composer-main-row">
          <input
            type="text"
            value={question}
            placeholder={t.nexus.askPlaceholder}
            onClick={() => setComposerOpen(true)}
            onFocus={() => setComposerOpen(true)}
            onChange={(event) => setQuestion(event.currentTarget.value)}
            aria-label={t.lite2.composerAskAria}
          />
          <button type="submit" className="icon-button">
            {t.nexus.ask}
          </button>
        </div>

        {isExpanded ? (
          <div className="composer-reference-row">
            <button
              type="button"
              className="composer-add-button"
              aria-label={t.lite2.refAdd}
              aria-expanded={referenceMenuOpen}
              onClick={() => {
                setComposerOpen(true)
                setReferenceMenuOpen((open) => !open)
              }}
            >
              +
            </button>
            <div className="composer-reference-chips" aria-label={t.lite2.composerRefsAria}>
              {references.map((reference) => (
                <span key={reference.id} className={`composer-reference-chip is-${reference.kind}`}>
                  <span>{reference.label}</span>
                  {reference.kind !== 'project' && <small>{reference.meta}</small>}
                  <button
                    type="button"
                    className="lite-composer-remove"
                    aria-label={fill(t.lite2.composerRemoveRefAria, { label: reference.label })}
                    onClick={() => removeReference(reference.id)}
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {referenceMenuOpen ? (
          <div className="composer-reference-picker">
            <div className="reference-picker-actions">
              {filters.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={filter.id === referenceFilter ? 'lite-composer-filter is-active' : 'lite-composer-filter'}
                  aria-pressed={filter.id === referenceFilter}
                  onClick={() => setReferenceFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={referenceQuery}
              placeholder={t.lite2.refSearch}
              aria-label={t.lite2.composerFilterAria}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.preventDefault()
              }}
              onChange={(event) => setReferenceQuery(event.currentTarget.value)}
            />
            <div className="reference-picker-list">
              {referenceOptions.length > 0 ? (
                referenceOptions.map((option) => (
                  <button key={option.id} type="button" className="lite-composer-option" onClick={() => addReference(option)}>
                    <span>{option.label}</span>
                    {/* 缺负责人的项目在渲染层兜底（派生层给的是原值空串），不焊 locale。 */}
                    <small>
                      {option.meta || (option.kind === 'project' ? t.lite2.projectsUnknownValue : '')}
                    </small>
                  </button>
                ))
              ) : (
                <p className="lite-reference-empty">{t.lite2.refEmpty}</p>
              )}
            </div>
          </div>
        ) : null}
      </form>
    </div>
  )
}
