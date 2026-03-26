import { projectTableBaseContract } from '../baseContract';
import type { LoopGroupMapping } from '@/lib/validation/LoopCollapser';
import type {
  CanonicalBaseDisclosure,
  CanonicalRow,
  CanonicalTable,
  CanonicalTableOutput,
  PlannedTable,
  QuestionIdEntry,
  ValidatedPlanOutput,
} from './types';

interface LoopColumnRef {
  baseName: string;
  familyBase: string | null;
  frameName: string;
}

interface LoopFamilyRepresentative {
  familyRoot: string;
  members: QuestionIdEntry[];
  representative: QuestionIdEntry;
  summedQuestionBase: number | null;
}

interface LoopCoverage {
  familyRoot: string;
  frameName: string;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim()))));
}

function buildIterationColumnLookup(loopMappings: LoopGroupMapping[]): Map<string, LoopColumnRef> {
  const lookup = new Map<string, LoopColumnRef>();

  for (const mapping of loopMappings) {
    for (const variable of mapping.variables) {
      for (const iterationColumn of Object.values(variable.iterationColumns)) {
        lookup.set(iterationColumn, {
          baseName: variable.baseName,
          familyBase: mapping.familyBase ?? null,
          frameName: mapping.stackedFrameName,
        });
      }
    }
  }

  return lookup;
}

function buildBaseNameLookup(loopMappings: LoopGroupMapping[]): Map<string, LoopColumnRef> {
  const lookup = new Map<string, LoopColumnRef>();

  for (const mapping of loopMappings) {
    for (const variable of mapping.variables) {
      if (!lookup.has(variable.baseName)) {
        lookup.set(variable.baseName, {
          baseName: variable.baseName,
          familyBase: mapping.familyBase ?? null,
          frameName: mapping.stackedFrameName,
        });
      }
    }
  }

  return lookup;
}

function buildLoopFamilyRepresentatives(entries: QuestionIdEntry[]): Map<string, LoopFamilyRepresentative> {
  const byFamily = new Map<string, QuestionIdEntry[]>();

  for (const entry of entries) {
    if (!entry.loop?.detected) continue;
    const familyRoot = entry.loopQuestionId ?? entry.loop.familyBase;
    if (!familyRoot) continue;
    const members = byFamily.get(familyRoot) ?? [];
    members.push(entry);
    byFamily.set(familyRoot, members);
  }

  const representatives = new Map<string, LoopFamilyRepresentative>();

  for (const [familyRoot, members] of byFamily) {
    const sortedMembers = [...members].sort((left, right) => {
      const leftIndex = left.loop?.iterationIndex ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = right.loop?.iterationIndex ?? Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return left.questionId.localeCompare(right.questionId);
    });
    const representative = sortedMembers[0];
    const summedQuestionBase = sortedMembers.every(entry => Number.isFinite(entry.questionBase))
      ? sortedMembers.reduce((sum, entry) => sum + Number(entry.questionBase), 0)
      : null;

    representatives.set(familyRoot, {
      familyRoot,
      members: sortedMembers,
      representative,
      summedQuestionBase,
    });
  }

  return representatives;
}

function collectPlannedStructuralVariables(
  planned: PlannedTable,
  entry: QuestionIdEntry | undefined,
): string[] {
  return uniqueStrings([
    ...(entry?.items?.map(item => item.column) ?? []),
    planned.appliesToItem,
    planned.computeMaskAnchorVariable,
    ...(planned.appliesToColumn?.split(',').map(value => value.trim()) ?? []),
  ]);
}

function collectCanonicalStructuralVariables(table: CanonicalTable): string[] {
  const rowVariables = table.rows.flatMap((row) => {
    const rowVars = row.variable && row.variable !== '_CAT_'
      ? [row.variable]
      : [];
    return rowVars.concat(row.netComponents ?? []);
  });

  return uniqueStrings([
    ...rowVariables,
    table.appliesToItem,
    table.computeMaskAnchorVariable,
    ...(table.appliesToColumn?.split(',').map(value => value.trim()) ?? []),
  ]);
}

function resolveLoopCoverage(
  variables: string[],
  lookup: Map<string, LoopColumnRef>,
): LoopCoverage | null {
  const refs = uniqueStrings(variables)
    .map(variable => lookup.get(variable))
    .filter((value): value is LoopColumnRef => Boolean(value));

  if (refs.length === 0) return null;

  const familyRoots = new Set(refs.map(ref => ref.familyBase ?? ''));
  const frameNames = new Set(refs.map(ref => ref.frameName));
  if (familyRoots.size !== 1 || frameNames.size !== 1) {
    return null;
  }

  const familyRoot = refs[0]?.familyBase ?? '';
  const frameName = refs[0]?.frameName ?? '';
  if (!familyRoot || !frameName) return null;

  return { familyRoot, frameName };
}

function buildLoopAwareBaseDisclosure(
  planned: PlannedTable,
  familyRoot: string,
  summedQuestionBase: number | null,
): CanonicalBaseDisclosure {
  const existing = planned.baseDisclosure;
  return {
    referenceBaseN: summedQuestionBase,
    itemBaseRange: existing?.itemBaseRange ?? null,
    defaultBaseText: `Those shown ${familyRoot} across loop iterations`,
    defaultNoteTokens: existing?.defaultNoteTokens ?? [],
    excludedResponseLabels: existing?.excludedResponseLabels,
    rangeDisclosure: existing?.rangeDisclosure ?? null,
    source: existing?.source ?? 'contract',
  };
}

