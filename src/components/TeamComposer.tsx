import { useMemo, useState, type FormEvent, type MouseEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'framer-motion'
import {
  CAPABILITIES,
  HERO_QUESTION,
  PEOPLE,
  PROJECTS,
  type CapabilityEntry,
  type Person,
  type Project,
} from '../data/fixtures'
import { useCanvas } from '../store/canvasStore'

// feat-014（ADR-0017 决策 4）：composer 随主场迁移——从 DashboardScene 原样抽出为
// 共享组件，落在 Home（B3 "Ask about the team" 的入口）。引用选择器机器不变；
// 地图页的 focus-reference 注入通过可选 prop 保留（当前地图不再渲染 composer，
// prop 留作回迁口）。

type ReferenceKind = 'person' | 'project' | 'capability' | 'file'
type ReferenceFilter = 'all' | Exclude<ReferenceKind, 'file'>

export interface ComposerReference {
  id: string
  kind: ReferenceKind
  label: string
  meta: string
}

const REFERENCE_FILTERS: Array<{ id: ReferenceFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'person', label: 'People' },
  { id: 'project', label: 'Projects' },
  { id: 'capability', label: 'Playbooks' },
]

function ownerName(project: Project) {
  return PEOPLE.find((p) => p.id === project.ownerId)?.name ?? 'Unassigned'
}

export function personReference(person: Person): ComposerReference {
  return { id: `person-${person.id}`, kind: 'person', label: person.name, meta: person.role }
}

export function projectReference(project: Project): ComposerReference {
  return {
    id: `project-${project.id}`,
    kind: 'project',
    label: project.title,
    meta: ownerName(project),
  }
}

function capabilityReference(capability: CapabilityEntry): ComposerReference {
  return {
    id: `capability-${capability.id}`,
    kind: 'capability',
    label: capability.title,
    meta: capability.domain,
  }
}

export function TeamComposer({
  focusReference = null,
}: {
  focusReference?: ComposerReference | null
}) {
  const askQuestion = useCanvas((s) => s.askQuestion)
  const prefersReducedMotion = useReducedMotion()
  const [question, setQuestion] = useState(HERO_QUESTION)
  const [composerOpen, setComposerOpen] = useState(false)
  const [referenceMenuOpen, setReferenceMenuOpen] = useState(false)
  const [referenceFilter, setReferenceFilter] = useState<ReferenceFilter>('all')
  const [referenceQuery, setReferenceQuery] = useState('')
  const [references, setReferences] = useState<ComposerReference[]>([])

  const transition: Transition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.28, ease: [0.16, 1, 0.3, 1] }

  const visibleReferences = useMemo(() => {
    const refs = focusReference ? [focusReference] : []
    for (const ref of references) {
      if (!refs.some((existing) => existing.id === ref.id)) refs.push(ref)
    }
    return refs
  }, [focusReference, references])

  const referenceOptions = useMemo(() => {
    const query = referenceQuery.trim().toLowerCase()
    const allOptions = [
      ...PEOPLE.map(personReference),
      ...PROJECTS.map(projectReference),
      ...CAPABILITIES.map(capabilityReference),
    ]

    return allOptions.filter((option) => {
      if (referenceFilter !== 'all' && option.kind !== referenceFilter) return false
      if (!query) return true
      return `${option.label} ${option.meta}`.toLowerCase().includes(query)
    })
  }, [referenceFilter, referenceQuery])

  const isComposerExpanded =
    Boolean(focusReference) || composerOpen || referenceMenuOpen || visibleReferences.length > 0

  function stopPropagation(event: MouseEvent) {
    event.stopPropagation()
  }

  function handleAskQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    event.stopPropagation()
    const text = question.trim() || HERO_QUESTION
    setReferenceMenuOpen(false)
    askQuestion(text)
  }

  function addReference(reference: ComposerReference) {
    setReferences((current) =>
      current.some((existing) => existing.id === reference.id) ? current : [...current, reference],
    )
    setReferenceQuery('')
    setReferenceMenuOpen(false)
    setComposerOpen(true)
  }

  function addAttachment() {
    setReferences((current) => [
      ...current,
      {
        id: `file-${current.filter((ref) => ref.kind === 'file').length + 1}`,
        kind: 'file',
        label: 'Smart_Shopping_Guide_Brief.docx',
        meta: 'Attachment',
      },
    ])
    setReferenceMenuOpen(false)
    setComposerOpen(true)
  }

  function removeReference(id: string) {
    setReferences((current) => current.filter((ref) => ref.id !== id))
  }

  return (
    <motion.div
      className={`composer-layer${isComposerExpanded ? ' is-expanded' : ''}`}
      style={{ x: '-50%' }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition}
      onClick={stopPropagation}
    >
      <motion.form
        className="composer-card"
        onSubmit={handleAskQuestion}
        animate={{ borderRadius: isComposerExpanded ? 8 : 999 }}
        transition={transition}
      >
        <div className="composer-main-row">
          <input
            value={question}
            onClick={() => setComposerOpen(true)}
            onFocus={() => setComposerOpen(true)}
            onChange={(event) => setQuestion(event.currentTarget.value)}
            aria-label="Ask about your team"
          />
          <button type="submit" className="icon-button">
            Ask
          </button>
        </div>

        <AnimatePresence initial={false}>
          {isComposerExpanded && (
            <motion.div
              className="composer-reference-row"
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: 'auto', marginTop: 8 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={transition}
              style={{ overflow: 'hidden' }}
            >
              <button
                type="button"
                className="composer-add-button"
                aria-label="Add reference or attachment"
                aria-expanded={referenceMenuOpen}
                onClick={() => {
                  setComposerOpen(true)
                  setReferenceMenuOpen((open) => !open)
                }}
              >
                +
              </button>
              <div className="composer-reference-chips" aria-label="Composer references">
                {visibleReferences.map((reference) => (
                  <span key={reference.id} className={`composer-reference-chip is-${reference.kind}`}>
                    <span>{reference.label}</span>
                    {reference.kind !== 'project' && <small>{reference.meta}</small>}
                    {reference.id !== focusReference?.id && (
                      <button
                        type="button"
                        aria-label={`Remove ${reference.label}`}
                        onClick={() => removeReference(reference.id)}
                      >
                        x
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {referenceMenuOpen && (
            <motion.div
              className="composer-reference-picker"
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: 'auto', marginTop: 9 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={transition}
              style={{ overflow: 'hidden' }}
            >
              <div className="reference-picker-actions">
                <button type="button" onClick={addAttachment}>
                  Attach file
                </button>
                {REFERENCE_FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    className={filter.id === referenceFilter ? 'is-active' : ''}
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
                placeholder="Reference person, project, or capability"
                aria-label="Filter references"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault()
                }}
                onChange={(event) => setReferenceQuery(event.currentTarget.value)}
              />
              <div className="reference-picker-list">
                {referenceOptions.map((option) => (
                  <button key={option.id} type="button" onClick={() => addReference(option)}>
                    <span>{option.label}</span>
                    <small>{option.meta}</small>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.form>
    </motion.div>
  )
}
