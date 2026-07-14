import { useDict } from '../../shared/i18n/useDict'

// feat-025 · lite 屏 4：Playbooks（空态屏）——Danny 2026-07-09 拍板 Q1(a)。
// 当前无数据 → 干净空态。文案锚「未来 custom-agent 能力」（接入你的 SOP/playbook 后长出来），
// 诚实标 coming-soon；为将来接真 pack（feat-019 酒店包）留数据槽。
// 不移植 story 的 scripted case 复盘（story 的 playbook = 脚本化 case 卡，与 lite 真数据定位不同）。
// 🔴 红线：本屏零人卡、零数字/评分——纯叙事空态。墙不打洞（不 import src/story/**）。
export function PlaybooksScreen() {
  const { t } = useDict()

  const slots = [
    t.lite2.playbooksSlotRoster,
    t.lite2.playbooksSlotIncident,
    t.lite2.playbooksSlotPack,
  ]

  return (
    <section className="scene scene-nexus is-active lite-playbooks" aria-label="Playbooks">
      <section className="nexus-empty lite-playbooks-empty" aria-label="Playbooks — coming soon">
        <p className="eyebrow lite-playbooks-eyebrow">{t.lite2.playbooksEyebrow}</p>
        <h2>{t.lite2.playbooksTitle}</h2>
        <p>{t.lite2.playbooksBody}</p>

        {/* 数据槽预告：接入真 pack（feat-019 酒店包）后这里长出真 playbook */}
        <div className="lite-playbooks-slots" aria-label={t.lite2.playbooksSlotLabel}>
          <p className="eyebrow lite-playbooks-slots-label">{t.lite2.playbooksSlotLabel}</p>
          <ul className="lite-playbooks-slot-list">
            {slots.map((slot) => (
              <li key={slot} className="lite-playbooks-slot">
                <span className="lite-playbooks-slot-tag" aria-hidden="true">
                  {t.lite2.playbooksEmptyTag}
                </span>
                <span className="lite-playbooks-slot-text">{slot}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="lite-playbooks-comingsoon">{t.lite2.playbooksComingSoon}</p>
      </section>
    </section>
  )
}
