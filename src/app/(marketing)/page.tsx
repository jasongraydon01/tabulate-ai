import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TrackedLink } from "@/components/TrackedLink";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { getAuth } from "@/lib/auth";
import { isPreviewFeatureEnabled } from "@/lib/featureGates";
import { getMarketingPrimaryCta } from "@/lib/navigation";
import { HeroSection } from "./_components/hero-section";
import { HowItWorksSection } from "./_components/how-it-works-section";
import { FeaturesSection } from "./_components/features-section";

export default async function LandingPage() {
  const auth = await getAuth();
  const isAuthenticated = !!auth;
  const primaryCta = getMarketingPrimaryCta(isAuthenticated);
  /** @temporary — controls demo CTA + pricing link visibility */
  const showPreview = isPreviewFeatureEnabled();
  return (
    <>
      {/* ============ HERO ============ */}
      <HeroSection
        isAuthenticated={isAuthenticated}
        showPreview={showPreview}
      />

      {/* ============ TRUST STRIP ============ */}
      <section className="border-y border-border/40">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-5 flex flex-wrap items-center justify-center gap-x-12 gap-y-3">
          <span className="data-label text-muted-foreground/50">Works with</span>
          <div className="flex items-center gap-8 text-muted-foreground/40">
            <span className="font-mono text-sm font-medium tracking-wider">.sav</span>
            <span className="font-mono text-sm font-medium tracking-wider">.pdf</span>
            <span className="font-mono text-sm font-medium tracking-wider">.docx</span>
          </div>
          <span className="hidden sm:inline h-4 w-px bg-border/40" />
          <span className="data-label text-muted-foreground/50">Exports to</span>
          <div className="flex items-center gap-8 text-muted-foreground/40">
            <span className="font-mono text-sm font-medium tracking-wider">Excel</span>
            <span className="font-mono text-sm font-medium tracking-wider">Q</span>
            <span className="font-mono text-sm font-medium tracking-wider">WinCross</span>
          </div>
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <HowItWorksSection showPreview={showPreview} />

      {/* ============ FEATURES ============ */}
      <FeaturesSection />

      {/* ============ CTA ============ */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-editorial-radial" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-primary/[0.03] rounded-full blur-[120px]" />

        <div className="relative max-w-4xl mx-auto px-6 py-40 text-center">
          <ScrollReveal>
            <h2 className="editorial-display text-5xl sm:text-6xl lg:text-7xl mb-8">
              Spend your time on insight,{" "}
              <br className="hidden sm:inline" />
              not <span className="editorial-emphasis">table building.</span>
            </h2>
            <p className="text-lg text-muted-foreground mb-14 max-w-lg mx-auto leading-relaxed">
              Upload your survey data. Download publication-ready tables. It&apos;s that direct.
            </p>
            <div className="flex gap-4 justify-center flex-wrap">
              {isAuthenticated ? (
                <Button asChild size="lg" className="text-base px-8 rounded-full bg-foreground text-background hover:bg-foreground/90">
                  <TrackedLink
                    href="/dashboard"
                    eventName="cta_clicked"
                    eventProperties={{ location: 'bottom_cta', cta_text: 'Go to Dashboard' }}
                  >
                    Go to Dashboard
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </TrackedLink>
                </Button>
              ) : (
                <>
                  {showPreview && (
                    <Button asChild size="lg" className="text-base px-8 rounded-full bg-foreground text-background hover:bg-foreground/90">
                      <TrackedLink
                        href="/demo"
                        eventName="cta_clicked"
                        eventProperties={{ location: 'bottom_cta', cta_text: 'Try the Demo' }}
                      >
                        <Play className="mr-2 h-4 w-4" />
                        Try the Demo
                      </TrackedLink>
                    </Button>
                  )}
                  <Button
                    variant={showPreview ? "outline" : "default"}
                    size="lg"
                    className={showPreview
                      ? "text-base px-8 rounded-full"
                      : "text-base px-8 rounded-full bg-foreground text-background hover:bg-foreground/90"
                    }
                    asChild
                  >
                    <TrackedLink
                      href={primaryCta.href}
                      eventName="cta_clicked"
                      eventProperties={{ location: 'bottom_cta', cta_text: primaryCta.label }}
                    >
                      {primaryCta.label}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </TrackedLink>
                  </Button>
                </>
              )}
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="border-t border-border/40">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-14">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div className="flex items-center gap-0.5">
              <span className="font-serif text-lg font-semibold tracking-tight text-foreground">Tabulate</span>
              <span className="font-serif text-lg font-semibold tracking-tight text-primary">AI</span>
            </div>
            <div className="flex items-center gap-8">
              <Link href="/data-privacy" className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors duration-200">
                Data &amp; Privacy
              </Link>
              {showPreview && (
                <Link href="/pricing" className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors duration-200">
                  Pricing
                </Link>
              )}
            </div>
          </div>
          <div className="mt-8 pt-6 border-t border-border/30">
            <p className="text-[11px] text-muted-foreground/40 font-mono tracking-wider">
              Research data, clearly structured.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
