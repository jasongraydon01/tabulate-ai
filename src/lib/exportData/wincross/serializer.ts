import type {
  JobRoutingManifest,
  TableRoutingArtifact,
  WinCrossApplicationDiagnostics,
  WinCrossBannerApplicationDiagnostics,
  WinCrossBannerDisplayTemplateKind,
  WinCrossTableAfStrategy,
  WinCrossTableApplicationDiagnostic,
  WinCrossTableDisplayTemplateKind,
  WinCrossTableTemplateKind,
  WinCrossTableUseStrategy,
  WinCrossPreferenceProfile,
} from '@/lib/exportData/types';
import { normalizeExpression, parseExpression, type ExpressionNode } from '@/lib/exportData/expression';
import type { WinCrossResolvedArtifacts } from './types';
import { resolveExportBaseContext } from '@/lib/exportData/baseContext';

export interface SerializedTableStatus {
  tableId: string;
  ordinal: number;
  semanticExportStatus: 'exported' | 'blocked';
  styleParityStatus: 'parity' | 'basic' | 'blocked';
  usedUse: boolean;
  usedAf: boolean;
  dataFrameRef: string;
  warnings: string[];
}

export interface SerializedWinCross {
  content: Buffer;
  contentUtf8: string;
  tableCount: number;
  useCount: number;
  afCount: number;
  blockedCount: number;
  warnings: string[];
  applicationDiagnostics: WinCrossApplicationDiagnostics;
  tableStatuses: SerializedTableStatus[];
}

interface TableFingerprint {
  tableType: string;
  rowKinds: string[];
  rowVariables: string[];
  headerSignature: string[];
  displayTemplateKind: WinCrossTableDisplayTemplateKind;
  displaySignature: string[];
  optionSignature: string;
  dataFrameRef: string;
  hasAdditionalFilter: boolean;
}

interface UseAnchor {
  ordinal: number;
  tableType: string;
  dataFrameRef: string;
  optionSignature: string;
  additionalFilter: string;
  displayTemplateKind: WinCrossTableDisplayTemplateKind;
  headerRows: TableHeaderRow[];
  rows: Array<Record<string, unknown>>;
}

interface TableHeaderRow {
  rowIndex: number;
  label: string;
  filterValue: string;
  indent: number;
}

interface NormalizedTableDisplay {
  bodyRows: Array<Record<string, unknown>>;
  headerRows: TableHeaderRow[];
}

interface TableDisplayTemplate {
  kind: WinCrossTableDisplayTemplateKind;
  headerRowCount: number;
  indentedBodyRowCount: number;
}

interface TableRowFormattingHints {
  valueReferenceColumn: number | null;
  statLabelCaretColumn: number | null;
  netRowSuffixToken: string | null;
  headerLeadingSpaces: number | null;
}

interface TableStyleHintApplication {
  formattingHints: TableRowFormattingHints;
  applied: string[];
  skipped: string[];
  unsafe: string[];
}

interface BannerStyleResult {
  headerLine: string;
  directiveLines: string[];
  memberSuffix: string | null;
  memberPrefix: string;
  displayLines: string[];
  diagnostics: WinCrossBannerApplicationDiagnostics;
}

interface BannerDisplayTemplate {
  kind: WinCrossBannerDisplayTemplateKind;
  sourceLineCount: number;
  sourceColumnRowLineCount: number;
}

interface VariableStatDomain {
  min: number;
  max: number;
}

interface IndexedVariableBinding {
  frameName: string;
  baseName: string;
  indexPosition: number;
  indexReference: string;
  iterationValue: string;
  indexLevel: number;
}

interface LoopIndexFrameContext {
  frameName: string;
  iterations: string[];
  variableCount: number;
  bindingByColumn: Map<string, IndexedVariableBinding>;
  bindingByBaseName: Map<string, IndexedVariableBinding>;
}

interface LoopIndexContext {
  glossaryLines: string[];
  frameContexts: Map<string, LoopIndexFrameContext>;
  warnings: string[];
}

interface IndexedTableTransformResult {
  rows: Array<Record<string, unknown>>;
  additionalFilter: string;
  idxFilter: string | null;
  notes: string[];
  warnings: string[];
}

export interface WinCrossQuestionTitleHint {
  questionText?: string;
  surveyText?: string | null;
  savLabel?: string | null;
  label?: string | null;
}

interface WinCrossTitleLayout {
  line: string;
  lineBreakCount: number;
  wrapped: boolean;
  truncated: boolean;
}

interface NativeAfDecision {
  line: string | null;
  emittedRows: Array<Record<string, unknown>>;
  strategy: Extract<WinCrossTableAfStrategy, 'native_single_variable_stat' | 'native_single_variable_stat_with_interim_values'> | null;
  notes: string[];
}

const WINCROSS_TABLE_TITLE_MAX_CHARS = 1000;
const WINCROSS_TABLE_TITLE_SAFETY_MAX_LINES = 4;
const WINCROSS_TABLE_TITLE_SAFETY_WRAP_WIDTH = 30;

interface SerializeWinCrossOptions {
  tableRouting?: TableRoutingArtifact;
  jobRouting?: JobRoutingManifest;
  questionTitleHintsById?: Record<string, WinCrossQuestionTitleHint>;
}

type WinCrossDenominatorSemantic =
  | 'answering_base'
  | 'sample_base'
  | 'qualified_respondents'
  | 'filtered_sample'
  | 'response_level';

interface ResolvedWinCrossTableSemantics {
  semantic: WinCrossDenominatorSemantic | null;
  optionSignature: string;
  totalLine: string;
  qualifiedCodes: string[];
  filteredTotalExpr: string | null;
}

