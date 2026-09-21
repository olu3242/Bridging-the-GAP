"use client";
import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BRAND_ROUTES } from "@/components/brand/brand";

/** Auth-surface failures stay inside the branded auth shell. */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[auth] unhandled error", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign-in is unavailable right now</CardTitle>
        <CardDescription>
          We could not load this step
          {error.digest ? ` (reference ${error.digest})` : ""}. Nothing was changed on your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="secondary">
          <Link href={BRAND_ROUTES.home}>Back to the home page</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
