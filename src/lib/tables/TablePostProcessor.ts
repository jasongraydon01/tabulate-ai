/**
 * TablePostProcessor
 *
 * @deprecated Replaced by the V3 canonical table assembly pipeline (stages 13b–13e).
 * V3 produces structurally correct tables deterministically — no post-hoc formatting
 * pass needed. Table context refinement is handled by TableContextAgent (stage 13e).
 *
 * This file is retained for reference only. Do not invoke from active pipeline code.
 *
 * Original purpose: Deterministic post-pass that enforces formatting rules after
 * VerificationAgent. Runs once, after all parallel agent instances finish, ensuring
 * consistency that prompt-only guidance cannot guarantee across concurrent calls.
 */

import type { ExtendedTableDefinition } from '../../schemas/verificationAgentSchema';
import { stripDeterministicQuestionStem } from '../questionContext/deterministicLabelCleanup';
import type { MessageListEntry } from '../maxdiff/MessageListParser';
import { resolveMaxDiffPolicy, type MaxDiffPolicy } from '../maxdiff/policy';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PostPassAction {
  tableId: string;
  rule: string;
  severity: 'fix' | 'warn';
  detail: string;
}

export interface PostPassResult {
  tables: ExtendedTableDefinition[];
  actions: PostPassAction[];
  stats: {
    tablesProcessed: number;
    totalFixes: number;
    totalWarnings: number;
    baseTextHallucinationCount: number;
    unresolvedPlaceholderCount: number;
    splitCapViolations: number;
    formatNormalizationAdjustments: number;
  };
}

export interface PostPassOptions {
  maxdiffPolicy?: Partial<MaxDiffPolicy>;
  maxdiffChoiceTaskQuestionIds?: string[];
  maxdiffMessages?: MessageListEntry[];
}

// ─── Individual Rules ────────────────────────────────────────────────────────

/**
 * Rule 1: Replace undefined/null with safe defaults for Azure OpenAI compatibility.
 */
function normalizeEmptyFields(table: ExtendedTableDefinition, actions: PostPassAction[]): ExtendedTableDefinition {
  let fixed = false;

  // Table-level fields
  const stringFields = [
    'tableId', 'questionId', 'questionText', 'sourceTableId',
    'excludeReason', 'surveySection', 'baseText', 'userNote',
    'tableSubtitle', 'additionalFilter', 'splitFromTableId',
  ] as const;

  const tableCopy = { ...table };

  for (const field of stringFields) {
    if (tableCopy[field] === undefined || tableCopy[field] === null) {
      (tableCopy as Record<string, unknown>)[field] = '';
      fixed = true;
    }
  }

  // Row-level fields
  const rows = tableCopy.rows.map(row => {
    const rowCopy = { ...row };
    if (rowCopy.variable === undefined || rowCopy.variable === null) { (rowCopy as Record<string, unknown>).variable = ''; fixed = true; }
    if (rowCopy.label === undefined || rowCopy.label === null) { (rowCopy as Record<string, unknown>).label = ''; fixed = true; }
    if (rowCopy.filterValue === undefined || rowCopy.filterValue === null) { (rowCopy as Record<string, unknown>).filterValue = ''; fixed = true; }
    if (rowCopy.isNet === undefined || rowCopy.isNet === null) { (rowCopy as Record<string, unknown>).isNet = false; fixed = true; }
    if (rowCopy.netComponents === undefined || rowCopy.netComponents === null) { (rowCopy as Record<string, unknown>).netComponents = []; fixed = true; }
    if (rowCopy.indent === undefined || rowCopy.indent === null) { (rowCopy as Record<string, unknown>).indent = 0; fixed = true; }
    return rowCopy;
  });

  if (fixed) {
    actions.push({
      tableId: table.tableId,
      rule: 'empty_fields_normalized',
      severity: 'fix',
      detail: 'Replaced undefined/null fields with safe defaults',
    });
  }

  return { ...tableCopy, rows };
}

/**
 * Rule 2: Strip "SECTION X:" prefix, force ALL CAPS, trim whitespace.
 */