export function serializeWinCrossJob(
  artifacts: WinCrossResolvedArtifacts,
  profile: WinCrossPreferenceProfile,
  options?: SerializeWinCrossOptions,
): SerializedWinCross {
  const warnings: string[] = [];
  const tableStatuses: SerializedTableStatus[] = [];
  const tableDiagnostics: WinCrossTableApplicationDiagnostic[] = [];
  const lines: string[] = [];

  const sortedTables = [...artifacts.sortedFinal.tables].sort((a, b) => {
    const aSortOrder = (a as Record<string, unknown>).sortOrder;
    const bSortOrder = (b as Record<string, unknown>).sortOrder;
    const aOrder = typeof aSortOrder === 'number'
      ? aSortOrder
      : Number.MAX_SAFE_INTEGER;
    const bOrder = typeof bSortOrder === 'number'
      ? bSortOrder
      : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.tableId.localeCompare(b.tableId);
  });

  const defaultOptions = profile.tableOptionSignature ?? 'OS,OR,OV,OI2,O%';
  const defaultTotalLine = profile.defaultTotalLine ?? 'Total^TN^1';
  const variableStatDomains = buildVariableStatDomainIndex(sortedTables);
  const tableRoutingMap = options?.tableRouting?.tableToDataFrameRef ?? {};
  const loopIndexContext = buildLoopIndexContext(artifacts.loopSummary, tableRoutingMap);
  warnings.push(...loopIndexContext.warnings);

  // [VERSION]
  lines.push('[VERSION]');
  lines.push(profile.version ?? '25.0');
  lines.push('');

  // [PREFERENCES]
  lines.push('[PREFERENCES]');
  for (const line of buildPreferenceLines(profile, defaultOptions, defaultTotalLine)) {
    lines.push(line);
  }
  lines.push('');

  // [SIGFOOTER]
  lines.push('[SIGFOOTER]');
  if (profile.sigFooterLines.length > 0) {
    for (const line of profile.sigFooterLines) lines.push(normalizeWinCrossDisplayText(line));
  } else {
    lines.push('Significance tested at 95% confidence level.');
    lines.push('Letters indicate statistically significant differences.');
  }
  lines.push('');

  // [GLOSSARY]
  lines.push('[GLOSSARY]');
  for (const line of loopIndexContext.glossaryLines) {
    lines.push(line);
  }
  const preservedGlossaryLines = (profile.passthroughSections.GLOSSARY ?? [])
    .filter((line) => !/^INDEX\b/i.test(line.trim()));
  if ((profile.passthroughSections.GLOSSARY ?? []).length !== preservedGlossaryLines.length) {
    warnings.push('Ignored uploaded [GLOSSARY] INDEX lines in favor of run-derived WinCross INDEX generation.');
  }
  if (
    loopIndexContext.glossaryLines.length > 0
    && preservedGlossaryLines.length > 0
  ) {
    lines.push('');
  }
  for (const line of preservedGlossaryLines) {
    lines.push(indentGlossaryLine(line));
  }
  lines.push('');

  // [TABLES] — single-job output with indexed stacked-table logic when available
  lines.push('[TABLES]');

  const frameOrder = buildFrameOrder(sortedTables, tableRoutingMap);
  const tables = frameOrder.flatMap((frame) => (
    sortedTables.filter((table) => (tableRoutingMap[table.tableId] ?? 'wide') === frame)
  ));

  const anchorByFingerprint = new Map<string, UseAnchor>();
  const anchors: UseAnchor[] = [];
  let useCount = 0;
  let afCount = 0;
  let blockedCount = 0;
  let ordinal = 1;

  for (const table of tables) {
    const dataFrameRef = tableRoutingMap[table.tableId] ?? 'wide';

    const tableId = `T${ordinal}`;
    const tableHeader = `${tableId}^${ordinal}`;
    const titleHint = options?.questionTitleHintsById?.[table.questionId];
    const titleLayout = layoutWinCrossTableTitle(
      resolveWinCrossTableTitle(table as Record<string, unknown>, titleHint),
    );
    const baseContext = resolveExportBaseContext(table as Record<string, unknown>);
    const baseText = (
      baseContext.compactDisclosureText
      ?? (table as { baseText?: string }).baseText?.trim()
    ) || 'SBase';
    const normalizedTable = normalizeTableDisplay(table as Record<string, unknown>);
    const indexedTable = transformIndexedTable(
      normalizedTable.bodyRows,
      (table.additionalFilter ?? '').trim(),
      loopIndexContext.frameContexts.get(dataFrameRef),
    );
    const bodyRows = indexedTable.rows;
    const headerRows = normalizedTable.headerRows;
    const additionalFilter = combineTableFilters(indexedTable.additionalFilter, indexedTable.idxFilter);
    const resolvedSemantics = resolveWinCrossTableSemantics(
      table as Record<string, unknown>,
      defaultOptions,
      defaultTotalLine,
      additionalFilter,
    );
    const tableTemplateKind = classifyTableTemplate(bodyRows);
    const tableDisplayTemplate = classifyTableDisplayTemplate(bodyRows, headerRows);
    const displaySignature = buildTableDisplaySignature(bodyRows, headerRows, profile);
    const styleHintApplication = deriveTableStyleHintApplication(profile, bodyRows, headerRows, tableDisplayTemplate);

    // Stage C check: blocked tables (no rows, unresolvable)
    if (!bodyRows || bodyRows.length === 0) {
      const status: SerializedTableStatus = {
        tableId: table.tableId,
        ordinal,
        semanticExportStatus: 'blocked',
        styleParityStatus: 'blocked',
        usedUse: false,
        usedAf: false,
        dataFrameRef,
        warnings: [`Table ${table.tableId} has no rows; blocked from export.`],
      };
      tableStatuses.push(status);
      tableDiagnostics.push({
        tableId: table.tableId,
        ordinal,
        templateKind: tableTemplateKind,
        displayTemplateKind: tableDisplayTemplate.kind,
        headerRowCount: tableDisplayTemplate.headerRowCount,
        indentedBodyRowCount: tableDisplayTemplate.indentedBodyRowCount,
        appliedStyleHints: styleHintApplication.applied,
        skippedStyleHints: styleHintApplication.skipped,
        unsafeStyleHints: styleHintApplication.unsafe,
        useStrategy: 'none',
        afStrategy: 'none',
        status: 'blocked',
        notes: ['Table has no rows and was blocked from export.'],
      });
      warnings.push(status.warnings[0]);
      blockedCount += 1;
      ordinal += 1;
      continue;
    }

    lines.push(tableHeader);
    lines.push(indentTableContentLine(resolvedSemantics.optionSignature));
    lines.push(indentTableContentLine(titleLayout.line));
    lines.push(`SBase: ${baseText}`);
    lines.push(indentTableContentLine(resolvedSemantics.totalLine));

    // Stage A (parity): try USE= with conservative fingerprint including dataFrameRef
    const fingerprint = buildFingerprint(
      table.tableType,
      bodyRows,
      headerRows,
      displaySignature,
      tableDisplayTemplate.kind,
      resolvedSemantics.optionSignature,
      dataFrameRef,
      additionalFilter,
    );
    const key = stableFingerprint(fingerprint);
    const existingAnchor = anchorByFingerprint.get(key);

    let usedUse = false;
    let usedAf = false;
    let styleParityStatus: 'parity' | 'basic' = 'basic';
    let useStrategy: WinCrossTableUseStrategy = 'none';
    let afStrategy: WinCrossTableAfStrategy = 'none';
    let degradedTableDisplay = false;

    const tableWarnings: string[] = [];
    const tableNotes: string[] = [
      `Recognized table template: ${tableTemplateKind}.`,
      `Recognized table display template: ${tableDisplayTemplate.kind}.`,
    ];
    if (resolvedSemantics.semantic) {
      tableNotes.push(`Resolved WinCross denominator semantic: ${resolvedSemantics.semantic}.`);
    } else {
      tableNotes.push(`Fell back to profile default total line: ${resolvedSemantics.totalLine}.`);
    }
    if (resolvedSemantics.qualifiedCodes.length > 0) {
      tableNotes.push(`Applied table-level PO qualification for codes ${formatQualifiedCodesForPo(resolvedSemantics.qualifiedCodes)}.`);
    }
    if (resolvedSemantics.filteredTotalExpr) {
      tableNotes.push(`Applied filtered total line via ${resolvedSemantics.filteredTotalExpr}.`);
    }
    tableWarnings.push(...indexedTable.warnings);
    tableNotes.push(...indexedTable.notes);
    if (titleLayout.truncated) {
      tableWarnings.push(
        `Table ${table.tableId} title exceeded the WinCross title length limit and was truncated.`,
      );
      tableNotes.push('Truncated table title to fit the WinCross title length limit.');
    }
    for (const note of styleHintApplication.applied) {
      tableNotes.push(`Applied source table style hint: ${note}`);
    }
    for (const note of styleHintApplication.skipped) {
      tableNotes.push(`Skipped source table style hint: ${note}`);
    }
    for (const note of styleHintApplication.unsafe) {
      tableNotes.push(`Unsafe source table style hint: ${note}`);
    }

    const nativeAfDecision = resolveNativeAfDecision(
      bodyRows,
      additionalFilter,
      indexedTable.idxFilter,
      tableTemplateKind,
    );
    tableNotes.push(...nativeAfDecision.notes);
    let emittedNativeAfLine = false;

    if (existingAnchor) {
      // Stage A parity: USE= reuse
      lines.push(`USE=${existingAnchor.ordinal}`);
      useCount += 1;
      usedUse = true;
      useStrategy = 'direct_reuse';
      styleParityStatus = 'parity';
      tableNotes.push(`Reused prior table structure via USE=${existingAnchor.ordinal}.`);
    } else {
      const derivedUseLine = deriveUseLineFromAnchors(
        anchors,
        { ...table, rows: bodyRows, headerRows },
        profile,
        variableStatDomains,
        resolvedSemantics.optionSignature,
        dataFrameRef,
        additionalFilter,
      );
      if (derivedUseLine) {
        lines.push(derivedUseLine);
        useCount += 1;
        usedUse = true;
        useStrategy = derivedUseLine.includes(',') ? 'substitution_reuse' : 'direct_reuse';
        styleParityStatus = 'parity';
        tableNotes.push(`Reused prior table structure via ${derivedUseLine}.`);
      } else {
        // Emit full row block
        const anchor: UseAnchor = {
          ordinal,
          tableType: table.tableType,
          dataFrameRef,
          optionSignature: resolvedSemantics.optionSignature,
          additionalFilter,
          displayTemplateKind: tableDisplayTemplate.kind,
          headerRows,
          rows: bodyRows,
        };
        anchorByFingerprint.set(key, anchor);
        anchors.push(anchor);
        if (nativeAfDecision.line) {
          lines.push(nativeAfDecision.line);
          afCount += 1;
          usedAf = true;
          emittedNativeAfLine = true;
          afStrategy = nativeAfDecision.strategy ?? 'none';
          tableNotes.push(`Applied native AF strategy: ${nativeAfDecision.line}.`);
        }
        const rowResult = emitRowBlock(
          { ...table, rows: nativeAfDecision.emittedRows },
          headerRows,
          profile,
          variableStatDomains,
          styleHintApplication.formattingHints,
          tableWarnings,
        );
        degradedTableDisplay = rowResult.degradedToBasic;
        tableNotes.push(...rowResult.notes);
        for (const line of rowResult.lines) lines.push(indentTableContentLine(line));
      }
    }

    usedAf = emittedNativeAfLine;
    if (!nativeAfDecision.line && additionalFilter.length > 0) {
      lines.push(`AF=${additionalFilter}`);
      afCount += 1;
      usedAf = true;
      afStrategy = 'raw_additional_filter';
      tableNotes.push(`Applied raw additional filter via AF=${additionalFilter}.`);
    }
    if (!usedAf && afStrategy === 'none') {
      tableNotes.push('No AF strategy applied.');
    }
    if (!usedUse && useStrategy === 'none') {
      tableNotes.push('No USE reuse was proven for this table.');
    }
    if (headerRows.length > 0) {
      tableNotes.push(`Applied ${headerRows.length} current-run table header row(s).`);
    }

    lines.push('');

    warnings.push(...tableWarnings);
    tableDiagnostics.push({
      tableId: table.tableId,
      ordinal,
      templateKind: tableTemplateKind,
      displayTemplateKind: tableDisplayTemplate.kind,
      headerRowCount: tableDisplayTemplate.headerRowCount,
      indentedBodyRowCount: tableDisplayTemplate.indentedBodyRowCount,
      appliedStyleHints: styleHintApplication.applied,
      skippedStyleHints: styleHintApplication.skipped,
      unsafeStyleHints: styleHintApplication.unsafe,
      useStrategy,
      afStrategy,
      status: degradedTableDisplay ? 'degraded' : styleParityStatus,
      notes: tableNotes,
    });
    tableStatuses.push({
      tableId: table.tableId,
      ordinal,
      semanticExportStatus: 'exported',
      styleParityStatus,
      usedUse,
      usedAf,
      dataFrameRef,
      warnings: tableWarnings,
    });

    ordinal += 1;
  }

  // [BANNERS] — banner membership always comes from the current run,
  // while portable layout/style hints may come from the profile.
  lines.push('[BANNERS]');
  const bannerStyle = buildBannerStyle(profile, artifacts.crosstabRaw.bannerCuts);
  lines.push(bannerStyle.headerLine);
  for (const directive of bannerStyle.directiveLines) {
    lines.push(directive);
  }
  lines.push(formatBannerTotalLine(bannerStyle.memberSuffix, bannerStyle.memberPrefix));
  for (const group of artifacts.crosstabRaw.bannerCuts) {
    for (const column of group.columns) {
      const expression = typeof column.adjusted === 'string' ? column.adjusted.trim() : '';
      if (expression.length > 0) {
        const logic = translateBannerExpressionToWinCross(expression);
        if (logic) {
          lines.push(formatBannerMemberLine(logic, bannerStyle.memberSuffix, bannerStyle.memberPrefix));
          continue;
        }
        warnings.push(`Banner column "${column.name}" could not be translated to WinCross logic from expression "${expression}"; emitted label-only banner entry.`);
        lines.push(formatBannerLabelOnlyLine(column.name, bannerStyle.memberSuffix, bannerStyle.memberPrefix));
      } else {
        warnings.push(`Banner column "${column.name}" is missing an adjusted expression; emitted label-only banner entry.`);
        lines.push(formatBannerLabelOnlyLine(column.name, bannerStyle.memberSuffix, bannerStyle.memberPrefix));
      }
    }
  }
  for (const displayLine of bannerStyle.displayLines) {
    lines.push(displayLine);
  }
  if (bannerStyle.diagnostics.status === 'degraded') {
    warnings.push(...bannerStyle.diagnostics.notes);
  }
  lines.push('');

  // [SIDEBYSIDE]
  lines.push('[SIDEBYSIDE]');
  for (const line of profile.passthroughSections.SIDEBYSIDE ?? []) {
    lines.push(line);
  }
  lines.push('');

  // [TITLE]
  lines.push('[TITLE]');
  if (profile.titleLines.length > 0) {
    for (const line of profile.titleLines) lines.push(normalizeWinCrossDisplayText(line));
  } else {
    lines.push('Generated by TabulateAI WinCross exporter');
  }

  // Build UTF-8 string with CRLF line endings
  const contentUtf8 = lines.join('\r\n') + '\r\n';

  // Build UTF-16LE Buffer with BOM
  const bom = Buffer.from([0xFF, 0xFE]);
  const body = Buffer.from(contentUtf8, 'utf16le');
  const content = Buffer.concat([bom, body]);

  return {
    content,
    contentUtf8,
    tableCount: tables.length,
    useCount,
    afCount,
    blockedCount,
    warnings,
    applicationDiagnostics: {
      banner: bannerStyle.diagnostics,
      tables: tableDiagnostics,
    },
    tableStatuses,
  };
}

interface RowBlockResult {
  lines: string[];
  degradedToBasic: boolean;
  notes: string[];
}

const WINCROSS_TABLE_CONTENT_INDENT = ' ';

function emitRowBlock(
  table: { tableId: string; tableType: string; rows: Array<Record<string, unknown>> },
  headerRows: TableHeaderRow[],
  profile: WinCrossPreferenceProfile,
  variableStatDomains: Map<string, VariableStatDomain>,
  formattingHints: TableRowFormattingHints,
  warnings: string[],
): RowBlockResult {
  const resultLines: string[] = [];
  let degradedToBasic = false;
  const notes: string[] = [];
  const singleVariableStatTable = hasSingleStatVariable(table.rows);

  const headersByIndex = new Map<number, TableHeaderRow[]>();
  for (const headerRow of headerRows) {
    const bucket = headersByIndex.get(headerRow.rowIndex) ?? [];
    bucket.push(headerRow);
    headersByIndex.set(headerRow.rowIndex, bucket);
  }

  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
    const pendingHeaders = headersByIndex.get(rowIndex) ?? [];
    for (const headerRow of pendingHeaders) {
      resultLines.push(`${formatHeaderLabel(headerRow.label, headerRow.indent, formattingHints.headerLeadingSpaces)}^`);
    }
    const row = table.rows[rowIndex] as Record<string, unknown>;
    const variable = typeof row.variable === 'string' ? (row.variable as string).trim() : '';
    const label = deriveDisplayLabel(row, profile, variable, notes);
    const formattedLabel = applyRowIndent(label, row.indent);

    if (row.isNet) {
      const netSize = deriveNetSize(row);
      if (netSize <= 0) {
        warnings.push(`Table ${table.tableId} contains a NET row without resolvable components; emitted as label-only row.`);
        resultLines.push(`${formattedLabel}^`);
        degradedToBasic = true;
        notes.push('Emitted a label-only NET row because component membership could not be proven.');
        continue;
      }
      resultLines.push(formatReferenceAlignedRow(
        formattedLabel,
        `NET${netSize}`,
        formattingHints.valueReferenceColumn,
        formattingHints.netRowSuffixToken ?? 'SX',
      ));
      continue;
    }

    if (isNotAnsweredRow(row)) {
      const variableRef = typeof row.variable === 'string' ? row.variable.trim() : '';
      const range = variableRef
        ? resolveVariableValueRangeExpression(variableRef, table.rows, variableStatDomains)
        : '';
      const referenceField = variableRef
        ? `NOT ${variableRef} ${range}`.trim()
        : 'NOT';
      resultLines.push(formatReferenceAlignedRow(
        formattedLabel,
        referenceField,
        formattingHints.valueReferenceColumn,
        'SK',
      ));
      continue;
    }

    if (row.rowKind === 'stat' || table.tableType === 'mean_rows') {
      const statType = typeof row.statType === 'string'
        ? row.statType as string
        : undefined;
      const statToken = mapStatToken(statType, profile);
      const variableRef = typeof row.variable === 'string' ? row.variable.trim() : '';
      const range = variableRef
        ? resolveStatRangeExpression(row, variableRef, table.rows, table.tableType, variableStatDomains)
        : '';
      const valueRef = variableRef ? `${variableRef} ${range}`.trim() : `${statToken}${range}`;
      if (variableRef) {
        if (singleVariableStatTable && formattingHints.statLabelCaretColumn !== null) {
          resultLines.push(formatLabelAlignedRow(
            formattedLabel,
            valueRef,
            formattingHints.statLabelCaretColumn,
            statToken,
          ));
        } else {
          resultLines.push(formatReferenceAlignedRow(
            formattedLabel,
            valueRef,
            formattingHints.valueReferenceColumn,
            statToken,
          ));
        }
      } else {
        const compactValue = `${statToken}${range}`;
        if (formattingHints.statLabelCaretColumn !== null) {
          resultLines.push(formatLabelAlignedRow(
            formattedLabel,
            compactValue,
            formattingHints.statLabelCaretColumn,
          ));
        } else {
          resultLines.push(`${formattedLabel}^${compactValue}`);
        }
      }
      continue;
    }

    if (variable.length === 0) {
      warnings.push(`Table ${table.tableId} contains a row without variable; emitted as label-only row.`);
      resultLines.push(`${formattedLabel}^`);
      degradedToBasic = true;
      notes.push('Emitted a label-only row because a variable reference was missing.');
      continue;
    }

    const filterSuffix = row.filterValue ? ` (${row.filterValue})` : '';
    resultLines.push(formatReferenceAlignedRow(
      formattedLabel,
      `${variable}${filterSuffix}`,
      formattingHints.valueReferenceColumn,
    ));
  }

  const trailingHeaders = [...headersByIndex.entries()]
    .filter(([rowIndex]) => rowIndex >= table.rows.length)
    .sort(([a], [b]) => a - b)
    .flatMap(([, headerGroup]) => headerGroup);
  for (const headerRow of trailingHeaders) {
    resultLines.push(`${formatHeaderLabel(headerRow.label, headerRow.indent, formattingHints.headerLeadingSpaces)}^`);
  }

  return { lines: resultLines, degradedToBasic, notes };
}

