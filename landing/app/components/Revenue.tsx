// Screen 5 — the revenue model, the screen the finance room came for
// (ADR-0018 restructure; content from the partner's revenue-model deck,
// 2026-07-02): pricing architecture + component ranges + revenue mix at scale
// + condensed roadmap. Prices are the DESIGNED pricing model (pre-revenue);
// mix percentages are the at-scale design, not bookings. ⚠ 待 Danny 审字.

import type { Dict } from "../i18n";

export function Revenue({ t }: { t: Dict["revenue"] }) {
  return (
    <section className="section" id="revenue">
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

        <div className="offer-grid">
          {t.offers.map((o, i) => (
            <div className={`offer${i === 1 ? " offer--core" : ""}`} key={o.name}>
              <span className="offer__tag">{o.tag}</span>
              <h4>{o.name}</h4>
              <div className="offer__price">{o.price}</div>
              <p>{o.d}</p>
            </div>
          ))}
        </div>

        <div className="eyebrow mix-title">{t.componentsTitle}</div>
        <div className="price-list">
          {t.components.map((c) => (
            <div className="price-list__row" key={c.k}>
              <span>{c.k}</span>
              <strong>{c.v}</strong>
            </div>
          ))}
        </div>

        <div className="eyebrow mix-title">{t.mixTitle}</div>
        <div className="kpi-grid">
          {t.kpis.map((k, i) => (
            <div className={`kpi${i % 2 === 1 ? " kpi--alt" : ""}`} key={k.lbl}>
              <div className="lbl">{k.lbl}</div>
              <div className="val">{k.val}<span className="u">%</span></div>
              <div className="delta">{k.delta}</div>
              <div className="desc">{k.desc}</div>
            </div>
          ))}
        </div>

        <div className="eyebrow mix-title">{t.roadmapTitle}</div>
        <div className="grid-cards grid-cards--3">
          {t.roadmap.map((r, i) => (
            <div className={`ed-card${i % 2 === 1 ? " ed-card--alt" : ""}`} key={r.n}>
              <div className="n">{r.n}</div>
              <h4>{r.h4}</h4>
              <p>{r.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
