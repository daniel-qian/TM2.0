"use client";

// Deck slide 11 (Six modules) — interactive selector. Strings from i18n
// dictionary (passed from the server page).

import { useState } from "react";
import type { Dict } from "../i18n";

export function Modules({ t }: { t: Dict["modules"] }) {
  const [active, setActive] = useState(t.items[0]?.key ?? "risk");
  const sel = t.items.find((m) => m.key === active) ?? t.items[0];

  return (
    <section className="section section--ink" id="modules">
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

        <div className="module-grid">
          {t.items.map((m, i) => (
            <button
              key={m.key}
              type="button"
              className={`module-btn${i % 2 === 1 ? " module-btn--alt" : ""}${active === m.key ? " is-active" : ""}`}
              onClick={() => setActive(m.key)}
              aria-pressed={active === m.key}
            >
              <span className="lbl">{m.lbl}</span>
              <span className="val">{m.val}</span>
              <span className="desc">{m.desc}</span>
            </button>
          ))}
        </div>

        <div className="module-detail" aria-live="polite">
          <span className="tag">{t.selectedLabel}</span>
          <div>
            <strong>{sel.detailName}</strong>
            <p>{sel.detailBody}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
