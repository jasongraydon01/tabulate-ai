import {
  getAnalysisMessageContextEvidenceItems,
  getAnalysisMessageFollowUpSuggestions,
  getAnalysisMessageMetadata,
  getAnalysisUIMessageText,
} from "@/lib/analysis/messages";
import { buildAnalysisRenderableBlocks, type AnalysisRenderableBlock } from "@/lib/analysis/renderAnchors";
import { isAnalysisCiteDataUIPart, type AnalysisUIMessage } from "@/lib/analysis/ui";
import {
  buildAnalysisCellId,
  type AnalysisEvidenceItem,
} from "@/lib/analysis/types";

export interface SettledAnalysisAnswer {
  clientTurnId: string | null;
  persistedMessageId: string | null;
  persistenceStatus: "persisted" | "unsaved" | "unknown";
  persistenceWarning: string | null;
  canUsePersistenceActions: boolean;
  rawText: string;
  renderableBlocks: AnalysisRenderableBlock[];
  evidenceItems: AnalysisEvidenceItem[];
  contextEvidenceItems: AnalysisEvidenceItem[];
  visibleEvidenceItems: AnalysisEvidenceItem[];
  sourceItems: AnalysisEvidenceItem[];
  followUpSuggestions: string[];
}

function getEvidenceItemCellId(item: AnalysisEvidenceItem): string | null {
  if (
    item.evidenceKind !== "cell"
    || !item.sourceTableId
    || !item.rowKey
    || !item.cutKey
  ) {
    return null;
  }

  return buildAnalysisCellId({
    tableId: item.sourceTableId,
    rowKey: item.rowKey,
    cutKey: item.cutKey,
  });
}

function getInlineCitedCellIds(message: Pick<AnalysisUIMessage, "parts">): Set<string> {
  const citedCellIds = new Set<string>();

  for (const part of message.parts) {
    if (!isAnalysisCiteDataUIPart(part)) continue;
    for (const cellId of part.data.cellIds) {
      citedCellIds.add(cellId);
    }
  }

  return citedCellIds;
}

export function getSettledAnalysisVisibleEvidenceItems(
  message: Pick<AnalysisUIMessage, "parts">,
  evidenceItems: AnalysisEvidenceItem[],
): AnalysisEvidenceItem[] {
  if (evidenceItems.length === 0) return [];

  const citedCellIds = getInlineCitedCellIds(message);

  return evidenceItems.filter((item) => {
    const cellId = getEvidenceItemCellId(item);
    if (!cellId) {
      return true;
    }

    return !item.renderedInCurrentMessage || !citedCellIds.has(cellId);
  });
}

export function buildSettledAnalysisAnswer(
  message: AnalysisUIMessage,
  options?: {
    isStreaming?: boolean;
  },
): SettledAnalysisAnswer {
  const metadata = getAnalysisMessageMetadata(message);
  const evidenceItems = metadata?.evidence ?? [];
  const contextEvidenceItems = getAnalysisMessageContextEvidenceItems(message);
  const visibleEvidenceItems = getSettledAnalysisVisibleEvidenceItems(message, evidenceItems);
  const persistenceStatus = metadata?.persistence?.status ?? "unknown";
  const persistedMessageId = metadata?.persistedMessageId ?? null;

  return {
    clientTurnId: metadata?.clientTurnId ?? null,
    persistedMessageId,
    persistenceStatus,
    persistenceWarning: metadata?.persistence?.warning ?? null,
    canUsePersistenceActions: persistenceStatus === "persisted" && Boolean(persistedMessageId),
    rawText: getAnalysisUIMessageText(message),
    renderableBlocks: buildAnalysisRenderableBlocks(message, {
      isStreaming: options?.isStreaming,
    }),
    evidenceItems,
    contextEvidenceItems,
    visibleEvidenceItems,
    sourceItems: [...visibleEvidenceItems, ...contextEvidenceItems],
    followUpSuggestions: getAnalysisMessageFollowUpSuggestions(message),
  };
}

export function getSettledAnalysisEvidenceItemCellId(item: AnalysisEvidenceItem): string | null {
  return getEvidenceItemCellId(item);
}
