import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./landing.css";

/**
 * The canonical page pulled these from a Google Fonts <link>. next/font
 * self-hosts the same families and weights, so the landing renders without an
 * external request and without a layout shift.
 */
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "BTG AI — Learn AI. Build with AI. Prove what you can do.",
  description:
    "BTG AI helps Nigerian university students build practical AI capability through personalized learning, real projects, mentorship, and verified skills for the future of work.",
  icons: { icon: "/brand/favicon.svg" },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`btg-landing ${spaceGrotesk.variable} ${inter.variable}`}>{children}</div>
  );
}