function indentTableContentLine(line: string): string {
  return line.length > 0 ? `${WINCROSS_TABLE_CONTENT_INDENT}${line}` : line;
}

function indentGlossaryLine(line: string): string {
  if (!line) return line;
  if (/^\s/.test(line)) return line;
  if (line.trimStart().startsWith('*')) return line;
  return ` ${line}`;
}

function buildLoopIndexContext(
  loopSummary: WinCrossResolvedArtifacts['loopSummary'],
  tableToFrame: Record<string, string>,
): LoopIndexContext {
  const warnings: string[] = [];
  const frameContexts = new Map<string, LoopIndexFrameContext>();
  const glossaryLines: string[] = [];
  const usedFrames = new Set(
    Object.values(tableToFrame)
      .filter((frame): frame is string => typeof frame === 'string' && frame.trim().length > 0 && frame !== 'wide'),
  );

  if (usedFrames.size === 0) {
    return { glossaryLines, frameContexts, warnings };
  }

  const groupsByFrame = new Map(
    loopSummary.groups.map((group) => [group.stackedFrameName, group] as const),
  );
  const blocks = new Map<string, Array<{
    frameName: string;
    iterations: string[];
    variableNamesByLevel: string[][];
    bindingByColumn: Map<string, IndexedVariableBinding>;
  }>>();

  for (const frameName of [...usedFrames].sort((a, b) => a.localeCompare(b))) {
    const group = groupsByFrame.get(frameName);
    if (!group) {
      warnings.push(`WinCross INDEX generation could not find loop-summary mapping for routed frame "${frameName}".`);
      continue;
    }

    const iterations = [...group.iterations];
    if (iterations.length === 0) {
      warnings.push(`WinCross INDEX generation skipped frame "${frameName}" because it has no loop iterations.`);
      continue;
    }

    const bindingByColumn = new Map<string, IndexedVariableBinding>();
    const bindingByBaseName = new Map<string, IndexedVariableBinding>();
    const variableNamesByLevel: string[][] = iterations.map(() => []);
    const completeVariables = group.variables.filter((variable) => {
      return iterations.every((iteration) => typeof variable.iterationColumns[iteration] === 'string');
    });

    if (completeVariables.length === 0) {
      warnings.push(`WinCross INDEX generation skipped frame "${frameName}" because no complete indexed variables were available.`);
      continue;
    }

    const signature = iterations.join('\u0000');
    const blockEntries = blocks.get(signature) ?? [];
    let positionOffset = blockEntries.reduce((sum, entry) => sum + entry.bindingByColumn.size / entry.iterations.length, 0);
    if (!Number.isFinite(positionOffset)) {
      positionOffset = 0;
    }

    completeVariables.forEach((variable, variableIndex) => {
      const indexPosition = positionOffset + variableIndex + 1;
      const indexReference = `I${indexPosition}`;
      iterations.forEach((iterationValue, levelIndex) => {
        const columnName = variable.iterationColumns[iterationValue];
        variableNamesByLevel[levelIndex].push(columnName);
        const binding: IndexedVariableBinding = {
          frameName,
          baseName: variable.baseName,
          indexPosition,
          indexReference,
          iterationValue,
          indexLevel: levelIndex + 1,
        };
        bindingByColumn.set(columnName, binding);
        // Map base name → iteration-1 binding so table rows using base names
        // (e.g., "hCHANNEL_r1" instead of "hCHANNEL_1r1") resolve correctly.
        if (levelIndex === 0) {
          bindingByBaseName.set(variable.baseName, binding);
        }
      });
    });

    frameContexts.set(frameName, {
      frameName,
      iterations,
      variableCount: completeVariables.length,
      bindingByColumn,
      bindingByBaseName,
    });
    blockEntries.push({
      frameName,
      iterations,
      variableNamesByLevel,
      bindingByColumn,
    });
    blocks.set(signature, blockEntries);
  }

  const blockSignatures = [...blocks.keys()].sort((a, b) => a.localeCompare(b));
  if (blockSignatures.length > 1) {
    warnings.push('WinCross INDEX generation emitted multiple iteration-signature blocks; desktop validation should confirm separate INDEX domains behave as expected.');
  }

  for (const signature of blockSignatures) {
    const entries = blocks.get(signature) ?? [];
    const levelCount = entries[0]?.iterations.length ?? 0;
    for (let levelIndex = 0; levelIndex < levelCount; levelIndex += 1) {
      const variables = entries.flatMap((entry) => entry.variableNamesByLevel[levelIndex] ?? []);
      if (variables.length > 0) {
        glossaryLines.push(indentGlossaryLine(`INDEX {${variables.join(',')}}`));
      }
    }
    if (entries.length > 0 && signature !== blockSignatures[blockSignatures.length - 1]) {
      glossaryLines.push('');
    }
  }

  return { glossaryLines, frameContexts, warnings };
}

function transformIndexedTable(
  rows: Array<Record<string, unknown>>,
  additionalFilter: string,
  frameContext: LoopIndexFrameContext | undefined,
): IndexedTableTransformResult {
  if (!frameContext) {
    return {
      rows,
      additionalFilter,
      idxFilter: null,
      notes: [],
      warnings: [],
    };
  }

  const warnings: string[] = [];
  const notes: string[] = [];
  const indexLevels = new Set<number>();
  const remappedRows = rows.map((row) => {
    const remappedRow: Record<string, unknown> = { ...row };
    const variable = typeof row.variable === 'string' ? row.variable.trim() : '';
    if (variable) {
      const binding = frameContext.bindingByColumn.get(variable)
        ?? frameContext.bindingByBaseName.get(variable);
      if (binding) {
        remappedRow.variable = binding.indexReference;
        indexLevels.add(binding.indexLevel);
      }
    }

    if (Array.isArray(row.netComponents)) {
      remappedRow.netComponents = row.netComponents.map((component) => {
        if (typeof component !== 'string') return component;
        const trimmed = component.trim();
        const binding = frameContext.bindingByColumn.get(trimmed)
          ?? frameContext.bindingByBaseName.get(trimmed);
        if (binding) {
          indexLevels.add(binding.indexLevel);
          return binding.indexReference;
        }
        return component;
      });
    }

    return remappedRow;
  });

  const filterRewrite = rewriteIndexedFilterExpression(additionalFilter, frameContext.bindingByColumn, frameContext.bindingByBaseName);
  filterRewrite.indexLevels.forEach((level) => indexLevels.add(level));
  warnings.push(...filterRewrite.warnings);

  const idxLevels = indexLevels.size > 0
    ? [...indexLevels].sort((a, b) => a - b)
    : Array.from({ length: frameContext.iterations.length }, (_, index) => index + 1);

  if (indexLevels.size === 0) {
    warnings.push(`Indexed frame "${frameContext.frameName}" had no explicit iteration-specific row references; defaulted the table filter to all indexed levels.`);
  }

  const idxFilter = formatIdxFilter(idxLevels);
  notes.push(`Applied WinCross INDEX remapping for frame "${frameContext.frameName}" with ${idxFilter}.`);

  return {
    rows: remappedRows,
    additionalFilter: filterRewrite.expression,
    idxFilter,
    notes,
    warnings,
  };
}

