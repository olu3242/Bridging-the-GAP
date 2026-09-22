import { Banner } from "@/components/landing/banner";
import { Faq } from "@/components/landing/faq";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Modules } from "@/components/landing/modules";
import { Partners } from "@/components/landing/partners";
import { Showcase } from "@/components/landing/showcase";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { TrustStrip } from "@/components/landing/trust-strip";

/**
 * Native implementation of btg-ai-landing/index.html, in canonical section
 * order. Fully static: the page holds no session, so a signed-in visitor who
 * taps log in or get started is resolved to their real destination by the
 * proxy instead of this page guessing.
 */
export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Hero />
        <TrustStrip />
        <HowItWorks />
        <Modules />
        <Showcase />
        <Banner />
        <Partners />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
