import { useDict } from '../../shared/i18n/useDict'
import { useLite } from '../store'
import { PLAYBOOK_CATALOG, useOnboard } from '../onboardStore'

// feat-025 · lite 屏 4：Playbooks——Danny 2026-07-09 拍板 Q1(a)。
// rich-align-0722/08：从「空态屏」升级成「有真数据就长出方法库」：
//   · 满态（payload.playbooks 有卡，来自 SOP 文档 `## 方法：` 小节抽取）→ 2 列方法卡网格
//     （非交互 article，不渲染 button——将来加详情展开再升 button）。
//   · 空态（非 demo / 无 SOP 文档）→ 维持 feat-025/045 的 coming-soon 诚实标 + onboarding 勾选槽位/
//     回落槽位 + 回看向导入口，行为零变化。🔴 绝不为凑网格造空卡墙（踩 absent≠none）。
// 🔴 红线：本屏零人卡、零数字/评分——方法卡是 SOP 面（含「升级红线」「新人爬坡」等提到员工的卡），
//   但纯规范文本、零人身分数。墙不打洞（不 import src/story/**）。
export function PlaybooksScreen() {
  const { t } = useDict()
  const l = t.lite2

  const rawTeam = useLite((s) => s.rawTeam)
  const playbooks = rawTeam?.playbooks ?? []

  const onboardStatus = useOnboard((s) => s.status)
  const picks = useOnboard((s) => s.playbooks)
  const company = useOnboard((s) => s.company)
  const reopenOnboarding = useOnboard((s) => s.reopen)

  // ── 满态：SOP 抽出的真方法卡 → 2 列方法库网格 ────────────────────────────────────────────
  if (playbooks.length > 0) {
    return (
      <section className="scene scene-nexus is-active lite-playbooks" aria-label={l.tabPlaybooks}>
        {/* 满态用「滚动壳 + 顶让位夹层」而非空态的 .nexus-empty 居中卡——否则卡多了页头被
            浮动顶栏盖住（同 projects 屏 .lite-projects-scroll/frame 语法）。 */}
        <div className="lite-playbooks-scroll">
          <section className="lite-playbooks-library" aria-label={l.playbooksLibraryAria}>
            <p className="eyebrow lite-playbooks-eyebrow">{l.playbooksLibraryEyebrow}</p>
            <h2>{l.playbooksLibraryTitle}</h2>
            <p className="lite-playbooks-library-sub">{l.playbooksLibrarySub}</p>
            <div className="lite-playbooks-grid">
              {playbooks.map((card, i) => (
              <article key={`${card.title}-${i}`} className="lite-playbooks-card">
                <span
                  className="lite-playbooks-card-icon"
                  aria-hidden="true"
                  data-tone={i % 4}
                />
                <div className="lite-playbooks-card-body">
                  <h3 className="lite-playbooks-card-title">{card.title}</h3>
                  {card.description ? (
                    <p className="lite-playbooks-card-desc">{card.description}</p>
                  ) : null}
                  {(card.tags ?? []).length > 0 ? (
                    <ul className="lite-playbooks-card-tags" aria-label={l.playbooksCardTagsAria}>
                      {(card.tags ?? []).map((tag) => (
                        <li key={tag} className="lite-badge lite-playbooks-card-tag">
                          {tag}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    )
  }

  // ── 空态（非 demo / 无 SOP 文档）：coming-soon 诚实标 + 勾选/回落槽位 + 回看向导入口 ──────────
  // 只有真正走完向导的勾选才改变槽位（skipped/中途关闭不算"选过"——不替用户做主）。
  const chosen =
    onboardStatus === 'done' && picks.length > 0
      ? PLAYBOOK_CATALOG.filter((entry) => picks.includes(entry.id))
      : null

  const fallbackSlots = [l.playbooksSlotRoster, l.playbooksSlotIncident, l.playbooksSlotPack]

  return (
    <section className="scene scene-nexus is-active lite-playbooks" aria-label={l.tabPlaybooks}>
      <section className="nexus-empty lite-playbooks-empty" aria-label={l.playbooksEmptyAria}>
        <p className="eyebrow lite-playbooks-eyebrow">{l.playbooksEyebrow}</p>
        <h2>{l.playbooksTitle}</h2>
        <p>{l.playbooksBody}</p>
        {chosen && company.trim() ? (
          <p className="lite-playbooks-company">
            {l.playbooksForCompany.replace('{company}', company.trim())}
          </p>
        ) : null}

        {chosen ? (
          // onboarding 勾选生效：槽位 = 所选 playbook（标题+一句说明，Coming 诚实标注）。
          <div className="lite-playbooks-slots" aria-label={l.playbooksChosenLabel}>
            <p className="eyebrow lite-playbooks-slots-label">{l.playbooksChosenLabel}</p>
            <ul className="lite-playbooks-slot-list">
              {chosen.map((entry) => (
                <li key={entry.id} className="lite-playbooks-slot" data-playbook-id={entry.id}>
                  <span className="lite-badge lite-playbooks-slot-tag" aria-hidden="true">
                    {l.playbooksChosenTag}
                  </span>
                  <span className="lite-playbooks-slot-text">
                    <strong className="lite-playbooks-slot-title">{entry.title(l)}</strong>
                    {' — '}
                    {entry.body(l)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          // 数据槽预告（feat-025 原样）：接入真 pack（feat-019 酒店包）后这里长出真 playbook
          <div className="lite-playbooks-slots" aria-label={l.playbooksSlotLabel}>
            <p className="eyebrow lite-playbooks-slots-label">{l.playbooksSlotLabel}</p>
            <ul className="lite-playbooks-slot-list">
              {fallbackSlots.map((slot) => (
                <li key={slot} className="lite-playbooks-slot">
                  <span className="lite-badge lite-playbooks-slot-tag" aria-hidden="true">
                    {l.playbooksEmptyTag}
                  </span>
                  <span className="lite-playbooks-slot-text">{slot}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="lite-playbooks-comingsoon">{l.playbooksComingSoon}</p>

        {/* open-loop-0720：Danny 拍板「有数据就不弹」时选的那个选项原话是「弹窗保留在菜单里
            随时能再看」——但那个入口从没被造出来，老客户从此再也翻不到上手向导。Playbooks
            是它的自然落点：本屏本来就是"怎么用这个产品"的地方。只加一个链接，不加新屏、
            不加设置面板。reopen() 会无视"有没有数据"那条自动弹出的规矩强制掀开向导
            （见 onboardStore.ts forceOpen 的调用方契约注释）。 */}
        <button
          type="button"
          className="lite-btn lite-btn--ghost lite-playbooks-reopen-onboarding"
          onClick={() => reopenOnboarding()}
        >
          {l.playbooksReopenOnboarding} →
        </button>
      </section>
    </section>
  )
}
