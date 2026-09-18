"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[ui] unhandled error", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-ink-muted">
        We could not load this page. The failure has been logged
        {error.digest ? ` (reference ${error.digest})` : ""}.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