function cleanSurveySection(table: ExtendedTableDefinition, actions: PostPassAction[]): ExtendedTableDefinition {
  if (!table.surveySection) return table;

  let cleaned = table.surveySection.trim();

  // Strip "SECTION X:" or "Section X:" prefix (with or without number)
  const sectionPrefixPattern = /^SECTION\s+\d*[A-Z]?\s*[:.\-–—]\s*/i;
  if (sectionPrefixPattern.test(cleaned)) {
    cleaned = cleaned.replace(sectionPrefixPattern, '');
  }

  // Force ALL CAPS
  cleaned = cleaned.toUpperCase().trim();

  if (cleaned !== table.surveySection) {
    actions.push({
      tableId: table.tableId,
      rule: 'survey_section_cleaned',
      severity: 'fix',
      detail: `"${table.surveySection}" → "${cleaned}"`,
    });
    return { ...table, surveySection: cleaned };
  }

  return table;
}

/**
 * Rule 3: Heuristic check for question-description patterns in baseText.
 * Warns but does not auto-fix (semantic decision).
 */
function validateBaseText(table: ExtendedTableDefinition, actions: PostPassAction[]): ExtendedTableDefinition {
  if (!table.baseText) return table;

  const text = table.baseText.trim();

  // Patterns that suggest a question description rather than an audience description
  const suspiciousPatterns = [
    /^about\s+/i,           // "About the drink at..."
    /^awareness\s+of\s+/i,  // "Awareness of treatment options"
    /^usage\s+of\s+/i,      // "Usage of product X"
    /^satisfaction\s+with/i, // "Satisfaction with service"
    /^likelihood\s+/i,      // "Likelihood to recommend"
    /^frequency\s+of\s+/i,  // "Frequency of use"
    /^future\s+/i,          // "Future growth of..."
    /^importance\s+of\s+/i, // "Importance of features"
    /^perception\s+of\s+/i, // "Perception of brand"
    /^preference\s+for\s+/i,// "Preference for product"
    /^attitudes?\s+toward/i, // "Attitude toward brand"
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(text)) {
      actions.push({
        tableId: table.tableId,
        rule: 'suspicious_base_text',
        severity: 'warn',
        detail: `baseText "${text}" looks like a question description, not an audience. Should describe WHO was asked, not WHAT was asked.`,
      });
      break;
    }
  }

  return table;
}

/**
 * Rule 3a: Warn on missing or stub-like questionText.
 */
function validateQuestionText(table: ExtendedTableDefinition, actions: PostPassAction[]): ExtendedTableDefinition {
  const questionText = (table.questionText || '').trim();
  const questionId = (table.questionId || '').trim();

  if (!questionText) {
    actions.push({
      tableId: table.tableId,
      rule: 'suspicious_question_text',
      severity: 'warn',
      detail: 'questionText is empty',
    });
    return table;
  }

  if (questionId && questionText.toLowerCase() === questionId.toLowerCase()) {
    actions.push({
      tableId: table.tableId,
      rule: 'suspicious_question_text',
      severity: 'warn',
      detail: `questionText "${questionText}" duplicates questionId "${questionId}"`,
    });
    return table;
  }

  if (/^[A-Za-z]+\d+(?:_[A-Za-z0-9]+)?$/i.test(questionText)) {
    actions.push({
      tableId: table.tableId,
      rule: 'suspicious_question_text',
      severity: 'warn',
      detail: `questionText "${questionText}" looks like a variable identifier`,
    });
    return table;
  }

  if (questionText.length < 10 && questionText.split(/\s+/).filter(Boolean).length <= 1) {
    actions.push({
      tableId: table.tableId,
      rule: 'suspicious_question_text',
      severity: 'warn',
      detail: `questionText "${questionText}" is unusually short`,
    });
  }

  return table;
}

/**
 * Rule 3b: Backfill baseText when a filter is applied but baseText is empty.
 * Safety net — surfaces the R expression so users can see what's applied.
 */
