export default function AppLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="h-8 w-56 animate-pulse rounded-lg bg-white/6" />
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-44 animate-pulse rounded-[var(--radius-card)] bg-white/5" />
        ))}
      </div>
    </div>
  );
}
