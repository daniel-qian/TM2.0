// Screen 4 — the ROI account (ADR-0018 restructure). WrongCut's four-cost
// story reframed as the cost-saving account; absorbs old WhyItMatters lede.
// ALL figures are an ILLUSTRATIVE MODEL (see en.ts comments). ⚠ 待 Danny 审字.

import type { Dict } from "../i18n";

export function Roi({ t }: { t: Dict["roi"] }) {
  return (
    <section className="section" id="roi">
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

        <div className="grid-cards grid-cards--4">
          {t.steps.map((s, i) => (
            <div className={`ed-card${i % 2 === 1 ? " ed-card--alt" : ""}`} key={s.n}>
              <div className="n">{s.n}</div>
              <h4>{s.h4}</h4>
              <p>{s.p}</p>
              <div className="meta"><span>{s.metaA}</span><span>{s.metaB}</span></div>
            </div>
          ))}
        </div>

        <div className="roi-account">
          <div className="roi-account__head">
            <h3>{t.account.title}</h3>
            <span>{t.account.note}</span>
          </div>
          {t.account.lines.map((l) => (
            <div className="roi-account__row" key={l.k}>
              <span className="tam__k">{l.k}<em>{l.d}</em></span>
              <strong>{l.v}</strong>
            </div>
          ))}
          <div className="roi-account__punch">{t.account.punch}</div>
        </div>
      </div>
    </section>
  );
}
