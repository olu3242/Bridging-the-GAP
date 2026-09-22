import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";
import { BRAND, BRAND_ROUTES } from "@/components/brand/brand";

/**
 * The branded auth shell. Every credential, OAuth, recovery and confirmation
 * state renders inside it, so the mark, the elevation and the promise line are
 * identical across the whole auth surface.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-8 px-4 py-10 sm:px-5 sm:py-12">
      <BrandLogo tone="onDark" size={32} className="self-start" />
      <main id="main" className="animate-rise flex-1">
        {children}
      </main>
      <footer className="space-y-2 text-center text-xs text-ink-subtle">
        <p>{BRAND.promise}</p>
        <p>
          <Link href={BRAND_ROUTES.home} className="underline-offset-4 hover:text-ink-muted hover:underline">
            Back to {BRAND.name}
          </Link>
        </p>
      </footer>
    </div>
  );
}
