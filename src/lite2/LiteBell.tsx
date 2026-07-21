import { useLite } from './store'
import {
  NOTIF_TARGET,
  selectUnreadCount,
  useNotify,
  type NotifKind,
} from './notifyStore'
import { useDict } from '../shared/i18n/useDict'
import type { Dict } from '../shared/i18n'

// feat-045 · lite2 通知铃铛（PRD F5）。挂在 LiteTopbar；items 全部来自 notifyStore 的
// 真事件订阅（ingest 就绪 / run 完成 / 快问收齐 / 新矛盾卡）——这个组件只负责呈现与
// 已读标记，没有任何造通知的入口。
//
// 🔴 红线：kind → 泛化文案（notifIngest/notifRun/notifAsk/notifGap），永不点名员工个人；
// 未读徽章计的是"通知条数"，不是任何人的读数。空态给诚实说明（真事件会落在这里），
// 不摆假通知充门面（合伙人版反例）。

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

function notifText(kind: NotifKind, l: Dict['lite2']): string {
  switch (kind) {
    case 'ingest':
      return l.notifIngest
    case 'run':
      return l.notifRun
    case 'ask':
      return l.notifAsk
    default:
      return l.notifGap
  }
}

export function LiteBell() {
  const { t } = useDict()
  const l = t.lite2

  const items = useNotify((s) => s.items)
  const open = useNotify((s) => s.open)
  const toggleOpen = useNotify((s) => s.toggleOpen)
  const closePop = useNotify((s) => s.closePop)
  const markRead = useNotify((s) => s.markRead)
  const markAllRead = useNotify((s) => s.markAllRead)
  const unread = useNotify(selectUnreadCount)

  const goScreen = useLite((s) => s.goScreen)

  return (
    <div className="lite-bell">
      <button
        type="button"
        className="lite-bell-toggle"
        aria-label={
          unread > 0 ? `${l.bellAria} — ${fill(l.bellUnreadAria, { count: unread })}` : l.bellAria
        }
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <svg
          className="lite-bell-icon"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 ? <span className="lite-bell-badge">{unread}</span> : null}
      </button>

      {open ? (
        <div className="lite-bell-pop" role="region" aria-label={l.bellAria}>
          <header className="lite-bell-head">
            <span className="lite-bell-title">{l.bellTitle}</span>
            {items.length > 0 ? (
              <button type="button" className="lite-btn lite-btn--ghost lite-bell-markall" onClick={markAllRead}>
                {l.bellMarkAll}
              </button>
            ) : null}
          </header>
          {items.length === 0 ? (
            <p className="lite-bell-empty">{l.bellEmpty}</p>
          ) : (
            <ul className="lite-bell-list">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`lite-notif-item${n.read ? '' : ' is-unread'}`}
                    data-notif-kind={n.kind}
                    data-notif-id={n.id}
                    onClick={() => {
                      markRead(n.id)
                      goScreen(NOTIF_TARGET[n.kind])
                      closePop()
                    }}
                  >
                    <span className="lite-notif-dot" aria-hidden="true" />
                    <span className="lite-notif-text">{notifText(n.kind, l)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