function backfillBaseText(table: ExtendedTableDefinition, actions: PostPassAction[]): ExtendedTableDefinition {
  // Only act when a filter exists but base text is missing
  if (!table.additionalFilter || table.additionalFilter.trim() === '') return table;
  if (table.baseText && table.baseText.trim() !== '') return table;

  // Last-resort fallback: surface the R expression so users can see what's applied
  actions.push({
    tableId: table.tableId,
    rule: 'base_text_backfill',
    severity: 'fix',
    detail: `baseText was empty despite additionalFilter "${table.additionalFilter}" — backfilled from filter expression`,
  });

  return { ...table, baseText: `Respondents matching filter: ${table.additionalFilter}` };
}

/**
 * Rule 4: Remove same-variable NETs that cover ALL non-NET options + reset orphaned indent.
 */
function checkTrivialNets(table: ExtendedTableDefinition, actions: PostPassAction[]): ExtendedTableDefinition {
  const rows = [...table.rows.map(r => ({ ...r }))];
  const indicesToRemove: Set<number> = new Set();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.isNet || !row.filterValue || row.netComponents.length > 0) continue;

    // Same-variable NET: check if filterValue covers all non-NET values for this variable
    const variable = row.variable;
    const netValues = new Set(row.filterValue.split(',').map(v => v.trim()));

    // Collect all non-NET filterValues for the same variable in this table
    const nonNetValues = new Set<string>();
    for (const other of rows) {
      if (other === row) continue;
      if (other.variable !== variable) continue;
      if (other.isNet) continue;
      if (other.variable === '_CAT_') continue;
      // For single values or comma-separated
      for (const v of other.filterValue.split(',')) {
        const trimmed = v.trim();
        if (trimmed) nonNetValues.add(trimmed);
      }
    }

    if (nonNetValues.size === 0) continue;

    // Check: does the NET cover ALL non-NET values?
    const allCovered = [...nonNetValues].every(v => netValues.has(v));
    if (allCovered && netValues.size <= nonNetValues.size) {
      indicesToRemove.add(i);
      actions.push({
        tableId: table.tableId,
        rule: 'trivial_net_removed',
        severity: 'fix',
        detail: `Removed trivial NET "${row.label}" (filterValue "${row.filterValue}") — covers all ${nonNetValues.size} options for variable ${variable}`,
      });
    }
  }

  if (indicesToRemove.size === 0) return table;

  // Remove trivial NETs and fix orphaned indentation
  const filteredRows = rows.filter((_, i) => !indicesToRemove.has(i));

  // Reset indent for any rows that now have no NET parent above them
  for (let i = 0; i < filteredRows.length; i++) {
    if (filteredRows[i].indent > 0) {
      // Look backward for a NET parent
      let hasParent = false;
      for (let j = i - 1; j >= 0; j--) {
        if (filteredRows[j].isNet && filteredRows[j].indent === 0) {
          hasParent = true;
          break;
        }
        if (filteredRows[j].indent === 0 && !filteredRows[j].isNet) {
          break; // Hit a non-NET top-level row — no parent
        }
      }
      if (!hasParent) {
        filteredRows[i] = { ...filteredRows[i], indent: 0 };
      }
    }
  }

  return { ...table, rows: filteredRows };
}

/**
 * Rule 5: Normalize source ID casing in userNote: [s1] → [S1].
 */
function normalizeSourceIdCasing(table: ExtendedTableDefinition, actions: PostPassAction[]): ExtendedTableDefinition {
  if (!table.userNote) return table;

  // Match [s1], [s12a], [q5r2], etc. — lowercase IDs in brackets
  const pattern = /\[([a-z][a-z0-9_]*)\]/g;
  const original = table.userNote;
  const fixed = original.replace(pattern, (_match, id: string) => `[${id.toUpperCase()}]`);

  if (fixed !== original) {
    actions.push({
      tableId: table.tableId,
      rule: 'source_id_casing_normalized',
      severity: 'fix',
      detail: `userNote: "${original}" → "${fixed}"`,
    });
    return { ...table, userNote: fixed };
  }

  return table;
}

/**
 * Rule 6: Flag duplicate (variable, filterValue) pairs within a table.
 */
