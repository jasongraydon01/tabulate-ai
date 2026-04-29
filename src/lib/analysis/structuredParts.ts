import type { UIMessage } from "ai";

import { SUBMIT_ANSWER_TOOL_TYPE } from "@/lib/analysis/toolLabels";
import type {
  AnalysisRenderDirectiveFocus,
  AnalysisStructuredAssistantPart,
  AnalysisStructuredCitePart,
  AnalysisStructuredRenderPart,
  AnalysisStructuredTextPart,
} from "@/lib/analysis/types";
import { AnalysisStructuredAnswerSchema } from "@/schemas/analysisStructuredAnswerSchema";

function normalizeRenderFocus(
  focus: AnalysisRenderDirectiveFocus | undefined,
): AnalysisRenderDirectiveFocus | undefined {
  if (!focus) return undefined;

  const normalized: AnalysisRenderDirectiveFocus = {};
  if (focus.rowLabels && focus.rowLabels.length > 0) normalized.rowLabels = [...focus.rowLabels];
  if (focus.rowRefs && focus.rowRefs.length > 0) normalized.rowRefs = [...focus.rowRefs];
  if (focus.groupNames && focus.groupNames.length > 0) {
    const groupNames = focus.groupNames.filter((groupName) => !isTotalGroupNameFocus(groupName));
    if (groupNames.length > 0) normalized.groupNames = groupNames;
  }
  if (focus.groupRefs && focus.groupRefs.length > 0) {
    const groupRefs = focus.groupRefs.filter((groupRef) => !isTotalGroupRefFocus(groupRef));
    if (groupRefs.length > 0) normalized.groupRefs = groupRefs;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeFocusToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isTotalGroupNameFocus(value: string): boolean {
  const normalized = normalizeFocusToken(value);
  return normalized === "total" || /^total [a-z]$/u.test(normalized);
}

function isTotalGroupRefFocus(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "__total__" || normalized.startsWith("__total__::");
}

function normalizeStructuredTextPart(
  part: Pick<AnalysisStructuredTextPart, "text">,
): AnalysisStructuredTextPart | null {
  return part.text.trim().length > 0 ? { type: "text", text: part.text } : null;
}

function normalizeStructuredRenderPart(
  part: AnalysisStructuredRenderPart,
): AnalysisStructuredRenderPart {
  return {
    type: "render",
    tableId: part.tableId.trim(),
    ...(normalizeRenderFocus(part.focus) ? { focus: normalizeRenderFocus(part.focus) } : {}),
  };
}

function normalizeStructuredCitePart(
  part: AnalysisStructuredCitePart,
): AnalysisStructuredCitePart | null {
  const cellIds = [...new Set(part.cellIds.map((cellId) => cellId.trim()).filter((cellId) => cellId.length > 0))];
  return cellIds.length > 0 ? { type: "cite", cellIds } : null;
}

export function normalizeAnalysisStructuredAssistantParts(
  parts: AnalysisStructuredAssistantPart[],
): AnalysisStructuredAssistantPart[] {
  const normalized: AnalysisStructuredAssistantPart[] = [];

  for (const part of parts) {
    if (part.type === "text") {
      const normalizedText = normalizeStructuredTextPart(part);
      if (normalizedText) normalized.push(normalizedText);
      continue;
    }

    if (part.type === "render") {
      normalized.push(normalizeStructuredRenderPart(part));
      continue;
    }

    const normalizedCite = normalizeStructuredCitePart(part);
    if (normalizedCite) normalized.push(normalizedCite);
  }

  return normalized;
}

export function getAnalysisTextFromStructuredAssistantParts(
  parts: AnalysisStructuredAssistantPart[],
): string {
  let output = "";
  let previous: AnalysisStructuredAssistantPart | null = null;

  for (const part of parts) {
    if (part.type === "cite") {
      previous = part;
      continue;
    }

    const needsRenderBoundary = part.type === "render" || previous?.type === "render";
    if (part.type === "text") {
      if (needsRenderBoundary && output.trim().length > 0) {
        output += "\n\n";
      }
      output += part.text;
    }

    previous = part;
  }

  return output
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function extractAnalysisStructuredAssistantPartsFromSubmitAnswer(
  parts: UIMessage["parts"],
): AnalysisStructuredAssistantPart[] | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (!part || typeof part !== "object") continue;

    const record = part as Record<string, unknown>;
    if (record.type !== SUBMIT_ANSWER_TOOL_TYPE) continue;

    const payload = record.state === "output-available" ? record.output : record.input;
    const parsed = AnalysisStructuredAnswerSchema.safeParse(payload);
    if (!parsed.success) continue;

    return normalizeAnalysisStructuredAssistantParts(parsed.data.parts);
  }

  return null;
}

export type AnalysisStructuredAnswerExtractionFailureReason =
  | "missing_submit_answer"
  | "multiple_submit_answers"
  | "submit_answer_invalid"
  | "submit_answer_empty"
  | "assistant_text_outside_submit_answer";

export interface AnalysisStructuredAnswerExtractionFailure {
  ok: false;
  reason: AnalysisStructuredAnswerExtractionFailureReason;
  message: string;
}

export interface AnalysisStructuredAnswerExtractionSuccess {
  ok: true;
  parts: AnalysisStructuredAssistantPart[];
  submitAnswerIndex: number;
}

export function extractStrictAnalysisStructuredAssistantPartsFromSubmitAnswer(
  parts: UIMessage["parts"],
): AnalysisStructuredAnswerExtractionFailure | AnalysisStructuredAnswerExtractionSuccess {
  const submitAnswerParts = parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => {
      if (!part || typeof part !== "object") return false;
      const record = part as Record<string, unknown>;
      return record.type === SUBMIT_ANSWER_TOOL_TYPE;
    });

  if (submitAnswerParts.length === 0) {
    return {
      ok: false,
      reason: "missing_submit_answer",
      message: "Analysis turn failed: assistant did not finalize with submitAnswer({ parts }).",
    };
  }

  if (submitAnswerParts.length !== 1) {
    return {
      ok: false,
      reason: "multiple_submit_answers",
      message: "Analysis turn failed: assistant emitted multiple submitAnswer calls.",
    };
  }

  const [{ part, index }] = submitAnswerParts;
  const record = part as Record<string, unknown>;
  const payload = record.state === "output-available" ? record.output : record.input;
  const parsed = AnalysisStructuredAnswerSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "submit_answer_invalid",
      message: "Analysis turn failed: submitAnswer payload did not match the structured answer schema.",
    };
  }

  const normalizedParts = normalizeAnalysisStructuredAssistantParts(parsed.data.parts);
  if (normalizedParts.length === 0) {
    return {
      ok: false,
      reason: "submit_answer_empty",
      message: "Analysis turn failed: submitAnswer payload contained no usable assistant parts.",
    };
  }

  const hasAssistantTextOutsideSubmitAnswer = parts.some((candidate, candidateIndex) => (
    candidateIndex !== index
    && candidate.type === "text"
    && typeof candidate.text === "string"
    && candidate.text.trim().length > 0
  ));
  if (hasAssistantTextOutsideSubmitAnswer) {
    return {
      ok: false,
      reason: "assistant_text_outside_submit_answer",
      message: "Analysis turn failed: assistant emitted prose outside submitAnswer({ parts }).",
    };
  }

  return {
    ok: true,
    parts: normalizedParts,
    submitAnswerIndex: index,
  };
}