function rewriteIndexedFilterExpression(
  expression: string,
  bindingByColumn: Map<string, IndexedVariableBinding>,
  bindingByBaseName: Map<string, IndexedVariableBinding>,
): { expression: string; indexLevels: number[]; warnings: string[] } {
  const trimmed = expression.trim();
  if (!trimmed) {
    return { expression: '', indexLevels: [], warnings: [] };
  }

  const indexLevels = new Set<number>();
  const parsed = parseExpression(trimmed);
  if (parsed.ok && parsed.parsed) {
    const rewritten = rewriteExpressionNodeIdentifiers(parsed.parsed.ast, bindingByColumn, bindingByBaseName, indexLevels);
    return {
      expression: normalizeExpression(rewritten),
      indexLevels: [...indexLevels],
      warnings: [],
    };
  }

  let rewritten = trimmed;
  // Merge both maps for fallback token replacement (column names first, then base names).
  const mergedBindings = new Map(bindingByBaseName);
  for (const [key, value] of bindingByColumn) {
    mergedBindings.set(key, value);
  }
  const bindings = [...mergedBindings.entries()].sort(([left], [right]) => right.length - left.length);
  for (const [columnName, binding] of bindings) {
    const escaped = columnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![A-Za-z0-9_.])${escaped}(?![A-Za-z0-9_.])`, 'g');
    rewritten = rewritten.replace(pattern, () => {
      indexLevels.add(binding.indexLevel);
      return binding.indexReference;
    });
  }

  return {
    expression: rewritten,
    indexLevels: [...indexLevels],
    warnings: [
      `WinCross indexed filter remapping fell back to token replacement for expression "${trimmed}".`,
    ],
  };
}

function rewriteExpressionNodeIdentifiers(
  node: ExpressionNode,
  bindingByColumn: Map<string, IndexedVariableBinding>,
  bindingByBaseName: Map<string, IndexedVariableBinding>,
  indexLevels: Set<number>,
): ExpressionNode {
  switch (node.type) {
    case 'identifier': {
      const binding = bindingByColumn.get(node.name) ?? bindingByBaseName.get(node.name);
      if (!binding) return node;
      indexLevels.add(binding.indexLevel);
      return { type: 'identifier', name: binding.indexReference };
    }
    case 'unary':
      return {
        ...node,
        argument: rewriteExpressionNodeIdentifiers(node.argument, bindingByColumn, bindingByBaseName, indexLevels),
      };
    case 'binary':
      return {
        ...node,
        left: rewriteExpressionNodeIdentifiers(node.left, bindingByColumn, bindingByBaseName, indexLevels),
        right: rewriteExpressionNodeIdentifiers(node.right, bindingByColumn, bindingByBaseName, indexLevels),
      };
    case 'call':
      return {
        ...node,
        args: node.args.map((arg) => rewriteExpressionNodeIdentifiers(arg, bindingByColumn, bindingByBaseName, indexLevels)),
      };
    default:
      return node;
  }
}

function formatIdxFilter(levels: number[]): string {
  const sorted = [...new Set(levels)].sort((a, b) => a - b);
  return `IDX(${collapseNumericValues(sorted)})`;
}

function combineTableFilters(primary: string, secondary: string | null): string {
  const trimmedPrimary = primary.trim();
  const trimmedSecondary = secondary?.trim() ?? '';
  if (!trimmedPrimary) return trimmedSecondary;
  if (!trimmedSecondary) return trimmedPrimary;
  return `${parenthesizeFilterClause(trimmedPrimary)} AND ${trimmedSecondary}`;
}

function parenthesizeFilterClause(clause: string): string {
  if (!/[&|]/.test(clause)) {
    return clause;
  }
  return `(${clause})`;
}

function resolveWinCrossTableTitle(
  table: Record<string, unknown>,
  titleHint?: WinCrossQuestionTitleHint,
): string {
  const subtitle = typeof table.tableSubtitle === 'string' ? table.tableSubtitle.trim() : '';
  const questionId = typeof table.questionId === 'string' ? table.questionId.trim() : '';
  const questionText = typeof table.questionText === 'string' ? table.questionText.trim() : '';
  const fallbackId = typeof table.tableId === 'string' ? table.tableId.trim() : '';
  const identifier = questionId || fallbackId || 'Table';

  const candidates = buildWinCrossTitleCandidates({
    identifier,
    subtitle,
    questionText,
    titleHint,
  });

  for (const priority of [3, 2, 1, 0] as const) {
    const prioritizedCandidates = candidates.filter((candidate) => candidate.priority === priority);
    if (prioritizedCandidates.length === 0) continue;

    const safeCandidate = prioritizedCandidates.find((candidate) => isSafeWinCrossTitleCandidate(candidate.value));
    if (safeCandidate) {
      return safeCandidate.value;
    }

    return prioritizedCandidates[0].value;
  }

  return candidates[0]?.value ?? identifier;
}

function buildWinCrossTitleCandidates(params: {
  identifier: string;
  subtitle: string;
  questionText: string;
  titleHint?: WinCrossQuestionTitleHint;
}): Array<{ value: string; priority: 0 | 1 | 2 | 3 }> {
  const questionCandidates = resolveWinCrossQuestionTextCandidates(
    params.questionText,
    params.titleHint,
  );
  const titleCandidates: Array<{ value: string; priority: 0 | 1 | 2 | 3 }> = [];

  for (const questionCandidate of questionCandidates) {
    titleCandidates.push({
      value: joinWinCrossTitleParts(params.identifier, params.subtitle, questionCandidate),
      priority: params.subtitle ? 3 : 2,
    });
  }

  if (params.subtitle) {
    titleCandidates.push({
      value: joinWinCrossTitleParts(params.identifier, params.subtitle),
      priority: 1,
    });
  }

  for (const questionCandidate of questionCandidates) {
    titleCandidates.push({
      value: joinWinCrossTitleParts(params.identifier, questionCandidate),
      priority: 2,
    });
  }

  titleCandidates.push({ value: params.identifier, priority: 0 });

  return dedupeWinCrossTitleCandidates(titleCandidates);
}

function resolveWinCrossQuestionTextCandidates(
  questionText: string,
  titleHint: WinCrossQuestionTitleHint | undefined,
): string[] {
  const rawLabelText = deriveWinCrossFallbackTitleFromRawLabel(
    titleHint?.label,
    titleHint?.savLabel,
    titleHint?.questionText,
  );

  return dedupeNormalizedTitleStrings([
    normalizeWinCrossTitleCandidate(questionText),
    deriveWinCrossQuestionAskFromTextBlock(questionText),
    deriveWinCrossQuestionAskFromTextBlock(titleHint?.surveyText),
    rawLabelText,
  ]);
}

function joinWinCrossTitleParts(...parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (typeof part === 'string' ? normalizeWinCrossTitleCandidate(part) : ''))
    .filter((part) => part.length > 0)
    .join(' - ');
}

function dedupeWinCrossTitleCandidates(
  candidates: Array<{ value: string; priority: 0 | 1 | 2 | 3 } | string | null | undefined>,
): Array<{ value: string; priority: 0 | 1 | 2 | 3 }> {
  const seen = new Set<string>();
  const result: Array<{ value: string; priority: 0 | 1 | 2 | 3 }> = [];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = typeof candidate === 'string' ? candidate : candidate.value;
    const normalized = normalizeWinCrossTitleCandidate(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({
      value: normalized,
      priority: typeof candidate === 'string' ? 2 : candidate.priority,
    });
  }

  return result;
}

function dedupeNormalizedTitleStrings(candidates: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = normalizeWinCrossTitleCandidate(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function isSafeWinCrossTitleCandidate(value: string): boolean {
  const normalized = normalizeWinCrossTitleCandidate(value);
  if (!normalized) return true;
  if (normalized.length > WINCROSS_TABLE_TITLE_MAX_CHARS) return false;
  return estimateWrappedLineCount(normalized, WINCROSS_TABLE_TITLE_SAFETY_WRAP_WIDTH) <= WINCROSS_TABLE_TITLE_SAFETY_MAX_LINES;
}

function layoutWinCrossTableTitle(title: string): WinCrossTitleLayout {
  const normalized = normalizeWinCrossTitleCandidate(title);
  if (!normalized) {
    return { line: 'Table', lineBreakCount: 0, wrapped: false, truncated: false };
  }

  if (normalized.length <= WINCROSS_TABLE_TITLE_MAX_CHARS) {
    return {
      line: normalized,
      lineBreakCount: 0,
      wrapped: false,
      truncated: false,
    };
  }

  return {
    line: appendTitleEllipsisWithinLimit(normalized, WINCROSS_TABLE_TITLE_MAX_CHARS),
    lineBreakCount: 0,
    wrapped: false,
    truncated: true,
  };
}

function appendTitleEllipsisWithinLimit(value: string, maxChars: number): string {
  if (value.endsWith('...')) return value;
  if (maxChars <= 3) return '.'.repeat(maxChars);
  if (value.length <= maxChars - 3) return `${value}...`;
  return `${value.slice(0, maxChars - 3).trimEnd()}...`;
}

function estimateWrappedLineCount(value: string, maxWidth: number): number {
  if (!value) return 0;

  let remaining = value.trim();
  let lines = 0;

  while (remaining.length > 0) {
    lines += 1;
    if (remaining.length <= maxWidth) break;
    const splitIndex = findTitleSplitIndex(remaining, maxWidth);
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return lines;
}

function findTitleSplitIndex(value: string, maxChars: number): number {
  const candidate = value.slice(0, maxChars + 1);
  const whitespaceIndex = Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf('\t'));
  if (whitespaceIndex > 0) {
    return whitespaceIndex;
  }
  return maxChars;
}

function deriveWinCrossQuestionAskFromTextBlock(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const normalized = normalizeSurveyTextForTitleDerivation(value);
  if (!normalized) return null;

  const interrogativeMatches = normalized.match(/[^?.!]*\?/g) ?? [];
  const interrogatives = interrogativeMatches
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter((value) => value.length > 0);

  const lastQuestion = interrogatives.at(-1);
  if (lastQuestion) {
    return lastQuestion;
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter((value) => value.length > 0);

  return sentences[0] ?? null;
}

function normalizeWinCrossTitleCandidate(value: string): string {
  return normalizeWinCrossDisplayText(value)
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSurveyTextForTitleDerivation(value: string): string {
  return normalizeWinCrossDisplayText(value)
    .replace(/\{\{[^}]+\}\}/g, ' ')
    .replace(/\|[^|\n]*(?:\|[^|\n]*)+/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[A-Za-z0-9_]+\.\s*/, '')
    .trim();
}

function deriveWinCrossFallbackTitleFromRawLabel(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = normalizeWinCrossDisplayText(candidate)
      .replace(/\s+/g, ' ')
      .replace(/^[A-Za-z0-9_]+:\s*/, '')
      .trim();
    if (!normalized) continue;
    return normalized;
  }
  return null;
}


function deriveNetSize(row: Record<string, unknown>): number {
  const netComponents = Array.isArray(row.netComponents)
    ? row.netComponents
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim())
    : [];

  if (netComponents.length > 0) {
    return netComponents.length;
  }

  const filterValue = typeof row.filterValue === 'string' ? row.filterValue.trim() : '';
  if (!filterValue) return 0;

  return filterValue
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .length;
}

function resolveStatRangeExpression(
  row: Record<string, unknown>,
  variable: string,
  tableRows: Array<Record<string, unknown>>,
  tableType: string,
  variableStatDomains: Map<string, VariableStatDomain>,
): string {
  const rowDomain = inferDomainFromExplicitRowRange(row);
  if (rowDomain) {
    return `(${rowDomain.min}-${rowDomain.max})`;
  }

  const localDomain = inferVariableDomainFromRows(tableRows, variable);
  if (localDomain) {
    return `(${localDomain.min}-${localDomain.max})`;
  }

  const indexedDomain = variableStatDomains.get(variable);
  if (indexedDomain) {
    return `(${indexedDomain.min}-${indexedDomain.max})`;
  }

  const heuristicDomain = inferHeuristicVariableDomain(variable, tableType);
  if (heuristicDomain) {
    return `(${heuristicDomain.min}-${heuristicDomain.max})`;
  }

  return '';
}

function resolveVariableValueRangeExpression(
  variable: string,
  tableRows: Array<Record<string, unknown>>,
  variableStatDomains: Map<string, VariableStatDomain>,
): string {
  const localDomain = inferVariableDomainFromRows(tableRows, variable);
  if (localDomain) {
    return `(${localDomain.min}-${localDomain.max})`;
  }

  const indexedDomain = variableStatDomains.get(variable);
  if (indexedDomain) {
    return `(${indexedDomain.min}-${indexedDomain.max})`;
  }

  return '';
}

function inferHeuristicVariableDomain(
  variable: string,
  tableType: string,
): VariableStatDomain | null {
  if (tableType === 'mean_rows' && /c\d+$/i.test(variable)) {
    return { min: 0, max: 100 };
  }
  return null;
}

function inferDomainFromExplicitRowRange(
  row: Record<string, unknown>,
): VariableStatDomain | null {
  const explicitBinRange = normalizeBinRange(row.binRange);
  if (explicitBinRange) {
    return explicitBinRange;
  }

  const filterValue = typeof row.filterValue === 'string' ? row.filterValue.trim() : '';
  if (!filterValue) return null;
  return parseNumericRangeToken(filterValue);
}

function buildVariableStatDomainIndex(
  tables: Array<{ rows?: Array<Record<string, unknown>> }>,
): Map<string, VariableStatDomain> {
  const domains = new Map<string, VariableStatDomain>();

  for (const table of tables) {
    const rows = Array.isArray(table.rows) ? table.rows : [];
    const seenVariables = new Set<string>();

    for (const row of rows) {
      const variable = typeof row.variable === 'string' ? row.variable.trim() : '';
      if (!variable || seenVariables.has(variable)) continue;
      seenVariables.add(variable);

      const domain = inferVariableDomainFromRows(rows, variable);
      if (!domain) continue;
      mergeVariableDomain(domains, variable, domain);
    }
  }

  return domains;
}

function inferVariableDomainFromRows(
  rows: Array<Record<string, unknown>>,
  variable: string,
): VariableStatDomain | null {
  let min: number | null = null;
  let max: number | null = null;

  for (const row of rows) {
    const rowVariable = typeof row.variable === 'string' ? row.variable.trim() : '';
    if (rowVariable !== variable) continue;
    if (row.rowKind === 'stat') continue;
    if (Boolean(row.isNet)) continue;
    if (Boolean(row.excludeFromStats)) continue;

    const numericRanges = extractNumericRangesFromRow(row);
    for (const range of numericRanges) {
      min = min === null ? range.min : Math.min(min, range.min);
      max = max === null ? range.max : Math.max(max, range.max);
    }
  }

  if (min === null || max === null) return null;
  return { min, max };
}

function mergeVariableDomain(
  domains: Map<string, VariableStatDomain>,
  variable: string,
  incoming: VariableStatDomain,
): void {
  const existing = domains.get(variable);
  if (!existing) {
    domains.set(variable, incoming);
    return;
  }

  domains.set(variable, {
    min: Math.min(existing.min, incoming.min),
    max: Math.max(existing.max, incoming.max),
  });
}

function extractNumericRangesFromRow(
  row: Record<string, unknown>,
): Array<VariableStatDomain> {
  const explicitBinRange = normalizeBinRange(row.binRange);
  if (explicitBinRange) {
    return [explicitBinRange];
  }

  const filterValue = typeof row.filterValue === 'string' ? row.filterValue.trim() : '';
  if (!filterValue) return [];

  const ranges: Array<VariableStatDomain> = [];
  for (const token of filterValue.split(',')) {
    const parsed = parseNumericRangeToken(token);
    if (parsed) {
      ranges.push(parsed);
    }
  }
  return ranges;
}

function normalizeBinRange(value: unknown): VariableStatDomain | null {
  if (Array.isArray(value) && value.length >= 2) {
    const min = Number(value[0]);
    const max = Number(value[1]);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return { min, max };
    }
  }

  if (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).min === 'number'
    && typeof (value as Record<string, unknown>).max === 'number'
  ) {
    return {
      min: (value as Record<string, number>).min,
      max: (value as Record<string, number>).max,
    };
  }

  return null;
}

function parseNumericRangeToken(token: string): VariableStatDomain | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const rangeMatch = trimmed.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
  if (rangeMatch) {
    const left = Number(rangeMatch[1]);
    const right = Number(rangeMatch[2]);
    if (Number.isFinite(left) && Number.isFinite(right)) {
      return {
        min: Math.min(left, right),
        max: Math.max(left, right),
      };
    }
  }

  const exactMatch = trimmed.match(/^-?\d+$/);
  if (exactMatch) {
    const value = Number(trimmed);
    if (Number.isFinite(value)) {
      return { min: value, max: value };
    }
  }

  return null;
}

function isNotAnsweredRow(row: Record<string, unknown>): boolean {
  return row.rowKind === 'not_answered';
}

function formatReferenceAlignedRow(
  label: string,
  referenceField: string,
  referenceColumn: number | null,
  suffix?: string,
): string {
  const prefix = `${label}^`;
  const spacer = referenceColumn !== null
    ? (referenceColumn > prefix.length ? ' '.repeat(referenceColumn - prefix.length) : ' ')
    : '';
  return suffix ? `${prefix}${spacer}${referenceField}^${suffix}` : `${prefix}${spacer}${referenceField}`;
}

function formatLabelAlignedRow(
  label: string,
  referenceField: string,
  caretColumn: number,
  suffix?: string,
): string {
  const paddedLabel = label.length < caretColumn ? `${label}${' '.repeat(caretColumn - label.length)}` : label;
  return suffix ? `${paddedLabel}^${referenceField}^${suffix}` : `${paddedLabel}^${referenceField}`;
}

function formatHeaderLabel(label: string, indentValue: unknown, leadingSpaces: number | null): string {
  const prefix = leadingSpaces && leadingSpaces > 0 ? ' '.repeat(leadingSpaces) : '';
  return `${prefix}${applyRowIndent(normalizeWinCrossDisplayText(label), indentValue)}`;
}

function mapStatToken(statType: string | undefined, profile: WinCrossPreferenceProfile): string {
  const normalized = (statType ?? '').trim().toLowerCase();
  const map: Record<string, string> = {
    mean: 'SM',
    median: 'SD',
    stddev: 'SV',
    stderr: 'SR',
  };
  const token = map[normalized] ?? 'SM';
  if (profile.statsDictionary[token]) {
    return token;
  }
  return token;
}

function deriveDisplayLabel(
  row: Record<string, unknown>,
  profile: WinCrossPreferenceProfile,
  variable: string,
  notes?: string[],
): string {
  const explicitLabel = typeof row.label === 'string' ? normalizeWinCrossDisplayText(row.label).trim() : '';
  if (explicitLabel.length > 0) {
    return explicitLabel;
  }

  const rowKind = typeof row.rowKind === 'string' ? row.rowKind : '';
  if (rowKind === 'stat') {
    const statType = typeof row.statType === 'string' ? row.statType : undefined;
    const derived = preferredStatLabel(statType, profile);
    notes?.push(`Derived missing stat label as "${derived}".`);
    return derived;
  }

  return variable || 'Row';
}

function preferredStatLabel(statType: string | undefined, profile: WinCrossPreferenceProfile): string {
  const token = mapStatToken(statType, profile);
  const preferred = profile.statsDictionary[token]?.trim();
  if (preferred) return normalizeWinCrossDisplayText(preferred);

  const normalized = (statType ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'median':
      return 'Median';
    case 'stddev':
      return 'Std Dev';
    case 'stderr':
      return 'Std Err';
    case 'mean':
    default:
      return 'Mean';
  }
}

function applyRowIndent(label: string, indentValue: unknown): string {
  const indent = typeof indentValue === 'number' && indentValue > 0 ? Math.floor(indentValue) : 0;
  if (indent <= 0) return label;
  return `${'  '.repeat(indent)}${label}`;
}

function buildFingerprint(
  tableType: string,
  rows: Array<{ rowKind?: string; variable?: string }>,
  headerRows: TableHeaderRow[],
  displaySignature: string[],
  displayTemplateKind: WinCrossTableDisplayTemplateKind,
  optionSignature: string,
  dataFrameRef: string,
  additionalFilter: string,
): TableFingerprint {
  return {
    tableType,
    optionSignature,
    rowKinds: rows.map((row) => row.rowKind ?? ''),
    rowVariables: rows.map((row) => row.variable ?? ''),
    headerSignature: headerRows.map((row) => `${row.rowIndex}|${row.indent}|${row.label}|${row.filterValue}`),
    displayTemplateKind,
    displaySignature,
    dataFrameRef,
    hasAdditionalFilter: additionalFilter.length > 0,
  };
}

function stableFingerprint(value: TableFingerprint): string {
  return JSON.stringify({
    dataFrameRef: value.dataFrameRef,
    displaySignature: value.displaySignature,
    displayTemplateKind: value.displayTemplateKind,
    hasAdditionalFilter: value.hasAdditionalFilter,
    headerSignature: value.headerSignature,
    optionSignature: value.optionSignature,
    rowKinds: value.rowKinds,
    rowVariables: value.rowVariables,
    tableType: value.tableType,
  });
}

function resolveWinCrossTableSemantics(
  table: Record<string, unknown>,
  defaultOptions: string,
  defaultTotalLine: string,
  additionalFilter: string,
): ResolvedWinCrossTableSemantics {
  const explicitSemantic = readWinCrossDenominatorSemantic(table.wincrossDenominatorSemantic);
  const fallbackSemantic = classifyDenominatorSemanticFromTableKind(
    typeof table.tableKind === 'string' ? table.tableKind : '',
  );
  let semantic = explicitSemantic ?? fallbackSemantic;
  const qualifiedCodes = readStringArray(table.wincrossQualifiedCodes);
  const filteredTotalExpr = (
    typeof table.wincrossFilteredTotalExpr === 'string' && table.wincrossFilteredTotalExpr.trim().length > 0
      ? table.wincrossFilteredTotalExpr.trim()
      : (additionalFilter.trim().length > 0 ? additionalFilter.trim() : null)
  );

  if (filteredTotalExpr) {
    semantic = 'filtered_sample';
  } else if (semantic === 'qualified_respondents' && qualifiedCodes.length === 0) {
    semantic = 'sample_base';
  }

  const optionSignature = semantic === 'qualified_respondents' && qualifiedCodes.length > 0
    ? appendPoOption(defaultOptions, qualifiedCodes)
    : defaultOptions;

  if (semantic === 'sample_base') {
    return {
      semantic,
      optionSignature,
      totalLine: 'Total^TN^0',
      qualifiedCodes,
      filteredTotalExpr: null,
    };
  }

  if (semantic === 'answering_base') {
    return {
      semantic,
      optionSignature,
      totalLine: 'Total^TN^1',
      qualifiedCodes,
      filteredTotalExpr: null,
    };
  }

  if (semantic === 'response_level') {
    return {
      semantic,
      optionSignature,
      totalLine: 'Total^TN^2',
      qualifiedCodes,
      filteredTotalExpr: null,
    };
  }

  if (semantic === 'qualified_respondents' && qualifiedCodes.length > 0) {
    return {
      semantic,
      optionSignature,
      totalLine: 'Total^TN^1',
      qualifiedCodes,
      filteredTotalExpr: null,
    };
  }

  if (semantic === 'filtered_sample' && filteredTotalExpr) {
    return {
      semantic,
      optionSignature,
      totalLine: `Total^${filteredTotalExpr}^0`,
      qualifiedCodes,
      filteredTotalExpr,
    };
  }

  return {
    semantic: null,
    optionSignature: defaultOptions,
    totalLine: defaultTotalLine,
    qualifiedCodes: [],
    filteredTotalExpr: null,
  };
}

function readWinCrossDenominatorSemantic(value: unknown): WinCrossDenominatorSemantic | null {
  switch (value) {
    case 'answering_base':
    case 'sample_base':
    case 'qualified_respondents':
    case 'filtered_sample':
    case 'response_level':
      return value;
    default:
      return null;
  }
}

function classifyDenominatorSemanticFromTableKind(tableKind: string): WinCrossDenominatorSemantic | null {
  if (!tableKind) return null;

  if (
    tableKind === 'scale_overview_rollup_t2b'
    || tableKind === 'scale_overview_rollup_middle'
    || tableKind === 'scale_overview_rollup_b2b'
    || tableKind === 'scale_overview_rollup_nps'
    || tableKind === 'scale_overview_rollup_combined'
    || tableKind === 'scale_overview_rollup_mean'
    || tableKind === 'numeric_overview_mean'
    || tableKind === 'ranking_overview_rank'
    || tableKind === 'ranking_overview_topk'
    || tableKind === 'allocation_overview'
    || tableKind === 'scale_dimension_compare'
    || tableKind === 'maxdiff_api'
    || tableKind === 'maxdiff_ap'
    || tableKind === 'maxdiff_sharpref'
  ) {
    return 'sample_base';
  }

  if (
    tableKind === 'standard_overview'
    || tableKind === 'standard_item_detail'
    || tableKind === 'standard_cluster_detail'
    || tableKind === 'grid_row_detail'
    || tableKind === 'grid_col_detail'
    || tableKind === 'numeric_item_detail'
    || tableKind === 'numeric_per_value_detail'
    || tableKind === 'numeric_optimized_bin_detail'
    || tableKind === 'scale_overview_full'
    || tableKind === 'scale_item_detail_full'
    || tableKind === 'allocation_item_detail'
    || tableKind === 'ranking_item_rank'
  ) {
    return 'answering_base';
  }

  return null;
}

function appendPoOption(optionSignature: string, qualifiedCodes: string[]): string {
  const poToken = `PO(${formatQualifiedCodesForPo(qualifiedCodes)})`;
  if (!poToken.includes('(') || qualifiedCodes.length === 0) return optionSignature;

  const cleaned = optionSignature
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !/^PO\(/i.test(token));

  cleaned.push(poToken);
  return cleaned.join(',');
}

function formatQualifiedCodesForPo(codes: string[]): string {
  const uniqueCodes = Array.from(new Set(codes.map((code) => code.trim()).filter((code) => code.length > 0)));
  if (uniqueCodes.length === 0) return '';

  const numericCodes = uniqueCodes
    .map((code) => {
      const parsed = Number.parseFloat(code);
      return Number.isFinite(parsed) ? parsed : null;
    });

  if (numericCodes.some((value) => value === null)) {
    return uniqueCodes.join(',');
  }

  const sortedNumeric = (numericCodes as number[]).slice().sort((a, b) => a - b);
  const ranges: string[] = [];
  let rangeStart = sortedNumeric[0];
  let previous = sortedNumeric[0];

  for (let index = 1; index < sortedNumeric.length; index += 1) {
    const current = sortedNumeric[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push(rangeStart === previous ? String(rangeStart) : `${rangeStart}-${previous}`);
    rangeStart = current;
    previous = current;
  }

  ranges.push(rangeStart === previous ? String(rangeStart) : `${rangeStart}-${previous}`);
  return ranges.join(',');
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function classifyTableTemplate(rows: Array<Record<string, unknown>>): WinCrossTableTemplateKind {
  if (rows.length === 0) return 'empty';

  let statCount = 0;
  let valueCount = 0;
  let netCount = 0;
  let labelOnlyCount = 0;
  const statVariables = new Set<string>();

  for (const row of rows) {
    const rowKind = typeof row.rowKind === 'string' ? row.rowKind : '';
    const variable = typeof row.variable === 'string' ? row.variable.trim() : '';

    if (Boolean(row.isNet)) {
      netCount += 1;
    }

    if (rowKind === 'stat') {
      statCount += 1;
      if (variable) statVariables.add(variable);
      continue;
    }

    valueCount += 1;
    if (!variable) {
      labelOnlyCount += 1;
    }
  }

  if (labelOnlyCount > 0) return 'label_only_fallback';
  if (statCount > 0 && valueCount > 0) return 'mixed_value_and_stats';
  if (statCount > 0) {
    return statVariables.size <= 1
      ? 'stat_rows_only_single_variable'
      : 'stat_rows_only_multi_variable';
  }
  if (netCount > 0) return 'value_rows_with_nets';
  return 'value_rows_only';
}

function classifyTableDisplayTemplate(
  bodyRows: Array<Record<string, unknown>>,
  headerRows: TableHeaderRow[],
): TableDisplayTemplate {
  const indentedBodyRowCount = bodyRows.filter((row) => (
    typeof row.indent === 'number' && Number.isFinite(row.indent) && row.indent > 0
  )).length;

  if (bodyRows.length === 0 && headerRows.length === 0) {
    return {
      kind: 'empty',
      headerRowCount: 0,
      indentedBodyRowCount: 0,
    };
  }

  if (headerRows.length === 0) {
    return {
      kind: indentedBodyRowCount > 0 ? 'indented_rows' : 'plain_rows',
      headerRowCount: 0,
      indentedBodyRowCount,
    };
  }

  const hasInterleavedHeaders = headerRows.some((row) => row.rowIndex > 0 && row.rowIndex < bodyRows.length);
  const hasTrailingHeaders = headerRows.some((row) => row.rowIndex >= bodyRows.length);
  const kind = hasTrailingHeaders && !hasInterleavedHeaders && headerRows.every((row) => row.rowIndex >= bodyRows.length)
    ? 'trailing_header_rows'
    : hasInterleavedHeaders || hasTrailingHeaders
      ? 'sectioned_header_rows'
      : 'leading_header_rows';

  return {
    kind,
    headerRowCount: headerRows.length,
    indentedBodyRowCount,
  };
}

function buildTableDisplaySignature(
  bodyRows: Array<Record<string, unknown>>,
  headerRows: TableHeaderRow[],
  profile: WinCrossPreferenceProfile,
): string[] {
  const signature: string[] = [];
  const headersByIndex = new Map<number, TableHeaderRow[]>();

  for (const headerRow of headerRows) {
    const bucket = headersByIndex.get(headerRow.rowIndex) ?? [];
    bucket.push(headerRow);
    headersByIndex.set(headerRow.rowIndex, bucket);
  }

  for (let rowIndex = 0; rowIndex < bodyRows.length; rowIndex += 1) {
    for (const headerRow of headersByIndex.get(rowIndex) ?? []) {
      signature.push(`header|${rowIndex}|${headerRow.indent}|${headerRow.label}|${headerRow.filterValue}`);
    }

    const row = bodyRows[rowIndex] as Record<string, unknown>;
    const variable = typeof row.variable === 'string' ? row.variable.trim() : '';
    const label = deriveDisplayLabel(row, profile, variable);
    const formattedLabel = applyRowIndent(label, row.indent);
    const rowKind = typeof row.rowKind === 'string' ? row.rowKind : '';
    const filterValue = typeof row.filterValue === 'string' ? row.filterValue.trim() : '';
    const statType = typeof row.statType === 'string' ? row.statType.trim() : '';
    const netComponents = Array.isArray(row.netComponents) ? row.netComponents.join(',') : '';
    signature.push(
      `body|${rowKind}|${formattedLabel}|${filterValue}|${statType}|${Boolean(row.isNet)}|${netComponents}`,
    );
  }

  const trailingHeaders = [...headersByIndex.entries()]
    .filter(([rowIndex]) => rowIndex >= bodyRows.length)
    .sort(([left], [right]) => left - right)
    .flatMap(([, rows]) => rows);
  for (const headerRow of trailingHeaders) {
    signature.push(`header|${headerRow.rowIndex}|${headerRow.indent}|${headerRow.label}|${headerRow.filterValue}`);
  }

  return signature;
}

function deriveTableStyleHintApplication(
  profile: WinCrossPreferenceProfile,
  bodyRows: Array<Record<string, unknown>>,
  headerRows: TableHeaderRow[],
  tableDisplayTemplate: TableDisplayTemplate,
): TableStyleHintApplication {
  const applied: string[] = [];
  const skipped: string[] = [];
  const unsafe: string[] = [];
  const formattingHints: TableRowFormattingHints = {
    valueReferenceColumn: null,
    statLabelCaretColumn: null,
    netRowSuffixToken: null,
    headerLeadingSpaces: null,
  };
  const sourceHints = profile.tableStyleHints;

  const hasReferenceAlignedRows = bodyRows.some((row) => {
    if (Boolean(row.isNet)) return true;
    const variable = typeof row.variable === 'string' ? row.variable.trim() : '';
    return variable.length > 0;
  });
  if (sourceHints.valueReferenceColumn !== null) {
    if (hasReferenceAlignedRows) {
      const currentReferenceColumn = deriveCurrentValueReferenceColumn(bodyRows, profile);
      formattingHints.valueReferenceColumn = currentReferenceColumn !== null
        ? Math.max(sourceHints.valueReferenceColumn, currentReferenceColumn)
        : sourceHints.valueReferenceColumn;
      applied.push(`value-row reference column ${formattingHints.valueReferenceColumn}`);
    } else {
      skipped.push('value-row reference alignment was available but the current-run table had no compatible row references');
    }
  }

  if (sourceHints.statLabelCaretColumn !== null) {
    if (hasSingleStatVariable(bodyRows)) {
      formattingHints.statLabelCaretColumn = sourceHints.statLabelCaretColumn;
      applied.push(`single-variable stat label caret column ${sourceHints.statLabelCaretColumn}`);
    } else if (bodyRows.some((row) => row.rowKind === 'stat')) {
      skipped.push('single-variable stat label alignment was available but the current-run table used multi-variable or mixed stat rows');
    }
  }

  if (sourceHints.netRowSuffixToken) {
    if (bodyRows.some((row) => Boolean(row.isNet))) {
      formattingHints.netRowSuffixToken = sourceHints.netRowSuffixToken;
      applied.push(`net-row suffix token ${sourceHints.netRowSuffixToken}`);
    } else {
      skipped.push('net-row suffix token was available but the current-run table had no net rows');
    }
  }

  switch (sourceHints.headerRowPattern) {
    case 'none':
      break;
    case 'mixed_or_unsafe':
      unsafe.push('source header-row placement varied across uploaded tables');
      break;
    case 'leading_label_only':
      if (tableDisplayTemplate.kind === 'leading_header_rows') {
        applied.push('leading label-only header-row placement');
        if (sourceHints.headerLeadingSpaces !== null) {
          formattingHints.headerLeadingSpaces = sourceHints.headerLeadingSpaces;
          applied.push(`header leading spaces ${sourceHints.headerLeadingSpaces}`);
        }
      } else if (headerRows.length > 0) {
        skipped.push(`source header-row placement preferred leading rows, but current-run layout was ${tableDisplayTemplate.kind}`);
      } else {
        skipped.push('source header-row placement was available but the current-run table had no header rows');
      }
      break;
    case 'sectioned_label_only':
      if (tableDisplayTemplate.kind === 'sectioned_header_rows') {
        applied.push('sectioned label-only header-row placement');
        if (sourceHints.headerLeadingSpaces !== null) {
          formattingHints.headerLeadingSpaces = sourceHints.headerLeadingSpaces;
          applied.push(`header leading spaces ${sourceHints.headerLeadingSpaces}`);
        }
      } else if (headerRows.length > 0) {
        skipped.push(`source header-row placement preferred sectioned rows, but current-run layout was ${tableDisplayTemplate.kind}`);
      } else {
        skipped.push('source header-row placement was available but the current-run table had no header rows');
      }
      break;
    case 'trailing_label_only':
      if (tableDisplayTemplate.kind === 'trailing_header_rows') {
        applied.push('trailing label-only header-row placement');
        if (sourceHints.headerLeadingSpaces !== null) {
          formattingHints.headerLeadingSpaces = sourceHints.headerLeadingSpaces;
          applied.push(`header leading spaces ${sourceHints.headerLeadingSpaces}`);
        }
      } else if (headerRows.length > 0) {
        skipped.push(`source header-row placement preferred trailing rows, but current-run layout was ${tableDisplayTemplate.kind}`);
      } else {
        skipped.push('source header-row placement was available but the current-run table had no header rows');
      }
      break;
  }

  return {
    formattingHints,
    applied,
    skipped,
    unsafe,
  };
}

function deriveCurrentValueReferenceColumn(
  bodyRows: Array<Record<string, unknown>>,
  profile: WinCrossPreferenceProfile,
): number | null {
  let maxPrefixLength: number | null = null;

  for (const row of bodyRows) {
    const variable = typeof row.variable === 'string' ? row.variable.trim() : '';
    const participatesInReferenceAlignment = Boolean(row.isNet)
      || isNotAnsweredRow(row)
      || variable.length > 0;

    if (!participatesInReferenceAlignment) continue;

    const label = deriveDisplayLabel(row, profile, variable);
    const formattedLabel = applyRowIndent(label, row.indent);
    const prefixLength = `${formattedLabel}^`.length;
    maxPrefixLength = maxPrefixLength === null
      ? prefixLength
      : Math.max(maxPrefixLength, prefixLength);
  }

  return maxPrefixLength === null ? null : maxPrefixLength + 1;
}

function hasSingleStatVariable(rows: Array<Record<string, unknown>>): boolean {
  const statVariables = new Set<string>();
  let statCount = 0;

  for (const row of rows) {
    if (row.rowKind !== 'stat') continue;
    statCount += 1;
    const variable = typeof row.variable === 'string' ? row.variable.trim() : '';
    if (!variable) return false;
    statVariables.add(variable);
  }

  return statCount > 0 && statVariables.size === 1;
}

function normalizeTableDisplay(table: Record<string, unknown>): NormalizedTableDisplay {
  const originalRows = Array.isArray(table.rows)
    ? table.rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    : [];
  const bodyRows: Array<Record<string, unknown>> = [];
  const derivedHeaderRows: TableHeaderRow[] = [];

  for (const row of originalRows) {
    if (isTableHeaderSourceRow(row)) {
      const label = typeof row.label === 'string' ? row.label.trim() : '';
      if (label) {
        derivedHeaderRows.push({
          rowIndex: bodyRows.length,
          label,
          filterValue: typeof row.filterValue === 'string' ? row.filterValue.trim() : '',
          indent: typeof row.indent === 'number' && Number.isFinite(row.indent) ? row.indent : 0,
        });
      }
      continue;
    }
    bodyRows.push(row);
  }

  const explicitHeaderRows = extractExplicitTableHeaderRows(table, originalRows);
  return {
    bodyRows,
    headerRows: explicitHeaderRows.length > 0 ? explicitHeaderRows : derivedHeaderRows,
  };
}

function extractExplicitTableHeaderRows(
  table: Record<string, unknown>,
  originalRows: Array<Record<string, unknown>>,
): TableHeaderRow[] {
  const rawHeaderRows = table.headerRows;
  if (!Array.isArray(rawHeaderRows)) {
    return [];
  }

  return rawHeaderRows
    .map((candidate) => {
      if (!candidate || typeof candidate !== 'object') {
        return null;
      }
      const row = candidate as Record<string, unknown>;
      const label = typeof row.label === 'string' ? row.label.trim() : '';
      if (!label) return null;
      return {
        rowIndex: remapHeaderRowIndex(
          typeof row.rowIndex === 'number' && Number.isFinite(row.rowIndex) ? row.rowIndex : 0,
          originalRows,
        ),
        label,
        filterValue: typeof row.filterValue === 'string' ? row.filterValue.trim() : '',
        indent: typeof row.indent === 'number' && Number.isFinite(row.indent) ? row.indent : 0,
      } satisfies TableHeaderRow;
    })
    .filter((row): row is TableHeaderRow => row !== null)
    .sort((a, b) => a.rowIndex - b.rowIndex);
}

function isTableHeaderSourceRow(row: Record<string, unknown>): boolean {
  const variable = typeof row.variable === 'string' ? row.variable.trim() : '';
  const filterValue = typeof row.filterValue === 'string' ? row.filterValue.trim() : '';
  return variable === '_CAT_' || filterValue === '_HEADER_';
}

function remapHeaderRowIndex(rowIndex: number, originalRows: Array<Record<string, unknown>>): number {
  if (rowIndex <= 0) return 0;

  let bodyCount = 0;
  for (let index = 0; index < Math.min(rowIndex, originalRows.length); index += 1) {
    if (!isTableHeaderSourceRow(originalRows[index] ?? {})) {
      bodyCount += 1;
    }
  }
  return bodyCount;
}

function headerRowsMatch(anchor: TableHeaderRow[], candidate: TableHeaderRow[]): boolean {
  if (anchor.length !== candidate.length) return false;

  for (let index = 0; index < anchor.length; index += 1) {
    const left = anchor[index];
    const right = candidate[index];
    if (!left || !right) return false;
    if (left.rowIndex !== right.rowIndex) return false;
    if (left.indent !== right.indent) return false;
    if (left.label !== right.label) return false;
    if (left.filterValue !== right.filterValue) return false;
  }

  return true;
}

function deriveUseLineFromAnchors(
  anchors: UseAnchor[],
  table: {
    tableType: string;
    rows: Array<Record<string, unknown>>;
    headerRows?: TableHeaderRow[];
  },
  profile: WinCrossPreferenceProfile,
  variableStatDomains: Map<string, VariableStatDomain>,
  optionSignature: string,
  dataFrameRef: string,
  additionalFilter: string,
): string | null {
  const normalizedTable = normalizeTableDisplay(table as Record<string, unknown>);
  const candidateHeaderRows = table.headerRows ?? normalizedTable.headerRows;
  const candidateDisplayTemplate = classifyTableDisplayTemplate(table.rows, candidateHeaderRows);
  for (const anchor of anchors) {
    if (anchor.tableType !== table.tableType) continue;
    if (anchor.dataFrameRef !== dataFrameRef) continue;
    if (anchor.optionSignature !== optionSignature) continue;
    if (anchor.additionalFilter !== additionalFilter) continue;
    if (anchor.displayTemplateKind !== candidateDisplayTemplate.kind) continue;
    if (!headerRowsMatch(anchor.headerRows, candidateHeaderRows)) continue;

    const substitutions = deriveRowVariableSubstitutions(
      anchor.rows,
      table.rows,
      table.tableType,
      profile,
      variableStatDomains,
    );
    if (!substitutions) continue;

    if (substitutions.length === 0) {
      return `USE=${anchor.ordinal}`;
    }
    return `USE=${anchor.ordinal},${substitutions.join(',')}`;
  }

  return null;
}

function deriveRowVariableSubstitutions(
  anchorRows: Array<Record<string, unknown>>,
  candidateRows: Array<Record<string, unknown>>,
  tableType: string,
  profile: WinCrossPreferenceProfile,
  variableStatDomains: Map<string, VariableStatDomain>,
): string[] | null {
  if (anchorRows.length !== candidateRows.length) return null;

  const substitutions: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < anchorRows.length; index += 1) {
    const anchorRow = anchorRows[index];
    const candidateRow = candidateRows[index];

    const anchorKind = typeof anchorRow.rowKind === 'string' ? anchorRow.rowKind : '';
    const candidateKind = typeof candidateRow.rowKind === 'string' ? candidateRow.rowKind : '';
    if (anchorKind !== candidateKind) return null;

    const anchorLabel = typeof anchorRow.label === 'string' ? anchorRow.label.trim() : '';
    const candidateLabel = typeof candidateRow.label === 'string' ? candidateRow.label.trim() : '';
    const anchorVariable = typeof anchorRow.variable === 'string' ? anchorRow.variable.trim() : '';
    const candidateVariable = typeof candidateRow.variable === 'string' ? candidateRow.variable.trim() : '';
    const anchorDisplayLabel = applyRowIndent(
      deriveDisplayLabel(anchorRow, profile, anchorVariable),
      anchorRow.indent,
    );
    const candidateDisplayLabel = applyRowIndent(
      deriveDisplayLabel(candidateRow, profile, candidateVariable),
      candidateRow.indent,
    );
    if (anchorLabel !== candidateLabel && anchorDisplayLabel !== candidateDisplayLabel) return null;

    const anchorFilter = typeof anchorRow.filterValue === 'string' ? anchorRow.filterValue.trim() : '';
    const candidateFilter = typeof candidateRow.filterValue === 'string' ? candidateRow.filterValue.trim() : '';
    if (anchorFilter !== candidateFilter) return null;

    const anchorIndent = typeof anchorRow.indent === 'number' && Number.isFinite(anchorRow.indent)
      ? anchorRow.indent
      : 0;
    const candidateIndent = typeof candidateRow.indent === 'number' && Number.isFinite(candidateRow.indent)
      ? candidateRow.indent
      : 0;
    if (anchorIndent !== candidateIndent) return null;

    const anchorNet = Array.isArray(anchorRow.netComponents) ? anchorRow.netComponents.join(',') : '';
    const candidateNet = Array.isArray(candidateRow.netComponents) ? candidateRow.netComponents.join(',') : '';
    if (Boolean(anchorRow.isNet) !== Boolean(candidateRow.isNet)) return null;
    if (anchorNet !== candidateNet) return null;

    const anchorLogic = deriveReuseLogicSignature(anchorRow, anchorRows, tableType, profile, variableStatDomains);
    const candidateLogic = deriveReuseLogicSignature(candidateRow, candidateRows, tableType, profile, variableStatDomains);
    if (anchorLogic !== candidateLogic) return null;

    if (!anchorVariable && !candidateVariable) continue;
    if (!anchorVariable || !candidateVariable) return null;
    if (anchorVariable === candidateVariable) continue;

    const substitution = `${anchorVariable}=${candidateVariable}`;
    if (!seen.has(substitution)) {
      substitutions.push(substitution);
      seen.add(substitution);
    }
  }

  return substitutions;
}

function deriveReuseLogicSignature(
  row: Record<string, unknown>,
  tableRows: Array<Record<string, unknown>>,
  tableType: string,
  profile: WinCrossPreferenceProfile,
  variableStatDomains: Map<string, VariableStatDomain>,
): string {
  if (row.isNet) {
    return `net:${deriveNetSize(row)}`;
  }

  const variable = typeof row.variable === 'string' ? row.variable.trim() : '';
  if (isNotAnsweredRow(row)) {
    return `not:${resolveVariableValueRangeExpression(variable, tableRows, variableStatDomains)}`;
  }

  if (row.rowKind === 'stat' || tableType === 'mean_rows') {
    const statType = typeof row.statType === 'string'
      ? row.statType as string
      : undefined;
    const statToken = mapStatToken(statType, profile);
    const range = variable
      ? resolveStatRangeExpression(row, variable, tableRows, tableType, variableStatDomains)
      : '';
    return `stat:${statToken}:${range}`;
  }

  const filterValue = typeof row.filterValue === 'string' ? row.filterValue.trim() : '';
  return `value:${filterValue}`;
}

function deriveNativeAfLine(rows: Array<Record<string, unknown>>): string | null {
  if (rows.length === 0) return null;

  const variables = new Set<string>();
  for (const row of rows) {
    const rowKind = typeof row.rowKind === 'string' ? row.rowKind : '';
    if (rowKind !== 'stat') return null;
    const variable = typeof row.variable === 'string' ? row.variable.trim() : '';
    if (!variable) return null;
    variables.add(variable);
  }

  if (variables.size !== 1) return null;
  const [variable] = [...variables];
  return `AF=${variable}^  ^OA`;
}

function resolveNativeAfDecision(
  rows: Array<Record<string, unknown>>,
  additionalFilter: string,
  idxFilter: string | null,
  tableTemplateKind: WinCrossTableTemplateKind,
): NativeAfDecision {
  const nativeStatOnlyLine = deriveNativeAfLine(rows);
  if (nativeStatOnlyLine) {
    return {
      line: nativeStatOnlyLine,
      emittedRows: rows,
      strategy: 'native_single_variable_stat',
      notes: [],
    };
  }

  if (tableTemplateKind !== 'mixed_value_and_stats') {
    return {
      line: null,
      emittedRows: rows,
      strategy: null,
      notes: [],
    };
  }

  if (idxFilter) {
    return {
      line: null,
      emittedRows: rows,
      strategy: null,
      notes: ['Skipped native AF interim collapse because INDEX filtering was active.'],
    };
  }

  if (additionalFilter.trim().length > 0) {
    return {
      line: null,
      emittedRows: rows,
      strategy: null,
      notes: ['Skipped native AF interim collapse because the table had an additional filter.'],
    };
  }

  const statRows = rows.filter((row) => row.rowKind === 'stat');
  if (statRows.length === 0) {
    return {
      line: null,
      emittedRows: rows,
      strategy: null,
      notes: ['Skipped native AF interim collapse because no stat rows were present.'],
    };
  }

  const variables = new Set<string>();
  for (const row of rows) {
    const variable = typeof row.variable === 'string' ? row.variable.trim() : '';
    if (!variable) {
      return {
        line: null,
        emittedRows: rows,
        strategy: null,
        notes: ['Skipped native AF interim collapse because one or more rows lacked a variable reference.'],
      };
    }
    variables.add(variable);
  }

  if (variables.size !== 1) {
    return {
      line: null,
      emittedRows: rows,
      strategy: null,
      notes: ['Skipped native AF interim collapse because the table mixed multiple variables.'],
    };
  }

  for (const row of rows) {
    const rowKind = typeof row.rowKind === 'string' ? row.rowKind : '';
    if (rowKind === 'stat') continue;
    if (rowKind !== 'value') {
      return {
        line: null,
        emittedRows: rows,
        strategy: null,
        notes: [`Skipped native AF interim collapse because row kind "${rowKind || 'unknown'}" is not a simple value row.`],
      };
    }
    if (Boolean(row.isNet)) {
      return {
        line: null,
        emittedRows: rows,
        strategy: null,
        notes: ['Skipped native AF interim collapse because one or more rows were NET-like.'],
      };
    }
  }

  const [variable] = [...variables];
  return {
    line: `AF=${variable}^  ^OA`,
    emittedRows: statRows,
    strategy: 'native_single_variable_stat_with_interim_values',
    notes: ['Collapsed simple interim value stubs into a native AF stat block for portability.'],
  };
}

function buildFrameOrder(
  tables: Array<{ tableId: string }>,
  tableToFrame: Record<string, string>,
): string[] {
  const seen = new Set<string>();
  const frames: string[] = [];

  // Wide first, then order of appearance, then alphabetical for ties
  for (const table of tables) {
    const frame = tableToFrame[table.tableId] ?? 'wide';
    if (!seen.has(frame)) {
      seen.add(frame);
      frames.push(frame);
    }
  }

  // Sort: 'wide' first, then alphabetically
  frames.sort((a, b) => {
    if (a === 'wide') return -1;
    if (b === 'wide') return 1;
    return a.localeCompare(b);
  });

  return frames;
}

function buildPreferenceLines(
  profile: WinCrossPreferenceProfile,
  defaultOptions: string,
  defaultTotalLine: string,
): string[] {
  if (profile.preferenceLines.length > 0) {
    return [...profile.preferenceLines];
  }

  const lines: string[] = [];
  lines.push(profile.numericPreferenceVector ?? '0,0,0,0,0');

  const tokenAssignments = Object.entries(profile.tokenDictionary)
    .map(([key, value]) => `${key}=${value}`);
  if (tokenAssignments.length > 0) {
    lines.push(tokenAssignments.join(','));
  }

  const statLabels = ['SM', 'SD', 'SV', 'SR', 'N', 'GM']
    .map((token) => profile.statsDictionary[token])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (statLabels.length > 0) {
    lines.push(statLabels.join(','));
  }

  lines.push(defaultOptions);
  lines.push(defaultTotalLine);

  return lines;
}

function buildBannerStyle(
  profile: WinCrossPreferenceProfile,
  bannerCuts: Array<{ groupName: string; columns: Array<{ name: string }> }>,
): BannerStyleResult {
  const rawLayoutLines = profile.bannerLayoutLines.length > 0
    ? profile.bannerLayoutLines
    : [];
  const runtimeColumnCount = 1 + bannerCuts.reduce((total, group) => total + group.columns.length, 0);

  const headerLine = rawLayoutLines.find((line) => line.trim().startsWith('*')) ?? '*Banner1';
  const preservedDirectiveMap = new Map<string, string>();
  const extraDirectiveLines: string[] = [];
  for (const line of rawLayoutLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('*')) continue;
    const prefixMatch = trimmed.match(/^([A-Z]{2,3})\s*:/);
    if (!prefixMatch) {
      extraDirectiveLines.push(line);
      continue;
    }
    preservedDirectiveMap.set(prefixMatch[1], line);
  }

  const directiveLines = [
    preservedDirectiveMap.get('ID') ?? ' ID:1',
    buildRepeatedPairDirective('SW', runtimeColumnCount, preservedDirectiveMap.get('SW'), ['1', '15']),
    buildRepeatedSingleDirective('HP', runtimeColumnCount, preservedDirectiveMap.get('HP'), '1'),
    preservedDirectiveMap.get('CP') ?? ' CP:0,0',
    buildSignificanceLabelDirective(runtimeColumnCount),
    buildStatTestingDirective(bannerCuts, preservedDirectiveMap.get('ST')),
    preservedDirectiveMap.get('WT') ?? ' WT:',
    preservedDirectiveMap.get('OP') ?? ' OP:1,SB,FL,HD,W200',
    preservedDirectiveMap.get('BT') ?? ' BT:',
    preservedDirectiveMap.get('BF') ?? ' BF:',
    preservedDirectiveMap.get('XL') ?? ' XL:',
    buildPointsDirective(runtimeColumnCount, preservedDirectiveMap.get('PT')),
    ...extraDirectiveLines,
  ].filter((line): line is string => typeof line === 'string' && line.trim().length > 0);

  const displayTemplate = parseBannerDisplayTemplate(profile.bannerDisplayLines);
  const displayLines = buildGeneratedBannerDisplayLines(bannerCuts, directiveLines, displayTemplate);

  return {
    headerLine,
    directiveLines,
    memberSuffix: inferBannerMemberSuffix(profile.bannerMemberLines.length > 0 ? profile.bannerMemberLines : profile.bannerLines),
    memberPrefix: inferBannerMemberPrefix(profile.bannerMemberLines.length > 0 ? profile.bannerMemberLines : profile.bannerLines),
    displayLines,
    diagnostics: buildBannerApplicationDiagnostics(displayTemplate, displayLines),
  };
}

function inferBannerMemberSuffix(lines: string[]): string | null {
  const suffixCounts = new Map<string, number>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(/\^([A-Za-z0-9]+)\s*$/);
    if (!match) continue;

    const suffix = match[1];
    suffixCounts.set(suffix, (suffixCounts.get(suffix) ?? 0) + 1);
  }

  let bestSuffix: string | null = null;
  let bestCount = 0;
  for (const [suffix, count] of suffixCounts.entries()) {
    if (count > bestCount) {
      bestSuffix = suffix;
      bestCount = count;
    }
  }

  return bestSuffix;
}

function inferBannerMemberPrefix(lines: string[]): string {
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('*') || trimmed.includes(':')) continue;
    const match = rawLine.match(/^(\s*)/);
    if (match) {
      return match[1] ?? '';
    }
  }
  return ' ';
}

function formatBannerMemberLine(logic: string, memberSuffix: string | null, memberPrefix = ''): string {
  if (memberSuffix) {
    return `${memberPrefix}${logic}^${memberSuffix}`;
  }
  return `${memberPrefix}${logic}`;
}

function formatBannerLabelOnlyLine(label: string, memberSuffix: string | null, memberPrefix = ''): string {
  const normalizedLabel = normalizeWinCrossDisplayText(label);
  if (memberSuffix) {
    return `${memberPrefix}${normalizedLabel}^${memberSuffix}`;
  }
  return `${memberPrefix}${normalizedLabel}`;
}

function formatBannerTotalLine(memberSuffix: string | null, memberPrefix = ''): string {
  if (memberSuffix) {
    return `${memberPrefix}TN^${memberSuffix}`;
  }
  return `${memberPrefix}TN`;
}

function translateBannerExpressionToWinCross(expression: string): string | null {
  const parsed = parseExpression(expression);
  if (!parsed.ok || !parsed.parsed) {
    return null;
  }

  return translateBannerExpressionNode(parsed.parsed.ast);
}

function translateBannerExpressionNode(node: ExpressionNode): string | null {
  if (node.type === 'identifier') {
    return node.name;
  }

  if (node.type === 'unary' && node.operator === '!') {
    const inner = translateBannerExpressionNode(node.argument);
    if (!inner) return null;
    if (isAtomicBannerLogicNode(node.argument)) {
      return `?${inner}`;
    }
    return `?{${inner}}`;
  }

  if (node.type !== 'binary') {
    return null;
  }

  if (node.operator === '|' || node.operator === '&') {
    const left = translateBannerExpressionNode(node.left);
    const right = translateBannerExpressionNode(node.right);
    if (!left || !right) return null;
    const connector = node.operator === '|' ? ' OR ' : ' AND ';
    return `${left}${connector}${right}`;
  }

  if (node.operator === '==' || node.operator === '!=') {
    const equality = translateBannerEqualityNode(node.left, node.right);
    if (!equality) return null;

    if (node.operator === '==') {
      return equality;
    }

    if (isAtomicBannerLogicNode(node)) {
      return `?${equality}`;
    }
    return `?{${equality}}`;
  }

  if (node.operator === '%in%') {
    return translateBannerInNode(node.left, node.right);
  }

  return null;
}

function translateBannerEqualityNode(left: ExpressionNode, right: ExpressionNode): string | null {
  const identifier = left.type === 'identifier'
    ? left
    : right.type === 'identifier'
      ? right
      : null;
  const literal = identifier === left ? right : left;

  if (!identifier) return null;

  if (literal.type === 'number') {
    if (literal.value === '0') {
      return `?${identifier.name} (1)`;
    }
    return `${identifier.name} (${literal.value})`;
  }

  if (literal.type === 'boolean') {
    return literal.value ? `${identifier.name} (1)` : `?${identifier.name} (1)`;
  }

  if (literal.type === 'string') {
    return `${identifier.name} (${literal.value})`;
  }

  return null;
}

function translateBannerInNode(left: ExpressionNode, right: ExpressionNode): string | null {
  if (left.type !== 'identifier' || right.type !== 'call' || right.callee.toLowerCase() !== 'c') {
    return null;
  }

  const values = right.args.map(extractBannerLiteralValue);
  if (values.some((value) => value === null)) {
    return null;
  }

  const rendered = collapseBannerValues(values as string[]);
  if (rendered.length === 0) {
    return null;
  }

  return `${left.name} (${rendered})`;
}

function extractBannerLiteralValue(node: ExpressionNode): string | null {
  if (node.type === 'number' || node.type === 'string') {
    return node.value;
  }
  if (node.type === 'boolean') {
    return node.value ? '1' : '0';
  }
  return null;
}

function collapseBannerValues(values: string[]): string {
  const numericValues = values.every((value) => /^-?\d+$/.test(value))
    ? values.map((value) => Number.parseInt(value, 10))
    : null;

  if (!numericValues) {
    return values.join(',');
  }

  const uniqueSorted = Array.from(new Set(numericValues)).sort((a, b) => a - b);
  return collapseNumericValues(uniqueSorted);
}

function collapseNumericValues(values: number[]): string {
  if (values.length === 0) {
    return '';
  }

  const uniqueSorted = Array.from(new Set(values)).sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = uniqueSorted[0];
  let previous = uniqueSorted[0];

  for (let index = 1; index <= uniqueSorted.length; index += 1) {
    const current = uniqueSorted[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }

    ranges.push(start === previous ? String(start) : `${start}-${previous}`);
    start = current;
    previous = current;
  }

  return ranges.join(',');
}

function isAtomicBannerLogicNode(node: ExpressionNode): boolean {
  if (node.type === 'identifier') return true;
  if (node.type === 'binary') {
    if (node.operator === '==' || node.operator === '!=') return true;
    if (node.operator === '%in%') return true;
  }
  return false;
}

function buildRepeatedPairDirective(
  prefix: string,
  count: number,
  sourceLine: string | undefined,
  fallbackPair: [string, string],
): string {
  const sourceValues = parseDirectiveValues(sourceLine);
  const pair = sourceValues.length >= 2
    ? [sourceValues[0], sourceValues[1]]
    : fallbackPair;
  const values: string[] = [];
  for (let index = 0; index < count; index += 1) {
    values.push(pair[0], pair[1]);
  }
  return ` ${prefix}:${values.join(',')}`;
}

function buildRepeatedSingleDirective(
  prefix: string,
  count: number,
  sourceLine: string | undefined,
  fallbackValue: string,
): string {
  const sourceValues = parseDirectiveValues(sourceLine);
  const value = sourceValues[0] ?? fallbackValue;
  return ` ${prefix}:${Array.from({ length: count }, () => value).join(',')}`;
}

function buildSignificanceLabelDirective(count: number): string {
  const labels = Array.from({ length: count }, (_, index) => toAlphaLabel(index));
  return ` SL:${labels.join(',')}`;
}

function buildStatTestingDirective(
  bannerCuts: Array<{ columns: Array<{ name: string }> }>,
  sourceLine: string | undefined,
): string | null {
  const comparisonGroups: string[] = [];
  let columnIndex = 1;
  for (const group of bannerCuts) {
    if (group.columns.length >= 2) {
      const members = Array.from({ length: group.columns.length }, (_, offset) => String(columnIndex + offset));
      comparisonGroups.push(members.join(','));
    }
    columnIndex += group.columns.length;
  }

  if (comparisonGroups.length === 0) {
    return null;
  }

  const suffix = extractDirectiveSuffix(sourceLine);
  return ` ST:${comparisonGroups.join('/')}${suffix}`;
}

function buildPointsDirective(count: number, sourceLine: string | undefined): string {
  const sourceValues = parseDirectiveValues(sourceLine);
  const rankingColumn = sourceValues[1] ?? '1';
  return ` PT:${count},${rankingColumn}`;
}

function parseBannerDisplayTemplate(lines: string[]): BannerDisplayTemplate {
  const normalizedLines = lines.filter((line) => line.trim().length > 0);
  if (normalizedLines.length === 0) {
    return {
      kind: 'none',
      sourceLineCount: 0,
      sourceColumnRowLineCount: 0,
    };
  }

  const tokens = normalizedLines.map((line) => isBannerSeparatorLine(line) ? 'S' : 'T');
  const structure = collapseBannerDisplayTokens(tokens);
  const textBlocks = extractBannerTextBlocks(normalizedLines);
  const firstBlockLineCount = textBlocks[0]?.length ?? 0;
  const lastBlockLineCount = textBlocks[textBlocks.length - 1]?.length ?? 0;

  if (structure === 'T' && textBlocks.length === 1) {
    return {
      kind: 'columns_only',
      sourceLineCount: normalizedLines.length,
      sourceColumnRowLineCount: lastBlockLineCount,
    };
  }

  if (structure === 'ST' && textBlocks.length === 1) {
    return {
      kind: 'separator_plus_columns',
      sourceLineCount: normalizedLines.length,
      sourceColumnRowLineCount: lastBlockLineCount,
    };
  }

  if (structure === 'TST' && textBlocks.length === 2 && firstBlockLineCount === 1) {
    return {
      kind: 'group_plus_columns',
      sourceLineCount: normalizedLines.length,
      sourceColumnRowLineCount: lastBlockLineCount,
    };
  }

  if (structure === 'STST' && textBlocks.length === 2 && firstBlockLineCount === 1) {
    return {
      kind: 'separator_group_separator_columns',
      sourceLineCount: normalizedLines.length,
      sourceColumnRowLineCount: lastBlockLineCount,
    };
  }

  return {
    kind: 'unsupported',
    sourceLineCount: normalizedLines.length,
    sourceColumnRowLineCount: lastBlockLineCount,
  };
}

function buildGeneratedBannerDisplayLines(
  bannerCuts: Array<{ groupName: string; columns: Array<{ name: string }> }>,
  directiveLines: string[],
  template: BannerDisplayTemplate,
): string[] {
  if (template.kind === 'none' || template.kind === 'unsupported') {
    return [];
  }

  const widths = deriveBannerDisplayWidths(directiveLines, 1 + bannerCuts.reduce((total, group) => total + group.columns.length, 0));
  const columns = [
    { label: 'Total', groupName: '' },
    ...bannerCuts.flatMap((group) => group.columns.map((column) => ({
      label: normalizeWinCrossDisplayText(column.name).trim() || 'Column',
      groupName: normalizeWinCrossDisplayText(group.groupName).trim(),
    }))),
  ];

  const lines: string[] = [];
  if (template.kind === 'separator_plus_columns' || template.kind === 'separator_group_separator_columns') {
    lines.push(
      template.kind === 'separator_group_separator_columns'
        ? renderBannerGroupedSeparatorRow(widths, columns)
        : renderBannerSeparatorRow(widths),
    );
  }
  if (template.kind === 'group_plus_columns' || template.kind === 'separator_group_separator_columns') {
    lines.push(renderBannerGroupRow(widths, columns));
  }
  if (template.kind === 'group_plus_columns' || template.kind === 'separator_group_separator_columns') {
    lines.push(renderBannerSeparatorRow(widths));
  }
  lines.push(...renderBannerColumnRows(widths, columns));

  return lines;
}

function buildBannerApplicationDiagnostics(
  template: BannerDisplayTemplate,
  displayLines: string[],
): WinCrossBannerApplicationDiagnostics {
  const notes: string[] = [];

  switch (template.kind) {
    case 'none':
      notes.push('No portable source display rows were present; serializer emitted structural banner directives only.');
      return {
        templateKind: template.kind,
        sourceDisplayLineCount: template.sourceLineCount,
        generatedDisplayLineCount: displayLines.length,
        status: 'not_requested',
        notes,
      };
    case 'unsupported':
      notes.push('Banner display rows were not remapped because the uploaded layout was too source-specific to map safely.');
      return {
        templateKind: template.kind,
        sourceDisplayLineCount: template.sourceLineCount,
        generatedDisplayLineCount: displayLines.length,
        status: 'degraded',
        notes,
      };
    default:
      notes.push(`Recognized banner display template: ${template.kind}.`);
      notes.push('Banner display rows were synthesized from current run group and column labels.');
      notes.push('Source display text was not replayed verbatim.');
      return {
        templateKind: template.kind,
        sourceDisplayLineCount: template.sourceLineCount,
        generatedDisplayLineCount: displayLines.length,
        status: 'applied',
        notes,
      };
  }
}

function collapseBannerDisplayTokens(tokens: string[]): string {
  const collapsed: string[] = [];
  for (const token of tokens) {
    if (collapsed[collapsed.length - 1] !== token) {
      collapsed.push(token);
    }
  }
  return collapsed.join('');
}

function extractBannerTextBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (isBannerSeparatorLine(line)) {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) {
    blocks.push(current);
  }

  return blocks;
}

function deriveBannerDisplayWidths(directiveLines: string[], count: number): number[] {
  const swLine = directiveLines.find((line) => line.trim().startsWith('SW:'));
  const values = parseDirectiveValues(swLine);
  const widths: number[] = [];

  for (let index = 1; index < values.length; index += 2) {
    const parsedWidth = Number.parseInt(values[index] ?? '', 10);
    widths.push(Number.isFinite(parsedWidth) && parsedWidth > 0 ? parsedWidth : 15);
  }

  if (widths.length === 0) {
    return Array.from({ length: count }, () => 15);
  }
  if (widths.length >= count) {
    return widths.slice(0, count);
  }

  const lastWidth = widths[widths.length - 1] ?? 15;
  while (widths.length < count) {
    widths.push(lastWidth);
  }

  return widths;
}

function renderBannerSeparatorRow(widths: number[]): string {
  return `  ${widths.map((width) => '.'.repeat(Math.max(width, 1))).join(' ')}`;
}

function renderBannerGroupedSeparatorRow(
  widths: number[],
  columns: Array<{ label: string; groupName: string }>,
): string {
  const cells: string[] = ['.'.repeat(Math.max(widths[0] ?? 15, 1))];
  let columnIndex = 1;

  while (columnIndex < columns.length) {
    const groupName = columns[columnIndex]?.groupName ?? '';
    let spanWidth = 0;
    let spanColumns = 0;
    while (columnIndex + spanColumns < columns.length && columns[columnIndex + spanColumns]?.groupName === groupName) {
      spanWidth += widths[columnIndex + spanColumns] ?? 15;
      spanColumns += 1;
    }
    spanWidth += Math.max(spanColumns - 1, 0);
    cells.push('.'.repeat(Math.max(spanWidth, 1)));
    columnIndex += Math.max(spanColumns, 1);
  }

  return `  ${cells.join(' ')}`;
}

function renderBannerGroupRow(
  widths: number[],
  columns: Array<{ label: string; groupName: string }>,
): string {
  const cells: string[] = [padRight('', widths[0] ?? 15)];
  let columnIndex = 1;

  while (columnIndex < columns.length) {
    const groupName = columns[columnIndex]?.groupName ?? '';
    let spanWidth = 0;
    let spanColumns = 0;
    while (columnIndex + spanColumns < columns.length && columns[columnIndex + spanColumns]?.groupName === groupName) {
      spanWidth += widths[columnIndex + spanColumns] ?? 15;
      spanColumns += 1;
    }
    spanWidth += Math.max(spanColumns - 1, 0);
    cells.push(centerText(groupName, spanWidth));
    columnIndex += Math.max(spanColumns, 1);
  }

  return `  ${cells.join(' ')}`;
}

function renderBannerColumnRows(
  widths: number[],
  columns: Array<{ label: string; groupName: string }>,
): string[] {
  const wrappedLabels = columns.map((column, index) => wrapBannerLabel(column.label, widths[index] ?? 15));
  const rowCount = wrappedLabels.reduce((max, parts) => Math.max(max, parts.length), 1);
  const rows: string[] = [];

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const cells = wrappedLabels.map((parts, columnIndex) => padRight(parts[rowIndex] ?? '', widths[columnIndex] ?? 15));
    rows.push(`  ${cells.join(' ')}`);
  }

  return rows;
}

function wrapBannerLabel(label: string, width: number): string[] {
  const normalized = label.trim().replace(/\s+/g, ' ');
  if (!normalized) return [''];
  if (normalized.length <= width) return [normalized];

  const words = normalized.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      let remaining = word;
      while (remaining.length > width) {
        lines.push(remaining.slice(0, width));
        remaining = remaining.slice(width);
      }
      current = remaining;
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
}

function centerText(value: string, width: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return padRight('', width);
  if (normalized.length >= width) return normalized.slice(0, width);
  const leftPadding = Math.floor((width - normalized.length) / 2);
  const rightPadding = width - normalized.length - leftPadding;
  return `${' '.repeat(leftPadding)}${normalized}${' '.repeat(rightPadding)}`;
}

function padRight(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return `${value}${' '.repeat(width - value.length)}`;
}

function isBannerSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && /^[.\-_= ]+$/.test(trimmed);
}

function parseDirectiveValues(line: string | undefined): string[] {
  if (!line) return [];
  const trimmed = line.trim();
  const colonIndex = trimmed.indexOf(':');
  if (colonIndex < 0) return [];
  const valuePart = trimmed.slice(colonIndex + 1).split('^')[0] ?? '';
  return valuePart.split(',').map((value) => value.trim()).filter((value) => value.length > 0);
}

function normalizeWinCrossDisplayText(value: string): string {
  return value.replace(/<U\+([0-9A-Fa-f]+)>/g, (match, rawHex) => {
    const codePoint = Number.parseInt(rawHex, 16);
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) {
      return match;
    }
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return match;
    }
  });
}

function extractDirectiveSuffix(line: string | undefined): string {
  if (!line) return '';
  const trimmed = line.trim();
  const firstCaret = trimmed.indexOf('^');
  if (firstCaret < 0) return '';
  return trimmed.slice(firstCaret);
}

function toAlphaLabel(index: number): string {
  let value = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}