function detectDuplicateRows(table: ExtendedTableDefinition, actions: PostPassAction[]): ExtendedTableDefinition {
  const seen = new Map<string, number>();

  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i];
    if (row.variable === '_CAT_') continue;
    const key = `${row.variable}::${row.filterValue}`;
    if (seen.has(key)) {
      actions.push({
        tableId: table.tableId,
        rule: 'duplicate_row_detected',
        severity: 'warn',
        detail: `Duplicate (variable="${row.variable}", filterValue="${row.filterValue}") at rows ${seen.get(key)} and ${i}`,
      });
    } else {
      seen.set(key, i);
    }
  }

  return table;
}

/**
 * Rule 7: Reset indent to 0 for rows with no preceding NET parent.
 */
function checkOrphanIndent(table: ExtendedTableDefinition, actions: PostPassAction[]): ExtendedTableDefinition {
  let modified = false;
  const rows = table.rows.map((row, i) => {
    if (row.indent <= 0) return row;

    // Look backward for a NET parent
    let hasParent = false;
    for (let j = i - 1; j >= 0; j--) {
      const candidate = table.rows[j];
      if (candidate.isNet && candidate.indent === 0) {
        // Check that the parent's filterValue contains this row's filterValue
        if (candidate.filterValue) {
          const parentValues = new Set(candidate.filterValue.split(',').map(v => v.trim()));
          const childValues = row.filterValue.split(',').map(v => v.trim());
          if (childValues.every(v => parentValues.has(v))) {
            hasParent = true;
          }
        }
        break; // Stop at first NET parent candidate
      }
      if (candidate.indent === 0 && !candidate.isNet) {
        break; // Hit a non-NET top-level row
      }
    }

    if (!hasParent) {
      modified = true;
      actions.push({
        tableId: table.tableId,
        rule: 'orphan_indent_reset',
        severity: 'fix',
        detail: `Row "${row.label}" (variable=${row.variable}, filterValue="${row.filterValue}") had indent=${row.indent} with no valid NET parent — reset to 0`,
      });
      return { ...row, indent: 0 };
    }

    return row;
  });

  if (modified) {
    return { ...table, rows };
  }
  return table;
}

/**
 * Rule 8: Strip survey routing instructions from row labels.
 * Removes (TERMINATE), (CONTINUE), (ASK Q5), (SKIP TO S4), (END SURVEY), (SCREEN OUT), etc.
 */
function stripRoutingInstructions(table: ExtendedTableDefinition, actions: PostPassAction[]): ExtendedTableDefinition {
  // Match parenthesized routing instructions at the end of labels or standalone
  // Covers: (TERMINATE), (CONTINUE TO S4), (ASK S3a), (SKIP TO Q5), (END SURVEY), (SCREEN OUT), (GO TO S2)
  const routingPattern = /\s*\((?:TERMINATE|CONTINUE(?:\s+TO\s+\S+)?|ASK\s+\S+|SKIP\s+TO\s+\S+|END\s+SURVEY|SCREEN\s*OUT|GO\s+TO\s+\S+)\)\s*/gi;

  let modified = false;
  const rows = table.rows.map(row => {
    if (!routingPattern.test(row.label)) return row;

    const cleaned = row.label.replace(routingPattern, '').trim();
    if (cleaned !== row.label) {
      modified = true;
      actions.push({
        tableId: table.tableId,
        rule: 'routing_instruction_stripped',
        severity: 'fix',
        detail: `Row label: "${row.label}" → "${cleaned}"`,
      });
      return { ...row, label: cleaned };
    }
    return row;
  });

  if (modified) {
    return { ...table, rows };
  }
  return table;
}

const BASETEXT_UNSUPPORTED_PATTERN =
  /\b(random(?:ly|ization)?|assigned to|random assignment)\b/i;
const PLACEHOLDER_MESSAGE_PATTERN = /\bmessage\s+\d+\b/i;
const PLACEHOLDER_PREFERRED_PATTERN = /\bpreferred message\b/i;

