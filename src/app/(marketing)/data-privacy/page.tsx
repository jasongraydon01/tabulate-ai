import type { Metadata } from "next";
import Link from "next/link";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { Shield, Database, Globe, Heart, Lock, Key, Users, Gauge, CheckCircle2, Trash2 } from "lucide-react";

export const metadata: Metadata = {
  title: "Data & Privacy",
  description:
    "How TabulateAI handles market research data: SPSS file processing, AI data flows, encryption, retention policies, and third-party service inventory.",
  alternates: { canonical: "/data-privacy" },
};

/* ------------------------------------------------------------------ */
/*  Section wrapper                                                   */
/* ------------------------------------------------------------------ */
function Section({
  id,
  mono,
  title,
  children,
}: {
  id?: string;
  mono: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <ScrollReveal>
        <div className="flex items-center gap-3 mb-3">
          <span className="data-label text-primary">
            {mono}
          </span>
          <span className="h-px flex-1 max-w-16 bg-primary/20" />
        </div>
        <h2 className="font-serif text-2xl sm:text-3xl font-light leading-tight mb-8">
          {title}
        </h2>
      </ScrollReveal>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-section card                                                  */
/* ------------------------------------------------------------------ */
function Card({
  icon,
  iconColor,
  iconBg,
  heading,
  children,
}: {
  icon?: React.ReactNode;
  iconColor?: string;
  iconBg?: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <ScrollReveal>
      <div className="bg-card border border-border rounded-xl p-6 sm:p-8">
        <div className="flex items-start gap-4">
          {icon && (
            <div className={`size-10 rounded-lg ${iconBg || 'bg-muted'} flex items-center justify-center shrink-0 mt-0.5`}>
              <div className={iconColor || 'text-muted-foreground'}>{icon}</div>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-serif text-xl mb-3">{heading}</h3>
            <div className="text-[15px] text-muted-foreground leading-relaxed space-y-4">
              {children}
            </div>
          </div>
        </div>
      </div>
    </ScrollReveal>
  );
}

/* ------------------------------------------------------------------ */
/*  Third-party row                                                   */
/* ------------------------------------------------------------------ */
function ServiceRow({
  name,
  purpose,
  dataHandled,
  notes,
}: {
  name: string;
  purpose: string;
  dataHandled: string;
  notes: string;
}) {
  return (
    <tr className="border-t border-border/50">
      <td className="px-4 py-3.5 font-medium text-foreground whitespace-nowrap align-top">
        {name}
      </td>
      <td className="px-4 py-3.5 align-top">{purpose}</td>
      <td className="px-4 py-3.5 align-top">{dataHandled}</td>
      <td className="px-4 py-3.5 align-top">{notes}</td>
    </tr>
  );
}

/* ================================================================== */
/*  PAGE                                                              */
/* ================================================================== */
export default function DataPrivacyPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-28 sm:py-36 space-y-24">
      {/* ----- Intro ----- */}
      <ScrollReveal>
        <div>
          <div className="flex items-center gap-3 mb-6">
            <div className="size-10 rounded-lg bg-tab-indigo-dim flex items-center justify-center">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <span className="data-label text-muted-foreground">
              Data & Privacy
            </span>
          </div>
          <h1 className="editorial-display text-4xl sm:text-5xl mb-8">
            Your data is yours. Here&apos;s how we <span className="editorial-emphasis">treat it.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">
            TabulateAI processes market research data, which can include
            sensitive survey content and respondent information. We take that
            responsibility seriously. This page explains exactly what happens to
            your data at every step &mdash; no legal jargon, just the facts.
          </p>
        </div>
      </ScrollReveal>

      {/* ---------------------------------------------------------- */}
      {/*  1. What we collect                                        */}
      {/* ---------------------------------------------------------- */}
      <Section mono="01" title="What we collect">
        <div className="grid gap-5">
          <Card icon={<Database className="h-4 w-4" />} iconColor="text-tab-blue" iconBg="bg-tab-blue-dim" heading="Files you upload">
            <p>
              When you create a project, you upload an <strong>SPSS data
              file (.sav)</strong>, a <strong>survey document</strong>{" "}
              (PDF or DOCX), and optionally a <strong>banner
              plan</strong> and <strong>message list</strong>. These files
              are the inputs to the crosstab pipeline.
            </p>
            <p>
              We never ask for or require personally identifiable
              information (PII) about survey respondents. The .sav file
              typically contains coded response data (numeric values and
              variable labels), not names, addresses, or contact details.
              That said, we recognize that some datasets may contain
              demographic fields or open-ended responses that could be
              sensitive.
            </p>
          </Card>

          <Card icon={<Users className="h-4 w-4" />} iconColor="text-primary" iconBg="bg-tab-indigo-dim" heading="Account information">
            <p>
              When you sign in, we collect your <strong>name</strong> and{" "}
              <strong>email address</strong> via our authentication
              provider (WorkOS). We also store your organization
              membership and role (admin, member, or external partner).
            </p>
            <p>
              We do not store passwords. Authentication is handled
              entirely by WorkOS, which supports enterprise SSO (SAML,
              Google Workspace, Okta, Azure AD, etc.).
            </p>
          </Card>

          <Card icon={<Gauge className="h-4 w-4" />} iconColor="text-tab-teal" iconBg="bg-tab-teal-dim" heading="Usage analytics">
            <p>
              We use PostHog for product analytics to understand how
              people use the product &mdash; which features are used, where
              people get stuck, and what to improve. On the client side we
              identify signed-in users with internal IDs, not email
              addresses.
            </p>
            <p>
              Some server-side analytics events also include operational
              metadata such as project names or uploaded file names so we
              can understand pipeline setup and failures. We do not use
              PostHog for advertising or retargeting.
            </p>
          </Card>

          <Card heading="Error monitoring">
            <p>
              We use Sentry to catch and fix software bugs. Error reports
              include stack traces and breadcrumbs, and we sample session
              replay in some cases to debug UI issues. These reports are{" "}
              <strong>scrubbed of sensitive data</strong> before leaving
              your browser or our server. IP addresses, authorization
              headers, cookies, forwarded IP headers, API keys, and
              request bodies are explicitly stripped from the events we
              send.
            </p>
          </Card>
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      {/*  2. How your data flows                                    */}
      {/* ---------------------------------------------------------- */}
      <Section mono="02" title="How your data flows through the system">
        <div className="grid gap-5">
          <Card icon={<Globe className="h-4 w-4" />} iconColor="text-tab-blue" iconBg="bg-tab-blue-dim" heading="File storage (Cloudflare R2)">
            <p>
              Uploaded files are first written to temporary server storage
              so the pipeline can process them. For standard product runs,
              generated outputs and selected runtime artifacts are then
              uploaded to{" "}
              <strong>Cloudflare R2</strong>, an S3-compatible object
              storage service, organized by organization, project, and
              run. Demo runs are handled differently and do not upload
              their outputs to R2.
            </p>
            <p>
              R2 buckets are <strong>not publicly accessible</strong>.
              Downloads are served via time-limited presigned URLs (1-hour
              expiry) after an authenticated app request. Input files are
              not uploaded to R2 by default in the current product flow.
            </p>
          </Card>

          <Card icon={<Lock className="h-4 w-4" />} iconColor="text-primary" iconBg="bg-tab-indigo-dim" heading="AI processing">
            <p>
              Our default deployment uses <strong>OpenAI</strong> to
              interpret survey structure, review banner plans, and help
              generate table definitions. We can also deploy against{" "}
              <strong>Azure OpenAI</strong> when that is preferred or
              required for a specific organization, so customers who need a
              provider-specific commitment should confirm deployment details
              with us.
            </p>
            <p>Here is the practical boundary we enforce today:</p>

            <div className="bg-muted/50 border border-border rounded-lg p-4 space-y-3 mt-2">
              <div>
                <p className="text-foreground font-medium text-sm mb-1">
                  Sent to the model provider:
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>
                    Survey document text and structured survey parses
                    derived from that document
                  </li>
                  <li>
                    Data map metadata (variable names, value labels,
                    variable types, and similar derived metadata)
                  </li>
                  <li>
                    Banner plan content, message-list content, and
                    question-level structural context needed for planning
                    or review
                  </li>
                </ul>
              </div>
              <div>
                <p className="text-foreground font-medium text-sm mb-1">
                  Not sent as part of normal model calls:
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>The raw `.sav` file binary</li>
                  <li>Case-level respondent records from the `.sav` file</li>
                  <li>The full response table used for frequencies, cross-tabs, and statistical testing</li>
                </ul>
              </div>
            </div>

            <p>
              The actual number-crunching &mdash; computing frequencies,
              cross-tabulations, and statistical tests &mdash; happens
              entirely in <strong>R on our server</strong>, not in the AI.
              The AI generates planning and review instructions; R executes
              them against the real data.
            </p>
          </Card>

          <Card icon={<Shield className="h-4 w-4" />} iconColor="text-tab-amber" iconBg="bg-tab-amber-dim" heading="What our model providers do with that data">
            <p>
              In our default OpenAI deployment, OpenAI&apos;s API data-use
              commitments apply. In Azure OpenAI deployments, Microsoft and
              Azure-specific abuse-monitoring and retention terms apply
              instead.
            </p>
            <ul className="list-disc list-inside space-y-1.5 text-sm">
              <li>We do not use your uploaded project data to train our own models</li>
              <li>Our default provider is OpenAI, but some organizations may use Azure OpenAI instead</li>
              <li>Abuse monitoring, retention, and regional controls depend on the provider and plan</li>
              <li>If you need a contractual no-retention or regional processing commitment, that should be handled explicitly before onboarding</li>
            </ul>
            <p>
              This page is meant to describe our actual application
              behavior, not to replace a DPA, security exhibit, or provider
              contract. If those documents matter for your use case, we
              should review them directly with you.
            </p>
          </Card>

          <Card heading="Database (Convex)">
            <p>
              Project metadata, run status, and configuration are stored in{" "}
              <strong>Convex</strong>, our real-time database. Convex
              stores project metadata, intake filenames, organization
              membership, run state, notification preferences, and related
              application records. It does not store the uploaded file
              bodies themselves.
            </p>
            <p>
              For demo submissions, we also store the lead information you
              provide (name, email, optional company, project name,
              verification state, and delivery state) so we can verify your
              email and deliver the demo output.
            </p>
          </Card>
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      {/*  3. Third-party services                                   */}
      {/* ---------------------------------------------------------- */}
      <Section mono="03" title="Third-party services">
        <ScrollReveal>
          <p className="text-[15px] text-muted-foreground leading-relaxed mb-8">
            These are the main third-party services currently involved in
            authentication, storage, analytics, billing, and email delivery.
            This is a practical application inventory, not a substitute for
            vendor contracts or security exhibits.
          </p>
        </ScrollReveal>
        <ScrollReveal delay={0.1}>
          <div className="overflow-x-auto -mx-6 sm:mx-0">
            <div className="min-w-[700px] sm:min-w-0">
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm text-muted-foreground">
                  <thead>
                    <tr className="bg-muted/50 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <th className="text-left px-4 py-3">Service</th>
                      <th className="text-left px-4 py-3">Purpose</th>
                      <th className="text-left px-4 py-3">Data handled</th>
                      <th className="text-left px-4 py-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    <ServiceRow name="OpenAI / Azure OpenAI" purpose="AI pipeline (survey interpretation, table building)" dataHandled="Structured survey text, metadata, banner content" notes="OpenAI is the default provider; some organizations may use Azure OpenAI. No case-level respondent records sent." />
                    <ServiceRow name="Cloudflare R2" purpose="Artifact storage" dataHandled="Run outputs and selected runtime artifacts" notes="Non-demo downloadable artifacts; inputs not copied by default." />
                    <ServiceRow name="Convex" purpose="Database" dataHandled="Project metadata, run state, memberships, demo leads" notes="Application records, not uploaded file bodies." />
                    <ServiceRow name="WorkOS" purpose="Authentication & SSO" dataHandled="Email, name, org membership" notes="Handles sign-in, sessions, and organization identity." />
                    <ServiceRow name="PostHog" purpose="Product analytics" dataHandled="Usage events keyed to internal IDs" notes="Some server-side events include operational metadata." />
                    <ServiceRow name="Sentry" purpose="Error monitoring" dataHandled="Error reports and sampled replay data" notes="Sensitive headers and request bodies scrubbed before send." />
                    <ServiceRow name="Stripe" purpose="Billing" dataHandled="Billing customer, checkout, subscription records" notes="Subscriptions and checkout flows." />
                    <ServiceRow name="Resend" purpose="Transactional email" dataHandled="Recipient email and message content" notes="Pipeline notifications, demo verification, demo delivery." />
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </ScrollReveal>
      </Section>

      {/* ---------------------------------------------------------- */}
      {/*  4. Healthcare / PHI considerations                        */}
      {/* ---------------------------------------------------------- */}
      <Section mono="04" title="Healthcare and sensitive data">
        <div className="grid gap-5">
          <Card icon={<Heart className="h-4 w-4" />} iconColor="text-tab-amber" iconBg="bg-tab-amber-dim" heading="Protected Health Information (PHI)">
            <p>
              Market research studies sometimes touch healthcare topics.
              While crosstab data is typically aggregated and coded (not
              individual medical records), we recognize the sensitivity.
            </p>
            <p>
              <strong>TabulateAI is not currently presented as a
              HIPAA-compliant product.</strong> Some underlying vendors may
              offer HIPAA-oriented or BAA-backed plans, but that does not by
              itself make this application HIPAA compliant.
            </p>
            <p>
              If your datasets contain information that may qualify as PHI
              under HIPAA, please contact us before uploading so we can
              discuss whether the current deployment is appropriate and what
              additional safeguards would be required.
            </p>
          </Card>

          <Card heading="Respondent anonymity">
            <p>
              The pipeline is designed to work with coded survey data, not
              personally identifiable respondent information. The AI
              agents see question text and variable structure, not
              respondent-level records from the `.sav` file. The R
              computation layer processes the actual data and outputs
              aggregate statistics (frequencies, percentages, significance tests).
            </p>
            <p>
              If your .sav file contains open-ended verbatim responses or
              other fields that could identify individuals, those fields
              can still exist in the files you upload and in temporary
              working copies on our servers. Open-ended text variables are
              excluded from standard automated crosstab processing by
              default, and are not part of our normal AI input path.
            </p>
          </Card>
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      {/*  5. Security                                               */}
      {/* ---------------------------------------------------------- */}
      <Section mono="05" title="Security measures">
        <div className="grid sm:grid-cols-2 gap-5">
          <Card icon={<Lock className="h-4 w-4" />} iconColor="text-primary" iconBg="bg-tab-indigo-dim" heading="Encryption">
            <p>
              Data is encrypted in transit with HTTPS/TLS. Our managed vendors
              encrypt stored data at rest. During processing, temporary server
              working copies of uploaded files are created.
            </p>
          </Card>
          <Card icon={<Key className="h-4 w-4" />} iconColor="text-tab-teal" iconBg="bg-tab-teal-dim" heading="Authentication">
            <p>
              Most product API endpoints require authentication. Sessions
              are managed by WorkOS with HTTP-only cookies. We never store
              passwords.
            </p>
          </Card>
          <Card icon={<Users className="h-4 w-4" />} iconColor="text-tab-blue" iconBg="bg-tab-blue-dim" heading="Authorization">
            <p>
              All resources are organization-scoped. Role-based access
              control (admin, member, external partner) restricts sensitive
              operations. Artifacts are scoped by org, project, and run.
            </p>
          </Card>
          <Card icon={<Gauge className="h-4 w-4" />} iconColor="text-tab-amber" iconBg="bg-tab-amber-dim" heading="Rate limiting">
            <p>
              Authenticated APIs are rate-limited by organization. Public demo
              endpoints are rate-limited by IP and email. Pipeline-triggering
              operations use stricter limits.
            </p>
          </Card>
        </div>
      </Section>

      {/* ---------------------------------------------------------- */}
      {/*  6. Data retention & deletion                              */}
      {/* ---------------------------------------------------------- */}
      <Section mono="06" title="Data retention and deletion">
        <Card icon={<Trash2 className="h-4 w-4" />} iconColor="text-tab-rose" iconBg="bg-tab-rose-dim" heading="Your right to delete">
          <p>
            You can delete any project at any time from the dashboard.
            When a project is deleted, we hard-delete the project and run
            records from our application database and make a best-effort
            cleanup of associated R2 artifacts.
          </p>
          <p>
            Uploaded inputs are not stored in R2 by default, but the system
            does create temporary upload/session directories and run
            workspaces on the server. Short-lived session temp directories
            are cleaned up after runs, while run workspaces and generated
            artifacts may persist for downloads, exports, review recovery,
            or operational cleanup until the project is deleted or the
            environment is cleaned up.
          </p>
          <p>
            If you need your entire account and all associated data
            deleted, contact us and we will process the request promptly.
          </p>
        </Card>
      </Section>

      {/* ---------------------------------------------------------- */}
      {/*  7. What we don't do                                       */}
      {/* ---------------------------------------------------------- */}
      <Section mono="07" title="What we don&rsquo;t do">
        <ScrollReveal>
          <div className="bg-card border border-border rounded-xl p-6 sm:p-8">
            <ul className="space-y-4 text-[15px] text-muted-foreground leading-relaxed">
              {[
                <>We <strong>don&apos;t sell your data</strong> or share it with third parties for marketing purposes.</>,
                <>We <strong>don&apos;t use your data to train AI models</strong>. We also rely on API-provider commitments that customer data is not used to train foundation models.</>,
                <>We <strong>don&apos;t track you with third-party advertising pixels</strong> or retargeting scripts.</>,
                <>We <strong>don&apos;t store passwords</strong>. Authentication is fully delegated to WorkOS.</>,
                <>We <strong>don&apos;t send individual respondent records from the `.sav` file to the AI</strong>. The AI layer works from survey content and derived metadata.</>,
                <>We <strong>don&apos;t make R2 buckets publicly accessible</strong>. File access goes through authenticated app routes and time-limited URLs.</>,
              ].map((item, i) => (
                <li key={i} className="flex gap-3">
                  <CheckCircle2 className="h-4 w-4 text-tab-teal shrink-0 mt-1" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </ScrollReveal>
      </Section>

      {/* ---------------------------------------------------------- */}
      {/*  8. Contact                                                */}
      {/* ---------------------------------------------------------- */}
      <ScrollReveal>
        <section className="text-center py-14">
          <h2 className="font-serif text-2xl sm:text-3xl mb-5">
            Questions?
          </h2>
          <p className="text-muted-foreground text-[15px] leading-relaxed max-w-lg mx-auto mb-8">
            If you have questions about how your data is handled, need to
            discuss specific compliance requirements, or want to request
            data deletion, reach out to us directly.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center text-sm font-medium bg-primary text-primary-foreground px-6 py-2.5 rounded-full hover:opacity-90 transition-opacity"
          >
            Back to Dashboard
          </Link>
        </section>
      </ScrollReveal>

      {/* ----- Last updated ----- */}
      <div className="text-center border-t border-border pt-10">
        <p className="font-mono text-xs text-muted-foreground">
          Last updated: March 2026
        </p>
      </div>
    </div>
  );
}
