import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Compass,
  GraduationCap,
  Hammer,
  LineChart,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";

const LIFECYCLE = [
  { icon: Compass, title: "Diagnose", body: "A baseline that finds what you already know and where the real gaps are." },
  { icon: GraduationCap, title: "Learn", body: "A pathway built from your gaps, with a tutor that questions rather than answers for you." },
  { icon: Hammer, title: "Build", body: "Projects and employer challenges that produce something you can actually show." },
  { icon: BadgeCheck, title: "Prove", body: "Evidence assessed against rubrics and reviewed by people, then credentialed." },
  { icon: Users, title: "Connect", body: "Mentors who can see your progress, and matches that explain why you fit." },
];

const PRINCIPLES = [
  {
    icon: ShieldCheck,
    title: "A credential means something",
    body: "Skills become verified through submitted evidence and human review — never because a model said so.",
  },
  {
    icon: LineChart,
    title: "Every number is traceable",
    body: "Progress, gaps and matches come from your real work, and you can see what produced them.",
  },
  {
    icon: Sparkles,
    title: "AI that teaches, not tells",
    body: "Your tutor explains, questions and critiques. It never submits graded work on your behalf.",
  },
];

/**
 * Public marketing surface: fully static. A signed-in visitor who taps sign in
 * or join is redirected to the dashboard by the proxy, so the page never needs
 * to read the session.
 */
export default function LandingPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-5 sm:px-8">
      <header className="flex items-center justify-between py-6">
        <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-xl bg-brand/20 text-brand ring-1 ring-brand/40">
            <Sparkles className="size-4" aria-hidden />
          </span>
          BTG AI
        </Link>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/join">Join BTG</Link>
          </Button>
        </nav>
      </header>

      <main id="main" className="flex-1">
        <section className="animate-rise py-14 sm:py-20">
          <Badge tone="brand" className="mb-6">
            <Sparkles className="size-3" aria-hidden /> Learn → Build → Prove → Get matched
          </Badge>
          <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
            Turn what you learn into <span className="text-gradient">proof someone will hire</span>.
          </h1>
          <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-ink-muted sm:text-lg">
            BTG AI measures where you actually are, builds a pathway to close the gap, gives you real
            projects to build, verifies the evidence you produce, and connects that verified skill to
            mentors and opportunities.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/join">
                Start your baseline <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/sign-in">I already have an account</Link>
            </Button>
          </div>
        </section>

        <div className="rule-glow h-px" />

        <section aria-labelledby="lifecycle" className="py-14">
          <h2 id="lifecycle" className="text-sm font-medium uppercase tracking-[0.18em] text-ink-subtle">
            How it works
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {LIFECYCLE.map((step, index) => (
              <Card key={step.title} className="h-full">
                <CardContent className="flex h-full flex-col gap-3 p-6">
                  <div className="flex items-center justify-between">
                    <span className="grid size-9 place-items-center rounded-xl bg-white/6 text-accent">
                      <step.icon className="size-4" aria-hidden />
                    </span>
                    <span className="font-mono text-xs text-ink-subtle">0{index + 1}</span>
                  </div>
                  <CardTitle>{step.title}</CardTitle>
                  <CardDescription>{step.body}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section aria-labelledby="principles" className="py-14">
          <h2 id="principles" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Built so the proof holds up
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {PRINCIPLES.map((principle) => (
              <Card key={principle.title}>
                <CardContent className="space-y-3 p-6">
                  <span className="grid size-9 place-items-center rounded-xl bg-white/6 text-brand">
                    <principle.icon className="size-4" aria-hidden />
                  </span>
                  <CardTitle>{principle.title}</CardTitle>
                  <CardDescription>{principle.body}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="pb-16">
          <Card className="overflow-hidden">
            <CardContent className="flex flex-col items-start gap-5 p-8 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <CardTitle className="text-xl">Ready to find out where you actually stand?</CardTitle>
                <CardDescription className="max-w-xl">
                  Create an account, complete a short baseline, and your first pathway is generated from
                  your results — not from a template.
                </CardDescription>
              </div>
              <Button asChild size="lg">
                <Link href="/join">
                  Join BTG AI <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </section>
      </main>

      <footer className="flex flex-col gap-2 border-t border-white/8 py-8 text-xs text-ink-subtle sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} BTG AI — Bridging the Gap.</p>
        <p>Learn. Build. Prove. Get matched.</p>
      </footer>
    </div>
  );
}
