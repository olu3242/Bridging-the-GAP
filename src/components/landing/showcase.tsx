import Image from "next/image";

const POINTS = [
  "Pick up exactly where you left off",
  "Milestones and mentor sessions in one place",
  "Built to feel light on slower connections",
];

export function Showcase() {
  return (
    <section className="section showcase">
      <div className="wrap showcase-inner">
        <div className="showcase-copy">
          <h2>One home base. Any device.</h2>
          <p>
            Pick up your path on a laptop between classes, or on your phone on the way home — your
            progress, projects, and mentor sessions stay in sync either way.
          </p>
          <ul className="hero-trust">
            {POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
        <div className="showcase-art">
          <div className="browser-frame">
            <div className="browser-chrome">
              <span />
              <span />
              <span />
            </div>
            <Image
              src="/images/dashboard-preview.jpg"
              alt="BTG AI learner dashboard showing today's path, project progress, competencies, and an upcoming mentor session"
              width={1400}
              height={1050}
              sizes="(max-width: 980px) 100vw, 560px"
            />
          </div>
          <div className="phone-frame">
            <Image
              src="/images/mobile-preview.jpg"
              alt="BTG AI mobile app showing today's tasks and a quick continue-learning action"
              width={900}
              height={1700}
              sizes="(max-width: 720px) 45vw, 190px"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
