'use client';

import { Brain, ShieldCheck, FileSpreadsheet, GitFork, UserCheck } from "lucide-react";
import { ScrollReveal } from "@/components/ui/scroll-reveal";

const features = [
  {
    icon: Brain,
    number: "01",
    title: "AI understands your research",
    description:
      "Reads the survey instrument to understand why each question was asked. NETs, T2B, means, and splits are chosen based on analytical intent — not heuristics.",
    align: "left" as const,
  },
  {
    icon: ShieldCheck,
    number: "02",
    title: "Deterministic compute",
    description:
      "Every percentage, statistical test, and base size is computed by validated R code against your real data. AI helps structure the work; R computes the numbers.",
    align: "right" as const,
  },
  {
    icon: FileSpreadsheet,
    number: "03",
    title: "Skip logic & filters",
    description:
      "Reads routing logic from the survey document. Only the right respondents appear in the right tables.",
    align: "left" as const,
  },
  {
    icon: GitFork,
    number: "04",
    title: "Complex data structures",
    description:
      "Looped data, stacked structures, weighted samples, multi-response grids. Detected automatically, handled correctly.",
    align: "right" as const,
  },
  {
    icon: UserCheck,
    number: "05",
    title: "Human in the loop",
    description:
      "When the system is uncertain, it pauses and asks. You review flagged items, provide corrections, and the pipeline continues with your input.",
    align: "left" as const,
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="py-32 lg:py-40 px-6 lg:px-10">
      <div className="max-w-7xl mx-auto">
        {/* Section header */}
        <ScrollReveal>
          <div className="max-w-xl mb-28 lg:mb-36">
            <span className="data-label text-primary mb-4 block">
              Capabilities
            </span>
            <h2 className="editorial-display text-4xl sm:text-5xl lg:text-6xl mb-6">
              Intelligence where it matters.{" "}
              <br className="hidden lg:inline" />
              <span className="editorial-emphasis">Precision everywhere else.</span>
            </h2>
          </div>
        </ScrollReveal>

        {/* Features — flowing vertical layout, alternating sides */}
        <div className="space-y-20 lg:space-y-28">
          {features.map((feature) => (
            <ScrollReveal key={feature.number}>
              <div
                className={`flex flex-col lg:flex-row items-start gap-8 lg:gap-16 ${
                  feature.align === "right" ? "lg:flex-row-reverse" : ""
                }`}
              >
                {/* Feature number + icon */}
                <div
                  className={`flex items-start gap-6 lg:w-1/3 ${
                    feature.align === "right" ? "lg:justify-end" : ""
                  }`}
                >
                  <span className="font-mono text-6xl lg:text-7xl font-extralight text-primary/10 leading-none select-none">
                    {feature.number}
                  </span>
                  <div className="size-12 rounded-xl bg-primary/[0.06] flex items-center justify-center mt-2">
                    <feature.icon className="h-5 w-5 text-primary/60" />
                  </div>
                </div>

                {/* Feature text */}
                <div className="lg:w-2/3 max-w-lg">
                  <h3 className="font-serif text-xl sm:text-2xl font-light mb-4 leading-tight">
                    {feature.title}
                  </h3>
                  <p className="text-base text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>

        {/* Export formats callout */}
        <ScrollReveal>
          <div className="mt-28 lg:mt-36 border-t border-border/40 pt-16">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
              <div className="max-w-md">
                <h3 className="font-serif text-xl sm:text-2xl font-light mb-3">
                  Multiple export formats
                </h3>
                <p className="text-base text-muted-foreground leading-relaxed">
                  Output to Excel with full formatting, or generate Q scripts and
                  WinCross .job files that fit your existing data processing
                  workflow.
                </p>
              </div>
              <div className="flex gap-3">
                {["Excel", "Q", "WinCross"].map((format) => (
                  <span
                    key={format}
                    className="text-sm font-mono px-4 py-2 bg-muted/50 rounded-full border border-border/40 text-muted-foreground"
                  >
                    {format}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
