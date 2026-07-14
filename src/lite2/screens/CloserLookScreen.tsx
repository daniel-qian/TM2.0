import { useDict } from '../../shared/i18n/useDict'

// feat-035 · lite2 屏 4：A closer look（6-tab 骨架的空态占位）——PRD F4 骨架先行。
// 本波只立 tab + 诚实 Coming 标注；真矛盾点派生（对照卡：文件里的说法 / 实际信号）、
// 解决/忽略、历史折叠、直接问问本人→议事室预填留给 feat-037。
// 🔴 红线：零人卡、零数字；命名走锁定词族——本屏与其文案永不出现 gap/差距/现实 字样。
// 墙不打洞（不 import src/story/**、不 import src/lite/**）。
export function CloserLookScreen() {
  const { t } = useDict()

  return (
    <section className="scene scene-nexus is-active lite-closerlook" aria-label="A closer look">
      <section className="nexus-empty lite-closerlook-empty" aria-label="A closer look — coming soon">
        <p className="eyebrow lite-closerlook-eyebrow">{t.lite2.closerLookEyebrow}</p>
        <h2>{t.lite2.closerLookTitle}</h2>
        <p>{t.lite2.closerLookBody}</p>
        <p className="lite-closerlook-comingsoon">{t.lite2.closerLookComingSoon}</p>
      </section>
    </section>
  )
}
