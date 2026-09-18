import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { LANDING_LINKS } from "./links";

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { href: LANDING_LINKS.howItWorks, label: "How it works" },
      { href: LANDING_LINKS.modules, label: "AI Tutor" },
      { href: LANDING_LINKS.modules, label: "Verified skills" },
      { href: LANDING_LINKS.modules, label: "Career opportunities" },
    ],
  },
  {
    heading: "Partners",
    links: [
      { href: LANDING_LINKS.partners, label: "Universities" },
      { href: LANDING_LINKS.partners, label: "Employers" },
      { href: LANDING_LINKS.partners, label: "Sponsors & programs" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: LANDING_LINKS.top, label: "About" },
      { href: LANDING_LINKS.faq, label: "FAQ" },
      { href: LANDING_LINKS.getStarted, label: "Contact" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: LANDING_LINKS.top, label: "Privacy policy" },
      { href: LANDING_LINKS.top, label: "Terms of use" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-top">
        <div className="footer-brand">
          <Link className="brand" href={LANDING_LINKS.top}>
            <span className="brand-mark" aria-hidden="true">
              <BrandMark size={28} variant="footer" />
            </span>
            <span className="brand-word brand-word--dark">
              BTG <em>AI</em>
            </span>
          </Link>
          <p>
            Bridging the gap between education, AI capability, and opportunity — one verified skill
            at a time.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <div className="footer-col" key={column.heading}>
            <h4>{column.heading}</h4>
            <ul>
              {column.links.map((link) => (
                <li key={`${column.heading}-${link.label}`}>
                  {link.href.startsWith("#") ? (
                    <a href={link.href}>{link.label}</a>
                  ) : (
                    <Link href={link.href}>{link.label}</Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="wrap footer-bottom">
        {/* Rendered server-side; the canonical page filled this with a DOM script. */}
        <p>© {new Date().getFullYear()} BTG AI. All rights reserved.</p>
        <p className="footer-tagline">Skills create opportunity. AI expands what&apos;s possible.</p>
      </div>
    </footer>
  );
}
