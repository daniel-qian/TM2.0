import { useEffect, useState } from 'react'
import { useLite } from '../store'
import { useDict } from '../../shared/i18n/useDict'
import type { LiveNoteEntry } from '../transport'

// feat-047 · 移植自 src/lite/screens/NotesScreen.tsx（feat-033）· lite2 第 7 tab：
// Avery's notes——写侧、可见、跨会话累积的 agent 自写观察（UX 稿 §1-6，同 v01）。
// 复用叙事屏骨架（.scene-nexus + .eyebrow + h2 + lede）、空态（.nexus-empty）、分组折叠
//（.home-people-group-head aria-expanded 交互）、信任小字（.upload-privacy-note 同族）、
// is-new 高亮惯例。整屏零输入控件、只读（条目非 button；仅来源行可跳 Room）。
// 🔴 红线：本清单由后端 redline.validate（EN+ZH）写侧门管——落库前拦下评分/排名/画像文本，
// 故这里渲染的每条永不含人卡数字/评分。UI 层只忠实展示 + 一条常驻信任说明。
// copy 走 t.lite2.notes*（与 t.lite.notes* 同源英文，见 en.ts §lite2 / kickoff-dev.md §6）；
// 墙照旧（lite2 不 import src/lite、不 import src/story）。

function dayKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // local calendar day (YYYY-MM-DD) so grouping matches the viewer's timezone.
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(iso: string, todayKey: string, todayText: string): string {
  if (dayKey(iso) === todayKey) return todayText
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function timeLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function sinceLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface NoteGroup {
  key: string
  label: string
  notes: LiveNoteEntry[]
}

function groupByDay(notes: LiveNoteEntry[], todayKey: string, todayText: string): NoteGroup[] {
  const groups: NoteGroup[] = []
  const byKey = new Map<string, NoteGroup>()
  for (const note of notes) {
    // notes arrive newest-first; preserve that order within and across groups.
    const key = dayKey(note.created_at)
    let group = byKey.get(key)
    if (!group) {
      group = { key, label: dayLabel(note.created_at, todayKey, todayText), notes: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    group.notes.push(note)
  }
  return groups
}

// 单条只读笔记条目（非 button；仅来源行可跳 Room）。is-new 高亮最新一条。
function NoteEntry({ note, isNew }: { note: LiveNoteEntry; isNew: boolean }) {
  const { t } = useDict()
  const goScreen = useLite((s) => s.goScreen)
  return (
    <article className={`lite-notes-entry${isNew ? ' is-new' : ''}`}>
      <p className="lite-notes-entry-time">{timeLabel(note.created_at)}</p>
      <p className="lite-notes-entry-text">{note.text}</p>
      {note.source_excerpt ? (
        <button
          type="button"
          className="lite-notes-entry-source"
          onClick={() => goScreen('room')}
          aria-label={`${t.lite2.notesSourcePrefix} ${note.source_excerpt}`}
        >
          {t.lite2.notesSourcePrefix} {note.source_excerpt} →
        </button>
      ) : null}
    </article>
  )
}

// 一天一组，可折叠（今天默认展开，往前默认收起）。复用 PeopleGroup 的 aria-expanded 折叠头。
function NoteDayGroup({ group, defaultOpen, newestId }: {
  group: NoteGroup
  defaultOpen: boolean
  newestId: string | null
}) {
  const { t } = useDict()
  const [open, setOpen] = useState(defaultOpen)
  const countLabel = group.notes.length === 1 ? t.lite2.notesCountOne : t.lite2.notesCountMany
  return (
    <section className="home-people-group lite-notes-group" aria-label={group.label}>
      <button
        type="button"
        className="home-people-group-head lite-notes-group-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="home-people-group-title">{group.label}</span>
        <span className="home-people-group-count">
          {group.notes.length} {countLabel}
        </span>
        <span className="home-people-group-toggle">
          {open ? t.lite2.groupCollapse : t.lite2.groupExpand}
        </span>
      </button>
      {open ? (
        <div className="lite-notes-group-body">
          {group.notes.map((note) => (
            <NoteEntry key={note.id} note={note} isNew={note.id === newestId} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

export function NotesScreen() {
  const { t } = useDict()
  const notes = useLite((s) => s.notes)
  const contextId = useLite((s) => s.contextId)
  const refreshNotes = useLite((s) => s.refreshNotes)
  const goScreen = useLite((s) => s.goScreen)

  // 进屏拉一次最新累积笔记（切到 tab 即刷新；无 contextId 时是安全 no-op）。
  useEffect(() => {
    void refreshNotes()
  }, [refreshNotes, contextId])

  const now = new Date()
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  const groups = groupByDay(notes, todayKey, t.lite2.notesToday)
  const newestId = notes.length > 0 ? notes[0].id : null
  const oldest = notes.length > 0 ? notes[notes.length - 1] : null

  return (
    <section className="scene scene-nexus is-active lite-notes" aria-label={t.lite2.tabNotes}>
      {notes.length > 0 ? (
        <div className="lite-notes-body">
          <header className="lite-notes-head">
            <p className="eyebrow lite-notes-eyebrow">{t.lite2.notesEyebrow}</p>
            <h2>{t.lite2.notesTitle}</h2>
            <p className="lite-notes-lede">{t.lite2.notesLede}</p>
            {/* 🔴 常驻红线信任说明（复用 .upload-privacy-note 静音层级） */}
            <p className="upload-privacy-note lite-notes-redline-note">{t.lite2.notesRedlineNote}</p>
            <p className="lite-notes-count">
              {notes.length} {t.lite2.notesCountSince} {oldest ? sinceLabel(oldest.created_at) : ''}
            </p>
          </header>

          <div className="lite-notes-groups">
            {groups.map((group, i) => (
              <NoteDayGroup
                key={group.key}
                group={group}
                defaultOpen={i === 0} /* 今天/最新那组默认展开，往前默认收起 */
                newestId={newestId}
              />
            ))}
          </div>
        </div>
      ) : (
        /* 空态：复用 .nexus-empty + Playbooks 空态模式；引导指向去 Room 问真问题。 */
        <section className="nexus-empty lite-notes-empty" aria-label={t.lite2.notesEmptyAria}>
          <p className="eyebrow lite-notes-eyebrow">{t.lite2.notesEmptyEyebrow}</p>
          <h2>{t.lite2.notesEmptyTitle}</h2>
          <p>{t.lite2.notesEmptyBody}</p>
          {/* 红线信任说明在空态也常驻——上传前后口径一致。 */}
          <p className="upload-privacy-note lite-notes-redline-note">{t.lite2.notesRedlineNote}</p>
          <button type="button" className="upload-choose lite-notes-empty-cta" onClick={() => goScreen('room')}>
            {t.lite2.notesEmptyCta} →
          </button>
        </section>
      )}
    </section>
  )
}
