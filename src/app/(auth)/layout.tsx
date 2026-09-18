import Link from "next/link";
import { Sparkles } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2.5 text-sm font-semibold tracking-tight">
        <span className="grid size-8 place-items-center rounded-xl bg-brand/20 text-brand ring-1 ring-brand/40">
          <Sparkles className="size-4" aria-hidden />
        </span>
        BTG AI
      </Link>
      <main id="main" className="animate-rise">{children}</main>
    </div>
  );
}
