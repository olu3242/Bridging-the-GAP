const TAGS = [
  "Applied AI",
  "Product & entrepreneurship",
  "Career readiness",
  "Mentor-reviewed",
  "Employer-informed",
];

export function TrustStrip() {
  return (
    <section className="strip" aria-label="What BTG AI is built on">
      <div className="wrap strip-inner">
        <p>Built on a foundation of real curriculum, real mentors, and real employer input</p>
        <ul className="strip-tags">
          {TAGS.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
