// Screen 2 — the product in one look (deck slide 09, illustrative mockup).
// Strings from i18n dictionary. The 47m/94%/3× stats are RESTORED mock design
// targets (ADR-0018 §3) and carry a visible micro-label (statNote).

import type { Dict } from "../i18n";

const STRIPES = ["risk", "action", "win", "people"];

export function MorningBriefing({ t }: { t: Dict["morningBriefing"] }) {
  return (
    <section className="section" id="briefing">
      <div className="wrap">
        <div className="masthead">
          <span>{t.mastheadL}</span>
          <span>{t.mastheadR}</span>
        </div>
        <div className="split-head">
          <div>
            <div className="eyebrow">{t.eyebrow}</div>
            <h2>{t.h2}</h2>
          </div>
          <p className="lede">{t.lede}</p>
        </div>

        <div className="briefing-layout">
          <div className="morning-card" aria-label="Illustrative Avery morning briefing">
            <div className="morning-top">
              <div>
                <strong>{t.cardGreeting}</strong>
                <span>{t.cardCount}</span>
              </div>
              <div className="morning-time">{t.cardTime}</div>
            </div>
            <div className="briefing-items">
              {t.items.map((it, i) => (
                <div className="briefing-item" key={i}>
                  <div className={`briefing-stripe ${STRIPES[i] ?? ""}`} />
                  <div className="briefing-copy">
                    <div className="tag">{it.tag}</div>
                    <h4>{it.h4}</h4>
                    <p>{it.p}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "clamp(20px,3vw,32px)" }}>
            <div className="ed-card ed-card--paper" style={{ flex: 1, justifyContent: "center" }}>
              <div className="eyebrow">{t.promiseEyebrow}</div>
              <h3 style={{ fontSize: "clamp(30px,4vw,56px)", lineHeight: 0.95 }}>
                {t.promiseTitleA}<br />{t.promiseTitleB}
              </h3>
              <p style={{ fontSize: 17 }}>{t.promiseP}</p>
            </div>
            <div>
              <div className="stat-row">
                {t.stats.map((s, i) => (
                  <div className="stat-tile" key={i}><strong>{s.num}</strong><span>{s.label}</span></div>
                ))}
              </div>
              {/* Visible micro-label: these are design targets, not measurements
                  (ADR-0018 §3 — own the assumption before the room asks). */}
              <p className="stat-note">{t.statNote}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
