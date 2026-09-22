export default function AuthLoading() {
  return (
    <div className="glass rounded-[var(--radius-card)] p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="h-6 w-44 animate-pulse rounded-lg bg-white/8" />
      <div className="mt-3 h-4 w-60 animate-pulse rounded bg-white/5" />
      <div className="mt-6 space-y-4">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-11 animate-pulse rounded-xl bg-white/5" />
        ))}
        <div className="h-11 animate-pulse rounded-full bg-white/8" />
      </div>
    </div>
  );
}
