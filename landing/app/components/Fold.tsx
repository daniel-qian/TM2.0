// Native-details fold-out (no client JS). Collapsed sections live inside —
// off the 7-screen roadshow scroll, one click away for the judge who digs.
// ADR-0018 restructure, 2026-07-03.

import type { ReactNode } from "react";

export function Fold({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="fold">
      <summary>
        <span>{label}</span>
        <span className="fold__icon" aria-hidden="true">+</span>
      </summary>
      <div className="fold__body">{children}</div>
    </details>
  );
}
