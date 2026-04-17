import { notFound } from "next/navigation";

import { AnalysisWorkspace } from "@/components/analysis/AnalysisWorkspace";
import { getConvexClient } from "@/lib/convex";
import { requireConvexAuth } from "@/lib/requireConvexAuth";
import { api } from "../../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../../convex/_generated/dataModel";

interface RunAnalysisPageProps {
  params: Promise<{
    projectId: string;
    runId: string;
  }>;
}

export default async function RunAnalysisPage({ params }: RunAnalysisPageProps) {
  const { projectId, runId } = await params;
  const auth = await requireConvexAuth();
  const convex = getConvexClient();

  const [project, run] = await Promise.all([
    convex.query(api.projects.get, {
      projectId: projectId as Id<"projects">,
      orgId: auth.convexOrgId,
    }),
    convex.query(api.runs.get, {
      runId: runId as Id<"runs">,
      orgId: auth.convexOrgId,
    }),
  ]);

  if (!project || !run || String(run.projectId) !== projectId) {
    notFound();
  }

  return (
    <AnalysisWorkspace
      projectId={projectId}
      projectName={project.name}
      runId={runId}
      runStatus={run.status}
    />
  );
}
