"use client";

import { useState } from "react";
import type { Dict } from "../i18n";

// Email capture + final CTA + deck closing line. Form is a scaffold (confirms
// locally; wire to a real list/scheduler before launch). Strings from i18n
// dictionary. ⚠ 待 Danny 审字.

export function BookCta({ t }: { t: Dict["bookCta"] }) {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    // TODO(real-asset): POST to the real capture endpoint / scheduler.
    setDone(true);
  }

  return (
    <section className="wrap" id="book">
      <div className="cta">
        <div className="eyebrow" style={{ marginBottom: 18 }}>{t.eyebrow}</div>
        <h2>{t.h2}</h2>
        <p>{t.p}</p>

        {done ? (
          <p className="capture__ok">{t.ok}</p>
        ) : (
          <form className="capture" onSubmit={onSubmit}>
            <input
              type="email"
              required
              placeholder={t.placeholder}
              aria-label="Your work email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" className="btn btn--primary">{t.button}</button>
          </form>
        )}

        <p className="cta__micro">{t.micro}</p>

        {/* Investor-facing close (Will, 2026-07-03): buyer CTA stays above;
            this answers the room's "what's the ask", tied to the SOM figure. */}
        <p className="cta__investor">{t.investorNote}</p>

        <div className="closing-cols">
          {t.closing.map((c) => (
            <div key={c.lbl}>
              <div className="lbl">{c.lbl}</div>
              <div className="val">{c.val}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
