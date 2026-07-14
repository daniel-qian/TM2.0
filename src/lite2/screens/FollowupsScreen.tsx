import { useDict } from '../../shared/i18n/useDict'

// feat-035 · lite2 屏 3：Follow-ups（6-tab 骨架的空态占位）——PRD F3 骨架先行。
// 本波只立 tab + 诚实 Coming 标注；真派生（分诊卡/议事室/快问/多看一眼来源标签）、
// 今天/本周/之后分组、完成/编辑/删除/历史、localStorage 持久化留给 feat-036。
// 🔴 红线：零人卡、零数字——纯叙事空态。墙不打洞（不 import src/story/**、不 import src/lite/**）。
export function FollowupsScreen() {
  const { t } = useDict()

  return (
    <section className="scene scene-nexus is-active lite-followups" aria-label="Follow-ups">
      <section className="nexus-empty lite-followups-empty" aria-label="Follow-ups — coming soon">
        <p className="eyebrow lite-followups-eyebrow">{t.lite2.followupsEyebrow}</p>
        <h2>{t.lite2.followupsTitle}</h2>
        <p>{t.lite2.followupsBody}</p>
        <p className="lite-followups-comingsoon">{t.lite2.followupsComingSoon}</p>
      </section>
    </section>
  )
}
