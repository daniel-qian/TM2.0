// Screen 6 — defensibility (ADR-0018 restructure). Answers "why can't a
// general model just do this": playbook IP + benchmark data + trust
// architecture (absorbs old TrustLayer). Hosts fold-outs for Playbooks /
// Modules / the eval section; the honesty strip keeps the locked eval promise
// (no scorecard numbers until real human ratings).

import type { Dict } from "../i18n";
import { Fold } from "./Fold";
import { Playbooks } from "./Playbooks";
import { Modules } from "./Modules";
import { EvalContrast } from "./EvalContrast";

export function Moat({
  t,
  tPlaybooks,
  tModules,
  tEval,
}: {
  t: Dict["moat"];
  tPlaybooks: Dict["playbooks"];
  tModules: Dict["modules"];
  tEval: Dict["evalSection"];
}) {
  return (
    <section className="section section--ink" id="moat">
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

        <div className="grid-cards grid-cards--3">
          {t.pillars.map((p, i) => (
            <div className={`ed-card${i % 2 === 1 ? " ed-card--alt" : ""}`} key={p.n}>
              <div className="n">{p.n}</div>
              <h4>{p.h4}</h4>
              <p>{p.p}</p>
            </div>
          ))}
        </div>

        <p className="honesty-strip">{t.honesty}</p>

        <Fold label={t.playbooksToggle}>
          <Playbooks t={tPlaybooks} />
        </Fold>
        <Fold label={t.modulesToggle}>
          <Modules t={tModules} />
        </Fold>
        <Fold label={t.evalToggle}>
          <EvalContrast t={tEval} />
        </Fold>
      </div>
    </section>
  );
}
