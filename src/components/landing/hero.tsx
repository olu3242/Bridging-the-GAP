import Image from "next/image";
import Link from "next/link";
import { LANDING_LINKS } from "./links";

const TRUST = [
  "Personalized, not one-size-fits-all",
  "Built around real projects",
  "Skills you can actually verify",
];

export function Hero() {
  return (
    <section className="hero">
      <div className="wrap hero-inner">
        <div className="hero-copy">
          <p className="eyebrow-pill">For learners everywhere — built for global opportunity</p>
          <h1>
            Learn AI. Build with AI.
            <br />
            Prove what you can do.
          </h1>
          <p className="hero-lede">
            BTG AI turns curiosity into capability: a personalized path from your first prompt to a
            portfolio of real, verified work — with projects, mentors, and opportunities built for
            where you&apos;re headed.
          </p>
          <div className="hero-ctas">
            <Link className="btn btn-primary btn-lg" href={LANDING_LINKS.getStarted}>
              Start learning free <span aria-hidden="true">→</span>
            </Link>
            <a className="btn btn-outline btn-lg" href={LANDING_LINKS.howItWorks}>
              See how it works
            </a>
          </div>
          <ul className="hero-trust" aria-label="What BTG AI stands on">
            {TRUST.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="hero-art">
          <div className="hero-photo-wrap">
            <Image
              className="hero-photo"
              src="/images/hero-photo.jpg"
              width={692}
              height={700}
              priority
              sizes="(max-width: 980px) 460px, 46vw"
              alt="A BTG AI learner looking toward a city skyline and bridge at dusk"
            />
          </div>

          <div className="hero-card hero-card--top">
            <span className="dot dot-emerald" />
            <div>
              <strong>Prompt Engineering</strong>
              <small>Verified · in progress</small>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
