// Playbooks proof — the 6 partner-authored SCN playbooks surfaced as concrete
// "situations Avery handles". "Playbooks" is a locked do-not-translate term.
// Strings from the i18n dictionary.

import type { Dict } from "../i18n";

export function Playbooks({ t }: { t: Dict["playbooks"] }) {
  return (
    <section className="section section--ink" id="playbooks">
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

        <div className="playbook-grid">
          {t.items.map((s) => (
            <div className="playbook-card" key={s.id}>
              <span className="playbook-card__id">{s.id}</span>
              <h4>{s.name}</h4>
              <p>{s.p}</p>
              <div className="playbook-card__escalate">{s.escalate}</div>
            </div>
          ))}
        </div>

        <p className="playbook-foot">{t.footnote}</p>
      </div>
    </section>
  );
}
