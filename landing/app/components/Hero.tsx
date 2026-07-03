// ⚠ 待 Danny 审字. Strings come from the i18n dictionary (app/i18n).
// 2026-07-03 (ADR-0018): slug switched to "Managers need safer HR decisions";
// "senior at your ear" retired from slug/footer surfaces. Ghost CTA now jumps
// to the revenue screen (investor audience). VISUAL: editorial deck cover
// (slide 01) — gradient Avery logo + Bodoni display + double-rule ornament.

import type { Dict } from "../i18n";

export function Hero({ t }: { t: Dict["hero"] }) {
  const [titleBefore, titleAfter] = t.title.split("{em}");
  return (
    <header className="hero">
      <div className="wrap">
        <div className="hero__top">
          <span>{t.topLeft}</span>
          <span>{t.topRight}</span>
        </div>

        <div className="intro-brand" aria-label="Avery logo">
          <svg className="avery-logo" viewBox="0 0 260 80" role="img" aria-label="Avery HR Intelligence logo">
            <defs>
              <linearGradient id="averyLeft" x1="12" y1="10" x2="40" y2="70" gradientUnits="userSpaceOnUse">
                <stop stopColor="#6366F1" />
                <stop offset="1" stopColor="#D946EF" />
              </linearGradient>
              <linearGradient id="averyRight" x1="40" y1="10" x2="68" y2="70" gradientUnits="userSpaceOnUse">
                <stop stopColor="#3B82F6" />
                <stop offset="1" stopColor="#22D3EE" />
              </linearGradient>
              <linearGradient id="averySpark" x1="32" y1="43" x2="48" y2="63" gradientUnits="userSpaceOnUse">
                <stop stopColor="#F43F5E" />
                <stop offset="1" stopColor="#FBBF24" />
              </linearGradient>
            </defs>
            <g>
              <path className="logo-mark-left" d="M 40 10 C 24 10, 12 35, 12 70 L 26 66 C 26 48, 32 35, 40 35 Z" fill="url(#averyLeft)" />
              <path className="logo-mark-right" d="M 40 10 C 56 10, 68 35, 68 70 L 54 66 C 54 48, 48 35, 40 35 Z" fill="url(#averyRight)" />
              <path className="logo-flame" d="M 40 43 Q 32 53 40 63 Q 48 53 40 43 Z" fill="url(#averySpark)" />
            </g>
            <text className="logo-word-main" x="84" y="52">AVERY</text>
            {/* Category label follows ADR-0018 (management-decision layer, not "HR software"). */}
            <text className="logo-tagline" x="88" y="68">DECISION INTELLIGENCE</text>
          </svg>
        </div>

        <div className="hero__kicker">{t.kicker}</div>

        <h1 className="hero__title">
          {titleBefore}
          <em>{t.em}</em>
          {titleAfter ?? ""}
        </h1>

        <div className="hero__ornament ornament" aria-hidden="true">
          <span className="lines" />
          <span className="word">·</span>
          <span className="lines" />
        </div>

        <p className="hero__sub">{t.sub}</p>

        <div className="hero__cta">
          <a className="btn btn--primary" href="#book">{t.ctaPrimary}</a>
          <a className="btn btn--ghost" href="#revenue">{t.ctaGhost}</a>
        </div>

        <p className="hero__reassure">{t.reassure}</p>
      </div>
    </header>
  );
}
