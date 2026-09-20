const STEPS = [
  {
    title: "Find your starting point",
    body: "A short diagnostic looks at your current digital and AI literacy — not just what you've studied, but what you can actually do.",
  },
  {
    title: "Get a path built for you",
    body: "Your plan is generated from your goals and your results, and it tells you exactly why each step is there and what it unlocks.",
  },
  {
    title: "Learn by building",
    body: "Work through lessons and labs with an AI tutor at your side, then put it to use in real, hands-on projects — solo or with a team.",
  },
  {
    title: "Prove what you know",
    body: "Submissions are reviewed against clear rubrics, by mentors and AI working together, so a verified skill actually means something.",
  },
  {
    title: "Connect to opportunity",
    body: "Your portfolio, on your terms, opens the door to internships, challenges, and roles from partners who value verified work.",
  },
];

export function HowItWorks() {
  return (
    <section className="section" id="how-it-works">
      <div className="wrap">
        <div className="section-head">
          <h2>A clear path from curious to career-ready</h2>
          <p>
            No wall of courses to guess through. BTG AI figures out where you&apos;re starting from,
            then gives you one path forward — with proof at every step.
          </p>
        </div>

        <ol className="steps">
          {STEPS.map((step, index) => (
            <li className="step" key={step.title}>
              <span className="step-index">{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