function sanitizeUnsupportedBaseText(
  table: ExtendedTableDefinition,
  actions: PostPassAction[],
): ExtendedTableDefinition {
  const baseText = table.baseText?.trim();
  if (!baseText) return table;
  if (!BASETEXT_UNSUPPORTED_PATTERN.test(baseText)) return table;

  // If no explicit filter evidence exists, clear unsupported assignment language.
  if (!table.additionalFilter || table.additionalFilter.trim() === '') {
    actions.push({
      tableId: table.tableId,
      rule: 'unsupported_base_text_cleared',
      severity: 'fix',
      detail: `Removed unsupported baseText claim: "${table.baseText}"`,
    });
    return { ...table, baseText: '' };
  }

  actions.push({
    tableId: table.tableId,
    rule: 'unsupported_base_text_flagged',
    severity: 'warn',
    detail: `baseText contains assignment language but table has filter evidence: "${table.baseText}"`,
  });
  return table;
}

function buildMessageLookup(messages?: MessageListEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  if (!messages || messages.length === 0) return map;
  for (const message of messages) {
    const code = message.code?.trim().toUpperCase();
    const text = message.text?.trim();
    if (!code || !text) continue;
    map.set(code, text);
  }
  return map;
}

function resolveMessagePlaceholders(
  table: ExtendedTableDefinition,
  actions: PostPassAction[],
  codeToMessage: Map<string, string>,
): ExtendedTableDefinition {
  if (codeToMessage.size === 0) return table;

  let modified = false;
  const rows = table.rows.map((row) => {
    let label = row.label || '';

    const codePreferredMatch = label.match(/^([A-Z]\d+[A-Z]?)\s+preferred message\b/i);
    if (codePreferredMatch) {
      const code = codePreferredMatch[1].toUpperCase();
      const full = codeToMessage.get(code);
      if (full) {
        const next = `${code}: ${full}`;
        if (next !== label) {
          modified = true;
          actions.push({
            tableId: table.tableId,
            rule: 'placeholder_label_resolved',
            severity: 'fix',
            detail: `Resolved "${label}" -> "${next}"`,
          });
          label = next;
        }
      }
    }

    const messageNumberMatch = label.match(/^message\s+(\d+)$/i);
    if (messageNumberMatch) {
      const idx = Number.parseInt(messageNumberMatch[1], 10);
      if (Number.isFinite(idx) && idx > 0) {
        const code = [...codeToMessage.keys()].sort((a, b) => a.localeCompare(b))[idx - 1];
        if (code) {
          const full = codeToMessage.get(code)!;
          const next = `${code}: ${full}`;
          if (next !== label) {
            modified = true;
            actions.push({
              tableId: table.tableId,
              rule: 'placeholder_label_resolved',
              severity: 'fix',
              detail: `Resolved "${label}" -> "${next}"`,
            });
            label = next;
          }
        }
      }
    }

    return label === row.label ? row : { ...row, label };
  });

  if (!modified) return table;
  return { ...table, rows };
}

function stripDeterministicQuestionStemLabels(
  table: ExtendedTableDefinition,
  actions: PostPassAction[],
): ExtendedTableDefinition {
  const questionText = table.questionText?.trim();
  if (!questionText) return table;

  let modified = false;
  const rows = table.rows.map((row) => {
    if (row.variable === '_CAT_' || row.isNet) return row;

    const cleaned = stripDeterministicQuestionStem(row.label || '', questionText);
    if (!cleaned || cleaned === row.label) return row;

    modified = true;
    actions.push({
      tableId: table.tableId,
      rule: 'question_stem_label_stripped',
      severity: 'fix',
      detail: `Row label: "${row.label}" -> "${cleaned}"`,
    });
    return { ...row, label: cleaned };
  });

  if (!modified) return table;
  return { ...table, rows };
}

function normalizeMetricLanguage(input: string): string {
  return input
    .replace(/\bTop\s*2\s*Box\b/gi, 'T2B')
    .replace(/\bBottom\s*2\s*Box\b/gi, 'B2B')
    .replace(/\bTop\s*3\s*Box\b/gi, 'T3B')
    .replace(/\bBottom\s*3\s*Box\b/gi, 'B3B')
    .replace(/\bMiddle\s*3\s*Box\b/gi, 'M3B')
    .replace(/\bMiddle\s*Box\b/gi, 'Middle');
}

