import { useMemo, useState, type FormEvent } from 'react'
import { useDict } from '../../shared/i18n/useDict'
import {
  useFlow,
  type FollowupDueGroup,
  type FollowupItem,
  type FollowupSource,
} from '../flowStore'
import { draftFromFollowup } from '../draftLinks'
import { useDraft } from '../draftStore'

// feat-036 · lite2 屏 3：Follow-ups（PRD F3 real wiring — replaces the feat-035 coming-soon
// placeholder). Active list grouped today/this-week/later + a manual add form + a History tab
// (complete -> lands here, restore -> back to active). Every "add to follow-ups" entry point
// elsewhere in lite2 (triage cards, the advice card) writes into the SAME flowStore — no fake
// buttons, no parallel in-memory list (kickoff-dev.md §feat-036 red line).
// 🔴 红线：条目上只出现标题/来源/分组这类定性信息——结构上没有数字/评分字段的位置。

function classNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

const GROUP_ORDER: FollowupDueGroup[] = ['today', 'week', 'later']

export function FollowupsScreen() {
  const { t } = useDict()
  const followups = useFlow((s) => s.followups)
  const addFollowup = useFlow((s) => s.addFollowup)
  const completeFollowup = useFlow((s) => s.completeFollowup)
  const reopenFollowup = useFlow((s) => s.reopenFollowup)
  const deleteFollowup = useFlow((s) => s.deleteFollowup)
  const editFollowup = useFlow((s) => s.editFollowup)
  // feat-058 · 应用内草稿框（弹层本体常驻挂在壳层 Lite2App，这里只负责开框）。队列条目开出来
  // 的草稿，「完成」= 把**这一条**标已办；再 addFollowup 会长出一条一模一样的重复条目。
  const openDraft = useDraft((s) => s.openDraft)

  const [tab, setTab] = useState<'active' | 'history'>('active')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editGroup, setEditGroup] = useState<FollowupDueGroup>('today')
  const [newTitle, setNewTitle] = useState('')
  const [newGroup, setNewGroup] = useState<FollowupDueGroup>('today')

  const active = useMemo(() => followups.filter((f) => !f.done), [followups])
  const history = useMemo(
    () =>
      followups
        .filter((f) => f.done)
        .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')),
    [followups],
  )

  const groups = useMemo(() => {
    const byGroup: Record<FollowupDueGroup, FollowupItem[]> = { today: [], week: [], later: [] }
    for (const item of active) byGroup[item.dueGroup].push(item)
    return byGroup
  }, [active])

  function groupLabel(group: FollowupDueGroup): string {
    if (group === 'today') return t.lite2.followupsGroupToday
    if (group === 'week') return t.lite2.followupsGroupWeek
    return t.lite2.followupsGroupLater
  }

  function sourceLabel(source: FollowupSource): string {
    switch (source) {
      case 'triage':
        return t.lite2.followupsSourceTriage
      case 'room':
        return t.lite2.followupsSourceRoom
      case 'ask':
        return t.lite2.followupsSourceAsk
      case 'closer-look':
        return t.lite2.followupsSourceCloserLook
      case 'decision':
        // 0721 对齐棒：首页决策卡「加入跟进」（B4 闭环）。
        return t.lite2.followupsSourceDecision
      default:
        return t.lite2.followupsSourceManual
    }
  }

  function startEdit(item: FollowupItem) {
    setEditingId(item.id)
    setEditTitle(item.title)
    setEditGroup(item.dueGroup)
  }

  function saveEdit() {
    if (!editingId) return
    const title = editTitle.trim()
    if (title) editFollowup(editingId, { title, dueGroup: editGroup })
    setEditingId(null)
  }

  function submitAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = newTitle.trim()
    if (!title) return
    addFollowup({ title, source: 'manual', dueGroup: newGroup })
    setNewTitle('')
    setNewGroup('today')
  }

  function renderItem(item: FollowupItem, opts: { showRestore: boolean }) {
    const isEditing = editingId === item.id
    return (
      <li
        key={item.id}
        className="lite-followup-item"
        data-followup-id={item.id}
        data-followup-source={item.source}
      >
        {isEditing ? (
          <div className="lite-followup-edit">
            <input
              className="lite-followup-edit-title"
              type="text"
              value={editTitle}
              aria-label={t.lite2.followupsTitleAria}
              onChange={(e) => setEditTitle(e.currentTarget.value)}
            />
            <select
              className="lite-followup-edit-group"
              value={editGroup}
              aria-label={t.lite2.followupsAddGroupLabel}
              onChange={(e) => setEditGroup(e.currentTarget.value as FollowupDueGroup)}
            >
              {GROUP_ORDER.map((g) => (
                <option key={g} value={g}>
                  {groupLabel(g)}
                </option>
              ))}
            </select>
            <button type="button" className="lite-followup-save" onClick={saveEdit}>
              {t.lite2.followupsSave}
            </button>
            <button type="button" className="lite-followup-cancel" onClick={() => setEditingId(null)}>
              {t.lite2.followupsCancel}
            </button>
          </div>
        ) : (
          <>
            <div className="lite-followup-main">
              {!item.done ? (
                <button
                  type="button"
                  className="lite-followup-check"
                  aria-label={`${t.lite2.followupsDone} — ${item.title}`}
                  onClick={() => completeFollowup(item.id)}
                />
              ) : (
                <span className="lite-followup-done-mark" aria-hidden="true">
                  ✓
                </span>
              )}
              <div className="lite-followup-body">
                <p className="lite-followup-title">{item.title}</p>
                {item.note ? <p className="lite-followup-note">{item.note}</p> : null}
                <span className="lite-followup-source">{sourceLabel(item.source)}</span>
                {item.doneAt ? (
                  <span className="lite-followup-donedate">
                    {t.lite2.followupsCompletedAt} {item.doneAt.slice(0, 16).replace('T', ' ')}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="lite-followup-actions">
              {/* feat-058：曾是裸 mailto: 链接，现在开应用内草稿框（可改正文 → 复制到聊天
                  应用 / 邮件 / 完成）。 */}
              <button
                type="button"
                className="lite-followup-mail"
                onClick={() => openDraft(draftFromFollowup(item))}
              >
                {t.lite2.followupsDraftMail}
              </button>
              {!item.done ? (
                <button
                  type="button"
                  className="lite-followup-edit-btn"
                  onClick={() => startEdit(item)}
                >
                  {t.lite2.followupsEdit}
                </button>
              ) : null}
              {opts.showRestore ? (
                <button
                  type="button"
                  className="lite-followup-restore"
                  onClick={() => reopenFollowup(item.id)}
                >
                  {t.lite2.followupsRestore}
                </button>
              ) : null}
              <button
                type="button"
                className="lite-followup-delete"
                onClick={() => deleteFollowup(item.id)}
              >
                {t.lite2.followupsDelete}
              </button>
            </div>
          </>
        )}
      </li>
    )
  }

  return (
    <section className="scene scene-nexus is-active lite-followups" aria-label={t.lite2.tabFollowups}>
      <div className="lite-followups-scroll">
        <div className="lite-followups-frame">
          <header className="lite-followups-header">
            <p className="eyebrow">{t.lite2.followupsEyebrow}</p>
            <h1>{t.lite2.followupsTitle}</h1>
          </header>

          <div className="lite-followups-subtabs" role="tablist" aria-label={t.lite2.followupsViewAria}>
            <button
              type="button"
              className={classNames(['lite-followups-subtab', tab === 'active' && 'is-active'])}
              aria-pressed={tab === 'active'}
              data-subtab="active"
              onClick={() => setTab('active')}
            >
              {t.lite2.followupsActiveTab}
            </button>
            <button
              type="button"
              className={classNames(['lite-followups-subtab', tab === 'history' && 'is-active'])}
              aria-pressed={tab === 'history'}
              data-subtab="history"
              onClick={() => setTab('history')}
            >
              {t.lite2.followupsHistoryTab}
              {history.length > 0 ? ` · ${history.length}` : ''}
            </button>
          </div>

          {tab === 'active' ? (
            <>
              <form className="lite-followups-add" onSubmit={submitAdd}>
                <input
                  type="text"
                  className="lite-followup-add-title"
                  value={newTitle}
                  placeholder={t.lite2.followupsAddTitlePlaceholder}
                  aria-label={t.lite2.followupsAddTitlePlaceholder}
                  onChange={(e) => setNewTitle(e.currentTarget.value)}
                />
                <select
                  className="lite-followup-add-group"
                  value={newGroup}
                  aria-label={t.lite2.followupsAddGroupLabel}
                  onChange={(e) => setNewGroup(e.currentTarget.value as FollowupDueGroup)}
                >
                  {GROUP_ORDER.map((g) => (
                    <option key={g} value={g}>
                      {groupLabel(g)}
                    </option>
                  ))}
                </select>
                <button type="submit" className="lite-followup-add-submit">
                  {t.lite2.followupsAddSubmit}
                </button>
              </form>

              {active.length === 0 ? (
                <p className="lite-followups-empty-note">{t.lite2.followupsEmptyActive}</p>
              ) : (
                GROUP_ORDER.map((group) =>
                  groups[group].length > 0 ? (
                    <section
                      key={group}
                      className="lite-followups-group"
                      data-group={group}
                      aria-label={groupLabel(group)}
                    >
                      <p className="eyebrow lite-followups-group-label">{groupLabel(group)}</p>
                      <ul className="lite-followups-list">
                        {groups[group].map((item) => renderItem(item, { showRestore: false }))}
                      </ul>
                    </section>
                  ) : null,
                )
              )}
            </>
          ) : (
            <>
              {history.length === 0 ? (
                <p className="lite-followups-empty-note">{t.lite2.followupsEmptyHistory}</p>
              ) : (
                <ul className="lite-followups-list lite-followups-history-list">
                  {history.map((item) => renderItem(item, { showRestore: true }))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
