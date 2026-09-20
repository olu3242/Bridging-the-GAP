import Link from "next/link";
import { LANDING_LINKS } from "./links";

const POINTS = [
  { dot: "dot-emerald", text: "Learn at your own pace, with support when you need it" },
  { dot: "dot-gold", text: "Build things that end up in your portfolio, not a drawer" },
  { dot: "dot-violet", text: "Connect with mentors and partners who are actually hiring" },
  { dot: "dot-ice", text: "Belong to a cohort that's building alongside you" },
];

export function Banner() {
  return (
    <section className="banner">
      <div className="wrap banner-inner">
        <div className="banner-copy">
          <p className="eyebrow-pill eyebrow-pill--dark">From campus to global opportunity</p>
          <h2>
            More than learning.
            <br />
            A bolder future.
          </h2>
          <p>
            Join a growing community of Nigerian students using AI to solve real problems and build
            work the world can see.
          </p>
          <Link className="btn btn-primary btn-lg" href={LANDING_LINKS.getStarted}>
            Get started <span aria-hidden="true">→</span>
          </Link>
        </div>
        <ul className="banner-list">
          {POINTS.map((point) => (
            <li key={point.text}>
              <span className={`dot ${point.dot}`} />
              {point.text}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