function canonicalizeLabelsAndSubtitles(
  table: ExtendedTableDefinition,
  actions: PostPassAction[],
): ExtendedTableDefinition {
  let modified = false;
  let tableSubtitle = normalizeMetricLanguage(table.tableSubtitle || '');
  if (tableSubtitle !== table.tableSubtitle) {
    modified = true;
    actions.push({
      tableId: table.tableId,
      rule: 'subtitle_canonicalized',
      severity: 'fix',
      detail: `tableSubtitle normalized to "${tableSubtitle}"`,
    });
  }

  // Avoid implying anchor rows are shown when anchors are excluded.
  if (/\banchor\b/i.test(tableSubtitle) && table.tableId.startsWith('maxdiff_')) {
    const nextSubtitle = tableSubtitle.replace(/\banchor(?:\s+statements?)?\b/ig, 'messages').trim();
    if (nextSubtitle && nextSubtitle !== tableSubtitle) {
      tableSubtitle = nextSubtitle;
      modified = true;
      actions.push({
        tableId: table.tableId,
        rule: 'subtitle_anchor_wording_adjusted',
        severity: 'fix',
        detail: `Adjusted consolidated subtitle to avoid anchor implication`,
      });
    }
  }

  const rows = table.rows.map((row) => {
    const original = row.label || '';
    let label = normalizeMetricLanguage(original);
    if (/\bT2B\b/i.test(tableSubtitle)) {
      label = label.replace(/\s*\((?:T2B|Top 2 Box[^)]*)\)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
    }
    if (label !== original) {
      modified = true;
      actions.push({
        tableId: table.tableId,
        rule: 'label_canonicalized',
        severity: 'fix',
        detail: `Row label: "${original}" -> "${label}"`,
      });
      return { ...row, label };
    }
    return row;
  });

  if (!modified) return table;
  return { ...table, tableSubtitle, rows };
}

function normalizeT2BComparisonNetStyle(
  table: ExtendedTableDefinition,
  actions: PostPassAction[],
): ExtendedTableDefinition {
  const subtitle = table.tableSubtitle || '';
  if (!/\b(T2B|B2B|M3B|T3B)\b/i.test(subtitle)) return table;

  const dataRows = table.rows.filter(r => r.variable !== '_CAT_');
  if (dataRows.length === 0) return table;
  if (!dataRows.every(r => r.isNet)) return table;

  const rows = table.rows.map((row) => {
    if (row.variable === '_CAT_') return row;
    return { ...row, isNet: false, indent: 0 };
  });

  actions.push({
    tableId: table.tableId,
    rule: 't2b_comparison_net_style_normalized',
    severity: 'fix',
    detail: 'Cleared all-row NET emphasis for pure metric comparison table',
  });

  return { ...table, rows };
}

function enforceChoiceTaskPolicy(
  table: ExtendedTableDefinition,
  actions: PostPassAction[],
  choiceTaskQuestionIds: Set<string>,
  policy: MaxDiffPolicy,
): ExtendedTableDefinition {
  if (!choiceTaskQuestionIds.has(table.questionId)) return table;

  let next = table;
  if (!policy.includeChoiceTaskFamilyInMainOutput) {
    next = {
      ...next,
      exclude: true,
      excludeReason: 'Suppressed by MaxDiff policy: choice-task family moved to reference output',
    };
    actions.push({
      tableId: table.tableId,
      rule: 'choice_task_policy_excluded',
      severity: 'fix',
      detail: 'Moved detected choice-task table to reference output',
    });
  }

  if (!policy.allowDerivedTablesForChoiceTasks && next.isDerived) {
    next = {
      ...next,
      exclude: true,
      excludeReason: 'Suppressed by MaxDiff policy: derived choice-task tables disabled',
    };
    actions.push({
      tableId: table.tableId,
      rule: 'choice_task_derived_excluded',
      severity: 'fix',
      detail: 'Excluded derived choice-task table per policy',
    });
  }

  return next;
}

