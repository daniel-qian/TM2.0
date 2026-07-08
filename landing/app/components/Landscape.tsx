// Deck slide 07 (HR AI landscape) capability matrix. Text from i18n dictionary;
// the ✓/~/× marks are language-agnostic data kept here, aligned by index to the
// dictionary's groups/rows. Columns are CATEGORIES (no brand names).

import { Fragment } from "react";
import type { Dict } from "../i18n";

type Mark = "yes" | "no" | "partial";

// marks[group][row] = { avery, others[5] } — same order as dict.landscape.groups
const MARKS: { avery: Mark; others: Mark[] }[][] = [
  [
    { avery: "yes", others: ["no", "no", "no", "no", "no"] },
    { avery: "yes", others: ["no", "partial", "no", "no", "no"] },
    { avery: "yes", others: ["partial", "no", "no", "partial", "no"] },
    { avery: "yes", others: ["no", "no", "no", "no", "no"] },
    { avery: "yes", others: ["partial", "partial", "no", "no", "no"] },
    { avery: "yes", others: ["no", "no", "no", "no", "no"] },
  ],
  [
    { avery: "yes", others: ["partial", "yes", "partial", "yes", "no"] },
    { avery: "yes", others: ["partial", "partial", "partial", "yes", "partial"] },
    { avery: "no", others: ["yes", "partial", "yes", "partial", "yes"] },
    { avery: "no", others: ["yes", "yes", "no", "no", "yes"] },
    { avery: "no", others: ["yes", "yes", "no", "no", "partial"] },
  ],
];

function Cell({ mark, avery }: { mark: Mark; avery?: boolean }) {
  const glyph = mark === "yes" ? "✓" : mark === "partial" ? "~" : "×";
  return (
    <td className={avery ? "is-avery" : undefined}>
      <span className={`mk mk--${mark}`} aria-label={mark}>{glyph}</span>
    </td>
  );
}

export function Landscape({ t }: { t: Dict["landscape"] }) {
  return (
    <section className="section" id="landscape">
      <div className="wrap">
        <div className="split-head">
          <div>
            <div className="eyebrow">{t.eyebrow}</div>
            <h2>{t.h2}</h2>
          </div>
          <p className="lede">{t.lede}</p>
        </div>

        <div className="matrix-scroll">
          <table className="matrix">
            <thead>
              <tr>
                <th>{t.capability}</th>
                <th className="is-avery">{t.avery}</th>
                {t.cols.map((c) => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {t.groups.map((g, gi) => (
                <Fragment key={g.group}>
                  <tr>
                    <td colSpan={t.cols.length + 2} style={{ background: "var(--bg-2)", fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", fontSize: 12 }}>
                      {g.group}
                    </td>
                  </tr>
                  {g.rows.map((r, ri) => (
                    <tr key={r.title}>
                      <td className="layer"><strong style={{ fontSize: 16 }}>{r.title}</strong><span>{r.sub}</span></td>
                      <Cell mark={MARKS[gi][ri].avery} avery />
                      {MARKS[gi][ri].others.map((m, i) => <Cell key={i} mark={m} />)}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="matrix-legend">
          <span><span className="mk mk--yes">✓</span> {t.legendYes}</span>
          <span><span className="mk mk--partial">~</span> {t.legendPartial}</span>
          <span><span className="mk mk--no">×</span> {t.legendNo}</span>
        </div>
      </div>
    </section>
  );
}
