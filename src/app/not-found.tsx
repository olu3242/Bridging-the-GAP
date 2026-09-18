import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
      <p className="font-mono text-xs text-ink-subtle">404</p>
      <h1 className="text-xl font-semibold tracking-tight">We couldn&apos;t find that page</h1>
      <p className="text-sm text-ink-muted">The link may be out of date, or the page may have moved.</p>
      <Button asChild>
        <Link href="/">Back to BTG AI</Link>
      </Button>
    </div>
  );
}