function rewriteVariable(
  variable: string,
  lookup: Map<string, LoopColumnRef>,
): string {
  if (!variable || variable === '_CAT_' || variable.startsWith('_NET_')) {
    return variable;
  }
  return lookup.get(variable)?.baseName ?? variable;
}

function rewriteVariableList(
  values: string[],
  lookup: Map<string, LoopColumnRef>,
): string[] {
  return values.map(value => rewriteVariable(value, lookup));
}

function rewriteDelimitedVariables(
  value: string | null,
  lookup: Map<string, LoopColumnRef>,
): string | null {
  if (!value) return value;
  return value
    .split(',')
    .map(part => rewriteVariable(part.trim(), lookup))
    .join(',');
}

export function collapseLoopFamiliesInValidatedPlan(
  validatedPlan: ValidatedPlanOutput,
  entries: QuestionIdEntry[],
  loopMappings: LoopGroupMapping[] = [],
): ValidatedPlanOutput {
  if (loopMappings.length === 0) return validatedPlan;

  const entryByQuestionId = new Map(entries.map(entry => [entry.questionId, entry] as const));
  const representatives = buildLoopFamilyRepresentatives(entries);
  const iterationLookup = buildIterationColumnLookup(loopMappings);

  let removedTables = 0;
  const plannedTables = validatedPlan.plannedTables.flatMap((planned) => {
    const familyRoot = planned.sourceLoopQuestionId ?? planned.familyRoot;
    if (!familyRoot) return [planned];

    const family = representatives.get(familyRoot);
    if (!family) return [planned];

    const sourceEntry = planned.sourceQuestionId
      ? entryByQuestionId.get(planned.sourceQuestionId)
      : undefined;
    const coverage = resolveLoopCoverage(
      collectPlannedStructuralVariables(planned, sourceEntry),
      iterationLookup,
    );

    if (!coverage || coverage.familyRoot !== family.familyRoot) {
      return [planned];
    }

    if (planned.sourceQuestionId && planned.sourceQuestionId !== family.representative.questionId) {
      removedTables += 1;
      return [];
    }

    const baseContract = projectTableBaseContract(
      family.representative.baseContract ?? planned.baseContract,
      {
        basePolicy: planned.basePolicy,
        questionBase: family.summedQuestionBase,
        itemBase: planned.itemBase,
      },
    );

    return [{
      ...planned,
      sourceQuestionId: family.representative.questionId,
      questionBase: family.summedQuestionBase,
      baseContract,
      baseDisclosure: buildLoopAwareBaseDisclosure(
        planned,
        family.familyRoot,
        family.summedQuestionBase,
      ),
      notes: [
        ...planned.notes,
        `Loop family collapsed to representative "${family.representative.questionId}" (${family.familyRoot}).`,
      ],
    }];
  });

  if (removedTables === 0) {
    return validatedPlan;
  }

  return {
    ...validatedPlan,
    metadata: {
      ...validatedPlan.metadata,
      loopFamilyCollapseRemovedTables: removedTables,
      loopFamilyCollapseCompletedAt: new Date().toISOString(),
    },
    plannedTables,
  };
}

function rewriteCanonicalRow(
  row: CanonicalRow,
  lookup: Map<string, LoopColumnRef>,
): CanonicalRow {
  return {
    ...row,
    variable: rewriteVariable(row.variable, lookup),
    netComponents: rewriteVariableList(row.netComponents ?? [], lookup),
  };
}

export function normalizeCanonicalLoopTables(
  canonicalOutput: CanonicalTableOutput,
  loopMappings: LoopGroupMapping[] = [],
): CanonicalTableOutput {
  if (loopMappings.length === 0) return canonicalOutput;

  const iterationLookup = buildIterationColumnLookup(loopMappings);
  const baseNameLookup = buildBaseNameLookup(loopMappings);

  const tables = canonicalOutput.tables.map((table) => {
    const coverage = resolveLoopCoverage(
      collectCanonicalStructuralVariables(table),
      iterationLookup,
    );
    if (!coverage || coverage.familyRoot !== table.familyRoot) {
      return table;
    }

    const rows = table.rows.map(row => rewriteCanonicalRow(row, iterationLookup));
    const appliesToItem = table.appliesToItem
      ? rewriteVariable(table.appliesToItem, iterationLookup)
      : table.appliesToItem;
    const computeMaskAnchorVariable = table.computeMaskAnchorVariable
      ? rewriteVariable(table.computeMaskAnchorVariable, iterationLookup)
      : table.computeMaskAnchorVariable;
    const appliesToColumn = rewriteDelimitedVariables(table.appliesToColumn, iterationLookup);

    const familyRootRef = baseNameLookup.get(table.familyRoot);
    const normalizedQuestionId = familyRootRef?.familyBase ?? table.familyRoot;

    return {
      ...table,
      questionId: normalizedQuestionId,
      rows,
      appliesToItem,
      computeMaskAnchorVariable,
      appliesToColumn,
      notes: [
        ...table.notes,
        `Loop variables normalized to family root "${normalizedQuestionId}".`,
      ],
    };
  });

  return {
    ...canonicalOutput,
    tables,
  };
}