function enforceSplitBudget(
  tables: ExtendedTableDefinition[],
  actions: PostPassAction[],
  maxSplitTablesPerInput: number,
): ExtendedTableDefinition[] {
  const grouped = new Map<string, ExtendedTableDefinition[]>();

  for (const table of tables) {
    const key = table.splitFromTableId || table.sourceTableId || table.questionId || table.tableId;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(table);
  }

  const result: ExtendedTableDefinition[] = [];
  for (const groupTables of grouped.values()) {
    if (groupTables.length <= maxSplitTablesPerInput) {
      result.push(...groupTables);
      continue;
    }

    const ranked = [...groupTables].sort((a, b) => {
      if (a.exclude !== b.exclude) return a.exclude ? 1 : -1;
      if (a.isDerived !== b.isDerived) return a.isDerived ? 1 : -1;
      return a.rows.length - b.rows.length;
    });

    for (let i = 0; i < ranked.length; i++) {
      const table = ranked[i];
      if (i < maxSplitTablesPerInput) {
        result.push(table);
        continue;
      }
      result.push({
        ...table,
        exclude: true,
        excludeReason: `Suppressed by split budget (${maxSplitTablesPerInput})`,
      });
      actions.push({
        tableId: table.tableId,
        rule: 'split_budget_enforced',
        severity: 'fix',
        detail: `Excluded table beyond split cap (${maxSplitTablesPerInput})`,
      });
    }
  }

  return result;
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Apply all post-pass rules to the verified tables.
 * Rules run sequentially per table (order matters: empty fields first, then content, then structural).
 */
export function normalizePostPass(
  tables: ExtendedTableDefinition[],
  options: PostPassOptions = {},
): PostPassResult {
  const actions: PostPassAction[] = [];
  const resolvedPolicy = resolveMaxDiffPolicy(options.maxdiffPolicy);
  const choiceTaskQuestionIds = new Set(options.maxdiffChoiceTaskQuestionIds ?? []);
  const codeToMessage = buildMessageLookup(options.maxdiffMessages);

  const processed = tables.map(table => {
    let t = table;

    // Phase 1: Field normalization (must run first)
    t = normalizeEmptyFields(t, actions);

    // Phase 2: Content normalization
    t = cleanSurveySection(t, actions);
    t = validateQuestionText(t, actions);
    t = validateBaseText(t, actions);
    t = backfillBaseText(t, actions);
    t = sanitizeUnsupportedBaseText(t, actions);
    t = normalizeSourceIdCasing(t, actions);
    t = stripRoutingInstructions(t, actions);
    t = stripDeterministicQuestionStemLabels(t, actions);
    t = canonicalizeLabelsAndSubtitles(t, actions);

    // Phase 3: Structural fixes (depend on clean fields)
    t = checkTrivialNets(t, actions);
    t = normalizeT2BComparisonNetStyle(t, actions);
    t = detectDuplicateRows(t, actions);
    t = checkOrphanIndent(t, actions);
    t = resolveMessagePlaceholders(t, actions, codeToMessage);
    t = enforceChoiceTaskPolicy(t, actions, choiceTaskQuestionIds, resolvedPolicy);

    return t;
  });

  const splitBudgetProcessed = enforceSplitBudget(
    processed,
    actions,
    resolvedPolicy.maxSplitTablesPerInput,
  );

  const unresolvedPlaceholderCount = splitBudgetProcessed.reduce((sum, table) => {
    const unresolved = table.rows.filter(row =>
      PLACEHOLDER_MESSAGE_PATTERN.test(row.label || '') ||
      PLACEHOLDER_PREFERRED_PATTERN.test(row.label || '')
    ).length;
    return sum + unresolved;
  }, 0);

  const baseTextHallucinationCount = splitBudgetProcessed.reduce((sum, table) => {
    return sum + (BASETEXT_UNSUPPORTED_PATTERN.test(table.baseText || '') ? 1 : 0);
  }, 0);

  return {
    tables: splitBudgetProcessed,
    actions,
    stats: {
      tablesProcessed: tables.length,
      totalFixes: actions.filter(a => a.severity === 'fix').length,
      totalWarnings: actions.filter(a => a.severity === 'warn').length,
      baseTextHallucinationCount,
      unresolvedPlaceholderCount,
      splitCapViolations: actions.filter(a => a.rule === 'split_budget_enforced').length,
      formatNormalizationAdjustments: actions.filter(
        a => a.rule.includes('canonicalized') || a.rule.includes('normalized')
      ).length,
    },
  };
}
