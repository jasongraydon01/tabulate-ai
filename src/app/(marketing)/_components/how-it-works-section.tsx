'use client';

import { Play, Brain, CheckCircle2, Database, FileText, FileSpreadsheet, Terminal, Download, BarChart3, Clock, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TrackedLink } from "@/components/TrackedLink";
import { ScrollReveal } from "@/components/ui/scroll-reveal";

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-32 lg:py-40 px-6 lg:px-10">
      <div className="max-w-7xl mx-auto">
        {/* Section header */}
        <ScrollReveal>
          <div className="max-w-xl mb-28 lg:mb-36">
            <span className="data-label text-primary mb-4 block">
              How It Works
            </span>
            <h2 className="editorial-display text-4xl sm:text-5xl lg:text-6xl mb-6">
              Three inputs.{" "}
              <span className="editorial-emphasis">One intelligent pipeline.</span>
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              No scripting. No manual column mapping. Your files contain
              everything the system needs.
            </p>
          </div>
        </ScrollReveal>

        {/* Steps — asymmetric flowing layout */}
        <div className="space-y-28 lg:space-y-40">
          {/* Step 1 — Left aligned */}
          <ScrollReveal>
            <div className="flex flex-col lg:flex-row gap-12 lg:gap-20 items-start">
              <div className="lg:max-w-md lg:flex-shrink-0">
                <div className="flex items-center gap-4 mb-6">
                  <span className="font-mono text-5xl font-light text-primary/20">
                    01
                  </span>
                  <span className="data-label text-muted-foreground">
                    Upload
                  </span>
                </div>
                <h3 className="font-serif text-2xl sm:text-3xl font-light mb-5 leading-tight">
                  Drop your files
                </h3>
                <p className="text-base text-muted-foreground leading-relaxed mb-8">
                  Your SPSS data file tells us what was measured. Your survey
                  document tells us why each question was asked. Your banner
                  plan tells us how to cut the data. Together, they give the
                  system the full picture of your research.
                </p>
                <div className="flex gap-3">
                  <span className="font-mono text-xs px-3 py-1.5 bg-secondary rounded-full border border-border/60">
                    .sav
                  </span>
                  <span className="font-mono text-xs px-3 py-1.5 bg-secondary rounded-full border border-border/60">
                    .pdf / .docx
                  </span>
                  <span className="font-mono text-xs px-3 py-1.5 bg-secondary rounded-full border border-border/60">
                    banner spec
                  </span>
                </div>
              </div>

              {/* Upload preview card */}
              <div className="lg:ml-auto w-full lg:max-w-sm">
                <div className="bg-card rounded-xl border border-border/60 overflow-hidden">
                  <div className="px-5 py-3 border-b border-border/40 flex items-center justify-between">
                    <span className="data-label text-muted-foreground/50">
                      Project Files
                    </span>
                    <span className="text-[10px] font-mono text-primary">
                      3 of 3 uploaded
                    </span>
                  </div>
                  <div className="px-5 py-4 space-y-2.5">
                    {[
                      {
                        icon: Database,
                        color: "text-primary",
                        bg: "bg-primary/10",
                        name: "Healthcare_Study_2026.sav",
                        meta: "SPSS Data \u00B7 4.2 MB \u00B7 1,247 cases",
                      },
                      {
                        icon: FileText,
                        color: "text-tab-amber",
                        bg: "bg-tab-amber/10",
                        name: "Survey_Instrument.pdf",
                        meta: "Survey \u00B7 820 KB \u00B7 14 pages",
                      },
                      {
                        icon: FileSpreadsheet,
                        color: "text-tab-blue",
                        bg: "bg-tab-blue/10",
                        name: "Banner_Plan.docx",
                        meta: "Banner \u00B7 56 KB \u00B7 3 groups",
                      },
                    ].map((file) => (
                      <div
                        key={file.name}
                        className="flex items-center gap-3 bg-muted/30 rounded-lg px-3.5 py-2.5"
                      >
                        <div
                          className={`size-8 rounded-lg ${file.bg} flex items-center justify-center shrink-0`}
                        >
                          <file.icon className={`h-4 w-4 ${file.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {file.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground/50 font-mono">
                            {file.meta}
                          </p>
                        </div>
                        <CheckCircle2 className="h-4 w-4 text-tab-teal shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </ScrollReveal>

          {/* Step 2 — Right aligned */}
          <ScrollReveal>
            <div className="flex flex-col lg:flex-row-reverse gap-12 lg:gap-20 items-start">
              <div className="lg:max-w-md lg:flex-shrink-0">
                <div className="flex items-center gap-4 mb-6">
                  <span className="font-mono text-5xl font-light text-primary/20">
                    02
                  </span>
                  <span className="data-label text-muted-foreground">
                    Understand &amp; Compute
                  </span>
                </div>
                <h3 className="font-serif text-2xl sm:text-3xl font-light mb-5 leading-tight">
                  AI structures.{" "}
                  <span className="editorial-emphasis">Code computes.</span>
                </h3>
                <p className="text-base text-muted-foreground leading-relaxed">
                  AI reads your survey to understand the intent behind each
                  question — whether it needs NETs, T2B summaries, means, or a
                  specific base. Then deterministic R code computes every
                  percentage, stat test, and base size from your actual data. AI
                  does not compute those numbers.
                </p>
              </div>

              {/* Pipeline preview card */}
              <div className="lg:mr-auto w-full lg:max-w-sm">
                <div className="bg-card rounded-xl border border-border/60 overflow-hidden">
                  <div className="px-5 py-3 border-b border-border/40 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Brain className="h-3.5 w-3.5 text-primary" />
                      <span className="data-label text-muted-foreground/50">
                        Pipeline
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-primary px-1.5 py-0.5 bg-tab-indigo-dim rounded">
                      Running
                    </span>
                  </div>
                  <div className="px-5 py-5 space-y-4">
                    {[
                      {
                        label: "Enrichment",
                        meta: "47 questions",
                        progress: 100,
                        color: "bg-tab-teal",
                        metaColor: "text-tab-teal",
                        done: true,
                      },
                      {
                        label: "Planning",
                        meta: "12 NETs \u00B7 6 cuts",
                        progress: 100,
                        color: "bg-tab-teal",
                        metaColor: "text-tab-teal",
                        done: true,
                      },
                      {
                        label: "R Compute",
                        meta: "23 of 47 tables",
                        progress: 49,
                        color: "bg-primary",
                        metaColor: "text-primary",
                        done: false,
                      },
                    ].map((stage) => (
                      <div key={stage.label} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {stage.done ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-tab-teal" />
                            ) : (
                              <Zap className="h-3.5 w-3.5 text-primary" />
                            )}
                            <span className="text-xs font-medium text-foreground">
                              {stage.label}
                            </span>
                          </div>
                          <span
                            className={`text-[10px] font-mono ${stage.metaColor}`}
                          >
                            {stage.meta}
                          </span>
                        </div>
                        <div className="h-1 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${stage.color} rounded-full transition-all`}
                            style={{ width: `${stage.progress}%` }}
                          />
                        </div>
                      </div>
                    ))}

                    {/* Mini terminal */}
                    <div className="mt-3 bg-muted/40 rounded-lg border border-border/40 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Terminal className="h-3 w-3 text-muted-foreground/30" />
                        <span className="text-[10px] font-mono text-muted-foreground/30">
                          R 4.4.0
                        </span>
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground/50 space-y-0.5">
                        <p>
                          <span className="text-tab-teal">&gt;</span>{" "}
                          haven::read_sav(&quot;data.sav&quot;)
                        </p>
                        <p>
                          <span className="text-tab-teal">&gt;</span>{" "}
                          prop.table(xtabs(~ Q4 + Banner))
                        </p>
                        <p>
                          <span className="text-primary">&gt;</span>{" "}
                          chisq.test(table_23){" "}
                          <span className="text-muted-foreground/20">|</span>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ScrollReveal>

          {/* Step 3 — Left aligned */}
          <ScrollReveal>
            <div className="flex flex-col lg:flex-row gap-12 lg:gap-20 items-start">
              <div className="lg:max-w-md lg:flex-shrink-0">
                <div className="flex items-center gap-4 mb-6">
                  <span className="font-mono text-5xl font-light text-primary/20">
                    03
                  </span>
                  <span className="data-label text-muted-foreground">
                    Download
                  </span>
                </div>
                <h3 className="font-serif text-2xl sm:text-3xl font-light mb-5 leading-tight">
                  Publication-ready{" "}
                  <span className="editorial-emphasis">output</span>
                </h3>
                <p className="text-base text-muted-foreground leading-relaxed mb-8">
                  Formatted Excel workbooks with statistical significance
                  testing. Or export to Q and WinCross for further refinement in
                  your existing workflow. Every output is structured around your
                  research design.
                </p>
                <div className="flex gap-3">
                  <span className="font-mono text-xs px-3 py-1.5 bg-secondary rounded-full border border-border/60">
                    .xlsx
                  </span>
                  <span className="font-mono text-xs px-3 py-1.5 bg-secondary rounded-full border border-border/60">
                    Q Script
                  </span>
                  <span className="font-mono text-xs px-3 py-1.5 bg-secondary rounded-full border border-border/60">
                    WinCross .job
                  </span>
                </div>
              </div>

              {/* Output preview card */}
              <div className="lg:ml-auto w-full lg:max-w-sm">
                <div className="bg-card rounded-xl border border-border/60 overflow-hidden">
                  <div className="px-5 py-3 border-b border-border/40 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-tab-teal" />
                      <span className="data-label text-muted-foreground/50">
                        Output Ready
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3 text-muted-foreground/30" />
                      <span className="text-[10px] font-mono text-muted-foreground/30">
                        12m 34s
                      </span>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="px-5 pt-5 flex justify-between">
                    {[
                      { value: "47", label: "Tables" },
                      { value: "6", label: "Cuts" },
                      { value: "95%", label: "Conf." },
                    ].map((stat) => (
                      <div key={stat.label} className="text-center">
                        <p className="text-2xl font-serif font-semibold text-foreground">
                          {stat.value}
                        </p>
                        <p className="text-[10px] text-muted-foreground/50 font-mono uppercase tracking-wider">
                          {stat.label}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Output format cards */}
                  <div className="px-5 py-5 space-y-2">
                    <div className="flex items-center gap-3 bg-tab-teal/5 border border-tab-teal/10 rounded-lg px-3.5 py-2.5">
                      <div className="size-8 rounded-lg bg-tab-teal/10 flex items-center justify-center shrink-0">
                        <BarChart3 className="h-4 w-4 text-tab-teal" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          Crosstabs_Healthcare.xlsx
                        </p>
                        <p className="text-[11px] text-muted-foreground/50 font-mono">
                          47 tables &middot; 3 banner groups &middot; sig
                          testing
                        </p>
                      </div>
                      <Download className="h-4 w-4 text-tab-teal shrink-0" />
                    </div>
                    {[
                      {
                        icon: FileText,
                        name: "Q Script Package",
                        meta: ".qs manifest + data",
                      },
                      {
                        icon: FileSpreadsheet,
                        name: "WinCross .job",
                        meta: "47 tables \u00B7 default profile",
                      },
                    ].map((item) => (
                      <div
                        key={item.name}
                        className="flex items-center gap-3 bg-muted/30 rounded-lg px-3.5 py-2.5"
                      >
                        <div className="size-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          <item.icon className="h-4 w-4 text-muted-foreground/50" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground">{item.name}</p>
                          <p className="text-[11px] text-muted-foreground/50 font-mono">
                            {item.meta}
                          </p>
                        </div>
                        <Download className="h-4 w-4 text-muted-foreground/30 shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </ScrollReveal>
        </div>

        <ScrollReveal delay={0.3}>
          <div className="mt-28 text-center">
            <p className="text-muted-foreground mb-5">
              Want to see it on your own data?
            </p>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="text-base rounded-full"
            >
              <TrackedLink
                href="/demo"
                eventName="cta_clicked"
                eventProperties={{
                  location: "how_it_works",
                  cta_text: "Try the Demo",
                }}
              >
                <Play className="mr-2 h-4 w-4" />
                Try the Demo
              </TrackedLink>
            </Button>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
