/**
 * @deprecated Support module for VerificationAgent which is deprecated.
 * V3 canonical assembly handles table family context through the canonical bridge
 * and table planner (stages 13b–13d).
 * This file is retained for reference only. Do not invoke from active pipeline code.
 */

import type { ExtendedTableDefinition } from '@/schemas/verificationAgentSchema';

export interface FamilyContextThresholds {
  fullFamilyTableCount: number;
  fullFamilyTotalRows: number;
}

export interface FamilyContextCard {
  familyId: string;
  mode: 'fullFamilyMode' | 'collapsedFamilyMode';
  currentTableId: string;
  baseTableId: string;
  familyTableCount: number;
  familyTotalRows: number;
  fullTables: ExtendedTableDefinition[];
  compactSiblings: Array<{
    tableId: string;
    role: string;
    rowCount: number;
    isDerived: boolean;
    sourceTableId: string;
    additionalFilter: string;
    exclude: boolean;
    tableSubtitle: string;
    rowSignature: Array<{ label: string; filterValue: string }>;
  }>;
}

const DEFAULT_THRESHOLDS: FamilyContextThresholds = {
  fullFamilyTableCount: 5,
  fullFamilyTotalRows: 180,
};

export function buildFamilyContextCards(
  tables: ExtendedTableDefinition[],
  thresholds: Partial<FamilyContextThresholds> = {},
): Map<string, FamilyContextCard> {
  const merged: FamilyContextThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...thresholds,
  };

  const byFamily = new Map<string, ExtendedTableDefinition[]>();

  for (const table of tables) {
    const familyId = resolveFamilyId(table);
    const existing = byFamily.get(familyId);
    if (existing) existing.push(table);
    else byFamily.set(familyId, [table]);
  }

  const cards = new Map<string, FamilyContextCard>();

  for (const [familyId, familyTables] of byFamily.entries()) {
    const baseTable =
      familyTables.find((table) => !table.isDerived && !table.sourceTableId) ||
      familyTables.find((table) => !table.isDerived) ||
      familyTables[0];

    const familyTotalRows = familyTables.reduce((sum, table) => sum + table.rows.length, 0);
    const fullMode =
      familyTables.length <= merged.fullFamilyTableCount &&
      familyTotalRows <= merged.fullFamilyTotalRows;

    for (const currentTable of familyTables) {
      const fullTables = fullMode
        ? familyTables
        : familyTables.filter(
            (table) =>
              table.tableId === currentTable.tableId ||
              table.tableId === baseTable.tableId ||
              /_(t2b|rank1)$/i.test(table.tableId),
          );

      const compactSiblings = fullMode
        ? []
        : familyTables
            .filter((table) => !fullTables.some((full) => full.tableId === table.tableId))
            .map((table) => ({
              tableId: table.tableId,
              role: classifyFamilyRole(table),
              rowCount: table.rows.length,
              isDerived: table.isDerived,
              sourceTableId: table.sourceTableId,
              additionalFilter: table.additionalFilter,
              exclude: table.exclude,
              tableSubtitle: table.tableSubtitle,
              rowSignature: table.rows.map((row) => ({ label: row.label, filterValue: row.filterValue })),
            }));

      cards.set(currentTable.tableId, {
        familyId,
        mode: fullMode ? 'fullFamilyMode' : 'collapsedFamilyMode',
        currentTableId: currentTable.tableId,
        baseTableId: baseTable.tableId,
        familyTableCount: familyTables.length,
        familyTotalRows,
        fullTables,
        compactSiblings,
      });
    }
  }

  return cards;
}

function resolveFamilyId(table: ExtendedTableDefinition): string {
  if (table.sourceTableId) return table.sourceTableId;
  if (table.splitFromTableId) return table.splitFromTableId;
  return table.tableId;
}

function classifyFamilyRole(table: ExtendedTableDefinition): string {
  if (!table.isDerived) return 'base';
  if (/(_detail_\d+)$/i.test(table.tableId)) return 'detail';
  if (/(_comp_)/i.test(table.tableId)) return 'comparison';
  if (/(_t2b|_b2b|_rank1|_top\d+)$/i.test(table.tableId)) return 'rollup';
  if (table.exclude) return 'excluded';
  return 'derived';
}
