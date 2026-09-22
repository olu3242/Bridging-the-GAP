"use client";
import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrandStatePanel } from "@/components/brand/brand-state";
import { BRAND_ROUTES } from "@/components/brand/brand";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[ui] unhandled error", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <BrandStatePanel
      title="Something went wrong"
      tone="error"
      description={
        <>
          We could not load this page. The failure has been logged
          {error.digest ? ` (reference ${error.digest})` : ""}.
        </>
      }
    >
      <Button onClick={reset}>Try again</Button>
      <Button asChild variant="secondary">
        <Link href={BRAND_ROUTES.home}>Back to the home page</Link>
      </Button>
    </BrandStatePanel>
  );
}
