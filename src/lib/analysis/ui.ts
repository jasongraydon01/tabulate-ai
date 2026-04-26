import type { UIMessage } from "ai";

import type {
  AnalysisMessageMetadata,
  AnalysisRenderDirectiveFocus,
} from "@/lib/analysis/types";

export interface AnalysisUIDataTypes extends Record<string, unknown> {
  "analysis-render": {
    tableId: string;
    focus?: AnalysisRenderDirectiveFocus;
  };
  "analysis-cite": {
    cellIds: string[];
  };
}

export type AnalysisUIMessage = UIMessage<AnalysisMessageMetadata, AnalysisUIDataTypes>;
export type AnalysisUIMessagePart = AnalysisUIMessage["parts"][number];

export type AnalysisRenderDataUIPart = AnalysisUIMessagePart & {
  type: "data-analysis-render";
  data: AnalysisUIDataTypes["analysis-render"];
};
export type AnalysisCiteDataUIPart = AnalysisUIMessagePart & {
  type: "data-analysis-cite";
  data: AnalysisUIDataTypes["analysis-cite"];
};

export function isAnalysisRenderDataUIPart(
  part: AnalysisUIMessage["parts"][number],
): part is AnalysisRenderDataUIPart {
  return part.type === "data-analysis-render";
}

export function isAnalysisCiteDataUIPart(
  part: AnalysisUIMessage["parts"][number],
): part is AnalysisCiteDataUIPart {
  return part.type === "data-analysis-cite";
}
