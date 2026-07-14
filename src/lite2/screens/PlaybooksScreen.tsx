import { useDict } from '../../shared/i18n/useDict'
import { PLAYBOOK_CATALOG, useOnboard } from '../onboardStore'

// feat-025 · lite 屏 4：Playbooks（空态屏）——Danny 2026-07-09 拍板 Q1(a)。
// 当前无数据 → 干净空态。文案锚「未来 custom-agent 能力」（接入你的 SOP/playbook 后长出来），
// 诚实标 coming-soon；为将来接真 pack（feat-019 酒店包）留数据槽。
// 不移植 story 的 scripted case 复盘（story 的 playbook = 脚本化 case 卡，与 lite 真数据定位不同）。
//
// feat-045（PRD F7）：onboarding 勾选结果写进槽位——向导走完且有所选时，槽位区按所选
// playbook 呈现"将来这里会长出什么"的说明行（标题+一句人话，每行带稳定 data-playbook-id，
// 门相位 onboardPersist 按具体 id 断言）；沿用既有 Coming 诚实语法（每行带 slot-tag，
// coming-soon 落款不动）。没走向导/没勾选 → 回落 feat-025 的三条通用槽位，行为零变化。
// 🔴 红线：本屏零人卡、零数字/评分——纯叙事空态。墙不打洞（不 import src/story/**）。
export function PlaybooksScreen() {
  const { t } = useDict()
  const l = t.lite2

  const onboardStatus = useOnboard((s) => s.status)
  const picks = useOnboard((s) => s.playbooks)
  const company = useOnboard((s) => s.company)

  // 只有真正走完向导的勾选才改变槽位（skipped/中途关闭不算"选过"——不替用户做主）。
  const chosen =
    onboardStatus === 'done' && picks.length > 0
      ? PLAYBOOK_CATALOG.filter((entry) => picks.includes(entry.id))
      : null

  const fallbackSlots = [l.playbooksSlotRoster, l.playbooksSlotIncident, l.playbooksSlotPack]

  return (
    <section className="scene scene-nexus is-active lite-playbooks" aria-label="Playbooks">
      <section className="nexus-empty lite-playbooks-empty" aria-label="Playbooks — coming soon">
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
                  <span className="lite-playbooks-slot-tag" aria-hidden="true">
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
                  <span className="lite-playbooks-slot-tag" aria-hidden="true">
                    {l.playbooksEmptyTag}
                  </span>
                  <span className="lite-playbooks-slot-text">{slot}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="lite-playbooks-comingsoon">{l.playbooksComingSoon}</p>
      </section>
    </section>
  )
}
