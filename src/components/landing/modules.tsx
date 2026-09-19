import Image from "next/image";

const MODULES = [
  {
    icon: "/icons/icon-ai-tutor.png",
    title: "AI Tutor",
    body: "Explains, questions, and gives hints — it won't finish graded work for you, and it always tells you when it's unsure.",
  },
  {
    icon: "/icons/icon-personalized-paths.png",
    title: "Personalized paths",
    body: "Your plan follows your diagnostic and your goals — not a fixed syllabus everyone works through in the same order.",
  },
  {
    icon: "/icons/icon-projects.png",
    title: "Real projects",
    body: "Build something that solves an actual problem, alone or in a team, with checkpoints so feedback comes early and often.",
  },
  {
    icon: "/icons/icon-verified-skills.png",
    title: "Verified skills",
    body: "Every credential is tied to evidence you produced — reviewed work, not a quiz score or a completion badge.",
  },
  {
    icon: "/icons/icon-mentorship.png",
    title: "Mentorship",
    body: "Sessions, goals, and feedback from people working in the field — not just automated encouragement.",
  },
  {
    icon: "/icons/icon-career-opportunities.png",
    title: "Career opportunities",
    body: "Internships, challenges, and roles matched to what you've actually demonstrated — with gaps shown honestly, not hidden.",
  },
  {
    icon: "/icons/icon-community.png",
    title: "Community",
    body: "Cohorts, peer help, and events with people on the same path — moderated so it stays a place worth showing up to.",
  },
  {
    icon: "/icons/icon-analytics.png",
    title: "Progress you can see",
    body: "A clear view of your competencies, streaks, and growth — so \"am I improving?\" always has a straight answer.",
  },
];

export function Modules() {
  return (
    <section className="section section-tint" id="modules">
      <div className="wrap">
        <div className="section-head">
          <h2>Everything you need, none of the clutter</h2>
          <p>
            Eight parts of the platform work together — you&apos;ll rarely think about them
            separately.
          </p>
        </div>

        <div className="card-grid">
          {MODULES.map((module) => (
            <article className="feature-card" key={module.title}>
              <div className="feature-icon">
                <Image src={module.icon} alt="" width={56} height={56} />
              </div>
              <h3>{module.title}</h3>
              <p>{module.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
