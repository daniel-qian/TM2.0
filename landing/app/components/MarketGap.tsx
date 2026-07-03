// Screen 3 — market gap + bottom-up TAM/SOM (ADR-0018 restructure).
// Gap-bar SCORES are the deck's illustrative numbers (language-agnostic).
// TAM/SOM are an ILLUSTRATIVE bottom-up model — formula shown on the page IS
// the annotation (inputs documented in en.ts). The old decision-strip and
// vs-rows were cut (overlapped the panels); the Landscape matrix folds in
// below. ⚠ 待 Danny 审字.

import type { Dict } from "../i18n";
import { Fold } from "./Fold";
import { Landscape } from "./Landscape";

const SCORES: [number, number][] = [[82, 41], [76, 48], [84, 39]];
const AVERY_SCORES: [number, number] = [92, 88];

function Metric({ score, label }: { score: number; label: string }) {
  return (
    <div className="gap-metric">
      <div className="row"><strong>{score}</strong><span>{label}</span></div>
      <div className="gap-bar"><span style={{ width: `${score}%` }} /></div>
    </div>
  );
}

export function MarketGap({
  t,
  tLandscape,
}: {
  t: Dict["marketGap"];
  tLandscape: Dict["landscape"];
}) {
  return (
    <section className="section" id="gap">
      <div className="wrap">
        <div className="split-head">
          <div>
            <div className="eyebrow">{t.eyebrow}</div>
            <h2>{t.h2}</h2>
          </div>
          <p className="lede">{t.lede}</p>
        </div>

        <div className="eyebrow" style={{ marginBottom: 14 }}>{t.gapLabel}</div>
        <div className="gap-grid">
          {t.panels.map((p, i) => (
            <div className="gap-panel" key={p.name}>
              <span className="eyebrow">{p.name}</span>
              <h4>{p.line}</h4>
              <Metric score={SCORES[i][0]} label={p.m1label} />
              <Metric score={SCORES[i][1]} label={p.m2label} />
            </div>
          ))}
          <div className="gap-panel gap-panel--avery">
            <span className="eyebrow">{t.averyPanel.name}</span>
            <h4>{t.averyPanel.line}</h4>
            <Metric score={AVERY_SCORES[0]} label={t.averyPanel.m1label} />
            <Metric score={AVERY_SCORES[1]} label={t.averyPanel.m2label} />
          </div>
        </div>

        {/* Bottom-up market math — the derivation is the credibility. */}
        <div className="tam">
          <div className="eyebrow">{t.tam.eyebrow}</div>
          <h3>{t.tam.title}</h3>
          <p className="tam__note">{t.tam.note}</p>
          <div>
            {t.tam.factors.map((f) => (
              <div className="tam__row" key={f.k}>
                <span className="tam__k">{f.k}<em>{f.d}</em></span>
                <strong>{f.v}</strong>
              </div>
            ))}
            <div className="tam__row tam__row--sam">
              <span className="tam__k">{t.tam.sam.k}</span>
              <strong>{t.tam.sam.v}</strong>
            </div>
            <div className="tam__row tam__row--som">
              <span className="tam__k">{t.tam.som.k}</span>
              <strong>{t.tam.som.v}</strong>
            </div>
          </div>
          <p className="tam__som-note">{t.tam.somNote}</p>
        </div>

        <p className="overseas-line">{t.overseas}</p>

        <Fold label={t.landscapeToggle}>
          <Landscape t={tLandscape} />
        </Fold>
      </div>
    </section>
  );
}
