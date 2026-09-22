import Link from "next/link";
import { getStartedAs } from "./links";

const PARTNERS = [
  {
    title: "For universities",
    body: "Sponsor cohorts, see program outcomes, and give students a practical AI track that complements what they're already studying.",
    cta: "Talk to us about your campus →",
    intent: "institution" as const,
  },
  {
    title: "For employers",
    body: "Post real challenges, contribute problems worth solving, and meet candidates through verified, evidence-backed portfolios.",
    cta: "Partner with BTG AI →",
    intent: "employer" as const,
  },
  {
    title: "For sponsors & programs",
    body: "Fund learners or cohorts and see governed, honest reporting on what that funding actually produced.",
    cta: "Explore sponsorship →",
    intent: "sponsor" as const,
  },
];

export function Partners() {
  return (
    <section className="section" id="partners">
      <div className="wrap">
        <div className="section-head">
          <h2>Built for the whole ecosystem</h2>
          <p>Students are the center of BTG AI, but they don&apos;t get there alone.</p>
        </div>

        <div className="partner-grid">
          {PARTNERS.map((partner) => (
            <article className="partner-card" key={partner.title}>
              <h3>{partner.title}</h3>
              <p>{partner.body}</p>
              {/* Carries the persona through to onboarding rather than dropping
                  the visitor into a generic signup. */}
              <Link className="text-link" href={getStartedAs(partner.intent)}>
                {partner.cta}
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
