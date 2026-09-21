"use client";
import { useEffect } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BRAND_ROUTES } from "@/components/brand/brand";

/**
 * App-surface failures render inside the shell, so the visitor keeps their
 * navigation and their brand instead of being dropped onto a bare page.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] unhandled error", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">We couldn&apos;t load this page</CardTitle>
          <CardDescription>
            The failure has been logged
            {error.digest ? ` (reference ${error.digest})` : ""}. Your work is unaffected.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={reset}>
            <RotateCw aria-hidden />
            Try again
          </Button>
          <Button asChild variant="secondary">
            <Link href={BRAND_ROUTES.dashboard}>Back to your dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
