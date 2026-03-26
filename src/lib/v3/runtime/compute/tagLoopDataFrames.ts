import type { LoopGroupMapping } from '@/lib/validation/LoopCollapser';
import type { TableWithLoopFrame } from '@/schemas/verificationAgentSchema';

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim()))));
}

function buildBaseNameToFrameLookup(loopMappings: LoopGroupMapping[]): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const mapping of loopMappings) {
    for (const variable of mapping.variables) {
      if (!lookup.has(variable.baseName)) {
        lookup.set(variable.baseName, mapping.stackedFrameName);
      }
    }
  }

  return lookup;
}

function collectStructuralVariables(table: TableWithLoopFrame): string[] {
  return uniqueStrings(table.rows.flatMap((row) => {
    const variable = row.variable && row.variable !== '_CAT_'
      ? [row.variable]
      : [];
    return variable.concat(row.netComponents ?? []);
  }));
}

export function tagLoopDataFrames(
  tables: TableWithLoopFrame[],
  loopMappings: LoopGroupMapping[] = [],
): TableWithLoopFrame[] {
  if (loopMappings.length === 0) return tables;

  const baseNameToFrame = buildBaseNameToFrameLookup(loopMappings);

  return tables.map((table) => {
    const explicitLoopFrame = table.loopDataFrame?.trim();
    if (explicitLoopFrame) return table;

    const frameNames = new Set(
      collectStructuralVariables(table)
        .map(variable => baseNameToFrame.get(variable))
        .filter((value): value is string => Boolean(value)),
    );

    if (frameNames.size !== 1) {
      return table;
    }

    return {
      ...table,
      loopDataFrame: [...frameNames][0] ?? '',
    };
  });
}
