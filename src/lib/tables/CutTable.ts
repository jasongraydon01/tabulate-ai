/**
 * CutTable builder
 * Purpose: Convert ValidationResultType into concise group/column table with stats
 * Consumers: generate-tables API, CSV exporter, downstream R manifest builder
 */
import type { ValidationResultType } from '@/schemas/agentOutputSchema';

export interface CutColumn {
  name: string;
  expression: string; // from column.adjusted
  confidence: number; // 0..1
  reason: string;
}

export interface CutGroup {
  groupName: string;
  columns: CutColumn[];
}

export interface CutTable {
  sessionId: string;
  generatedAt: string; // ISO
  groups: CutGroup[];
  stats: {
    groupCount: number;
    columnCount: number;
    averageConfidence: number;
  };
}

export function buildCutTable(validation: ValidationResultType, sessionId: string): CutTable {
  const groups: CutGroup[] = validation.bannerCuts.map((group) => ({
    groupName: group.groupName,
    columns: group.columns.map((column) => ({
      name: column.name,
      expression: column.adjusted,
      confidence: column.confidence,
      reason: column.reasoning,
    })),
  }));

  const allColumns = groups.flatMap((group) => group.columns);
  const columnCount = allColumns.length;
  const averageConfidence = columnCount
    ? allColumns.reduce((sum, column) => sum + column.confidence, 0) / columnCount
    : 0;

  return {
    sessionId,
    generatedAt: new Date().toISOString(),
    groups,
    stats: {
      groupCount: groups.length,
      columnCount,
      averageConfidence,
    },
  };
}


