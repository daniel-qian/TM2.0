import type { Metadata } from "next";
import { Bodoni_Moda, Manrope } from "next/font/google";
import "./globals.css";

// Editorial display + body, matching the partner deck's type system.
const bodoni = Bodoni_Moda({
  subsets: ["latin"],
  weight: ["500", "700", "800", "900"],
  variable: "--font-bodoni",
  display: "swap",
});
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  // external strings kept out of the rendered page.
  // ADR-0018: "senior at your ear" slug retired; surviving slug below.
  title: "Avery — managers need safer HR decisions",
  description:
    "Avery is the management-decision layer for 20–500 person companies: a short, evidence-backed read every morning, so managers make safer, traceable people-and-project calls — and no person is ever scored.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bodoni.variable} ${manrope.variable}`}>
      <body>{children}</body>
    </html>
  );
}
