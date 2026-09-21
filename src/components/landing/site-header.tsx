"use client";
import Link from "next/link";
import { useState } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { LANDING_LINKS } from "./links";

const NAV = [
  { href: LANDING_LINKS.howItWorks, label: "How it works" },
  { href: LANDING_LINKS.modules, label: "What you get" },
  { href: LANDING_LINKS.partners, label: "Universities & partners" },
  { href: LANDING_LINKS.faq, label: "FAQ" },
];

/**
 * Sticky header with the canonical mobile nav behaviour: the toggle flips
 * `nav-open` on the header (which the stylesheet reads) and choosing a link
 * closes the menu again. Replaces js/script.js's DOM listeners with state.
 */
export function SiteHeader() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <header className={`site-header${navOpen ? " nav-open" : ""}`} id="top">
      <div className="wrap header-inner">
        <BrandLogo variant="landing" tone="indigo" />

        <nav className="main-nav" id="main-nav" aria-label="Primary">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setNavOpen(false)}>
              {item.label}
            </a>
          ))}
        </nav>

        <div className="header-actions">
          <Link className="btn btn-ghost" href={LANDING_LINKS.signIn}>
            Log in
          </Link>
          <Link className="btn btn-primary" href={LANDING_LINKS.getStarted}>
            Get started <span aria-hidden="true">→</span>
          </Link>
          <button
            className="nav-toggle"
            id="navToggle"
            aria-expanded={navOpen}
            aria-controls="main-nav"
            aria-label={navOpen ? "Close menu" : "Open menu"}
            onClick={() => setNavOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>
    </header>
  );
}
