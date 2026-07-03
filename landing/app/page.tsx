import { getDict, resolveLocale } from "./i18n";
import { LangSwitch } from "./components/LangSwitch";
import { Hero } from "./components/Hero";
import { MorningBriefing } from "./components/MorningBriefing";
import { MarketGap } from "./components/MarketGap";
import { Roi } from "./components/Roi";
import { Revenue } from "./components/Revenue";
import { Moat } from "./components/Moat";
import { BookCta } from "./components/BookCta";

// 2026-07-03 restructure (ADR-0018, investor roadshow): 7 screens —
// hero → product in one look → market gap + TAM → ROI account → revenue model
// → moat (Playbooks/Modules/eval fold in) → CTA. Cut sections (Audience /
// DemoVideo placeholder / WhatItIs / WhyItMatters / TrustLayer / Method /
// OutputShape / Stack) live in git history; Landscape folds into MarketGap.
//
// Locale via ?lang= (EN default). Reading searchParams makes this page dynamic.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const { lang } = await searchParams;
  const locale = resolveLocale(lang);
  const t = getDict(locale);

  return (
    <main>
      <LangSwitch locale={locale} t={t.langSwitch} />
      <Hero t={t.hero} />
      <MorningBriefing t={t.morningBriefing} />
      <MarketGap t={t.marketGap} tLandscape={t.landscape} />
      <Roi t={t.roi} />
      <Revenue t={t.revenue} />
      <Moat
        t={t.moat}
        tPlaybooks={t.playbooks}
        tModules={t.modules}
        tEval={t.evalSection}
      />
      <BookCta t={t.bookCta} />

      <footer className="foot wrap">
        <span>{t.footer.left}</span>
        <span>{t.footer.right}</span>
      </footer>
    </main>
  );
}
