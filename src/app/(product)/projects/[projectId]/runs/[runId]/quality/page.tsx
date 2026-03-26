import { notFound } from "next/navigation";
import { requireConvexAuth } from "@/lib/requireConvexAuth";
import { getConvexClient } from "@/lib/convex";
import { parseRunResult } from "@/schemas/runResultSchema";
import { api } from "../../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../../convex/_generated/dataModel";

interface QualityPageProps {
  params: Promise<{
    projectId: string;
    runId: string;
  }>;
}

const qualityUiEnabled =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_INTERNAL_QUALITY_UI === "true";

export default async function RunQualityPage({ params }: QualityPageProps) {
  if (!qualityUiEnabled) {
    notFound();
  }

  const { projectId, runId } = await params;
  const auth = await requireConvexAuth();
  const convex = getConvexClient();

  const run = await convex.query(api.runs.get, {
    runId: runId as Id<"runs">,
    orgId: auth.convexOrgId,
  });
  if (!run || String(run.projectId) !== projectId) {
    notFound();
  }

  const evaluation = await convex.query(api.runEvaluations.getByRun, {
    runId: runId as Id<"runs">,
    orgId: auth.convexOrgId,
  });

  const runResult = parseRunResult(run.result);
  const quality = runResult?.quality ?? null;

  return (
    <div className="max-w-5xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Run Quality (Internal)</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Internal QA surface for golden-baseline divergence tracking. Hidden in production by default.
        </p>
      </div>

      <section className="rounded-md border p-4 space-y-2">
        <h2 className="text-sm font-medium">Snapshot</h2>
        <pre className="text-xs overflow-auto bg-muted rounded p-3">
          {JSON.stringify(quality, null, 2)}
        </pre>
      </section>

      <section className="rounded-md border p-4 space-y-2">
        <h2 className="text-sm font-medium">Evaluation</h2>
        <pre className="text-xs overflow-auto bg-muted rounded p-3">
          {JSON.stringify(evaluation, null, 2)}
        </pre>
      </section>
    </div>
  );
}
