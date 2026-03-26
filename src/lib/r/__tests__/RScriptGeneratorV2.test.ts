import { describe, it, expect } from 'vitest';
import { validateTable, validateAllTables, generateRScriptV2WithValidation } from '../RScriptGeneratorV2';
import { makeTable, makeRow } from '../../__tests__/fixtures';
import type { TableWithLoopFrame } from '@/schemas/verificationAgentSchema';
import type { CutDefinition } from '../../tables/CutsSpec';
import type { LoopGroupMapping } from '../../validation/LoopCollapser';

function withLoopFrame(table: ReturnType<typeof makeTable>): TableWithLoopFrame {
  return { ...table, loopDataFrame: '' };
}

function makeCut(overrides: Partial<CutDefinition> = {}): CutDefinition {
  return {
    id: 'cut_a',
    name: 'Group A',
    rExpression: 'Q1 == 1',
    statLetter: 'A',
    groupName: 'Demo',
    groupIndex: 0,
    reviewAction: 'ai_original',
    reviewHint: '',
    preReviewExpression: '',
    ...overrides,
  };
}

describe('RScriptGeneratorV2', () => {
  describe('validateTable', () => {
    it('validates a correct frequency table', () => {
      const table = makeTable({
        tableType: 'frequency',
        rows: [
          makeRow({ variable: 'Q1', filterValue: '1' }),
          makeRow({ variable: 'Q1', filterValue: '2' }),
        ],
      });
      const result = validateTable(table);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates a correct mean_rows table', () => {
      const table = makeTable({
        tableType: 'mean_rows',
        rows: [
          makeRow({ variable: 'Q1r1', filterValue: '' }),
          makeRow({ variable: 'Q1r2', filterValue: '' }),
        ],
      });
      const result = validateTable(table);
      expect(result.valid).toBe(true);
    });

    it('rejects table with no rows', () => {
      const table = makeTable({ rows: [] });
      const result = validateTable(table);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('no rows'))).toBe(true);
    });

    it('allows _HEADER_ filterValue rows on frequency table', () => {
      const table = makeTable({
        tableType: 'frequency',
        rows: [
          makeRow({ variable: 'Q1', filterValue: '_HEADER_' }),
          makeRow({ variable: 'Q1', filterValue: '1' }),
        ],
      });
      const result = validateTable(table);
      expect(result.valid).toBe(true);
    });

    it('flags empty filterValue on frequency table as error', () => {
      const table = makeTable({
        tableType: 'frequency',
        rows: [
          makeRow({ variable: 'Q1', filterValue: '' }),
        ],
      });
      const result = validateTable(table);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Empty filterValue'))).toBe(true);
    });

    it('allows stat rows with empty filterValue on frequency tables', () => {
      const table = makeTable({
        tableType: 'frequency',
        rows: [
          makeRow({ variable: 'Q1', filterValue: '1', label: 'Agree' }),
          makeRow({ variable: 'Q1', filterValue: '2', label: 'Disagree' }),
          makeRow({ variable: 'Q1', filterValue: '', label: 'Mean', rowKind: 'stat' }),
          makeRow({ variable: 'Q1', filterValue: '', label: 'Median', rowKind: 'stat' }),
        ],
      });
      const result = validateTable(table);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('allows not_answered rows with empty filterValue on frequency tables', () => {
      const table = makeTable({
        tableType: 'frequency',
        rows: [
          makeRow({ variable: 'Q1', filterValue: '1', label: 'Rank 1' }),
          makeRow({ variable: 'Q1', filterValue: '2', label: 'Rank 2' }),
          makeRow({ variable: 'Q1', filterValue: '', label: 'Not Ranked', rowKind: 'not_answered' }),
        ],
      });
      const result = validateTable(table);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('excludes stat and not_answered rows from duplicate key checks', () => {
      const table = makeTable({
        tableType: 'frequency',
        rows: [
          makeRow({ variable: 'Q1', filterValue: '1', label: 'Rank 1' }),
          makeRow({ variable: 'Q1', filterValue: '', label: 'Mean', rowKind: 'stat' }),
          makeRow({ variable: 'Q1', filterValue: '', label: 'Median', rowKind: 'stat' }),
          makeRow({ variable: 'Q1', filterValue: '', label: 'Not Ranked', rowKind: 'not_answered' }),
        ],
      });
      const result = validateTable(table);
      expect(result.valid).toBe(true);
      // Should have no duplicate warnings since stat/not_answered rows are excluded
      expect(result.warnings).toHaveLength(0);
    });

    it('warns on non-empty filterValue in mean_rows table', () => {
      const table = makeTable({
        tableType: 'mean_rows',
        rows: [
          makeRow({ variable: 'Q1r1', filterValue: '5' }),
        ],
      });
      const result = validateTable(table);
      expect(result.valid).toBe(true); // valid but has warning
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('does not warn when a singleton NET duplicates its underlying value row', () => {
      const table = makeTable({
        tableType: 'frequency',
        rows: [
          makeRow({ variable: 'Q1', label: 'Middle', filterValue: '3', isNet: true, rowKind: 'net' }),
          makeRow({ variable: 'Q1', label: 'Neutral', filterValue: '3', isNet: false, rowKind: 'value', indent: 1 }),
        ],
      });

      const result = validateTable(table);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('still warns on true duplicate value rows', () => {
      const table = makeTable({
        tableType: 'frequency',
        rows: [
          makeRow({ variable: 'Q1', label: 'Neutral', filterValue: '3', isNet: false, rowKind: 'value' }),
          makeRow({ variable: 'Q1', label: 'Neutral duplicate', filterValue: '3', isNet: false, rowKind: 'value' }),
        ],
      });

      const result = validateTable(table);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Row 2: Duplicate variable/filterValue combination "Q1:3".');
    });
  });

  describe('validateAllTables', () => {
    it('separates valid and invalid tables', () => {
      const tables = [
        makeTable({ tableId: 'valid1', rows: [makeRow()] }),
        makeTable({ tableId: 'invalid1', rows: [] }),
        makeTable({ tableId: 'valid2', rows: [makeRow({ variable: 'Q2', filterValue: '1' })] }),
      ];
      const { validTables, report } = validateAllTables(tables);
      expect(validTables).toHaveLength(2);
      expect(report.invalidTables).toBe(1);
      expect(report.skippedTables).toHaveLength(1);
      expect(report.skippedTables[0].tableId).toBe('invalid1');
    });
  });

  describe('generateRScriptV2WithValidation', () => {
    const baseCuts = [makeCut()];

    it('produces R script with required library calls', () => {
      const result = generateRScriptV2WithValidation({
        tables: [withLoopFrame(makeTable({ rows: [makeRow()] }))],
        cuts: baseCuts,
      });
      expect(result.script).toContain('library(haven)');
      expect(result.script).toContain('library(dplyr)');
      expect(result.script).toContain('library(jsonlite)');
      expect(result.script).toContain('read_sav');
      expect(result.script).toContain('write_json');
    });

    it('includes cut definitions in output', () => {
      const result = generateRScriptV2WithValidation({
        tables: [withLoopFrame(makeTable({ rows: [makeRow()] }))],
        cuts: baseCuts,
      });
      expect(result.script).toContain('Q1 == 1');
      expect(result.script).toContain('"A"');
    });

    it('includes weight variable when provided', () => {
      const result = generateRScriptV2WithValidation({
        tables: [withLoopFrame(makeTable({ rows: [makeRow()] }))],
        cuts: baseCuts,
        weightVariable: 'wt',
      });
      expect(result.script).toContain('wt');
      expect(result.script).toContain('Weight variable: wt');
    });

    it('omits weight references when no weightVariable', () => {
      const result = generateRScriptV2WithValidation({
        tables: [withLoopFrame(makeTable({ rows: [makeRow()] }))],
        cuts: baseCuts,
      });
      expect(result.script).not.toContain('Weight variable:');
    });

    it('includes significance thresholds in script config', () => {
      const result = generateRScriptV2WithValidation({
        tables: [withLoopFrame(makeTable({ rows: [makeRow()] }))],
        cuts: baseCuts,
        significanceThresholds: [0.05, 0.10],
      });
      expect(result.script).toContain('0.05');
      expect(result.script).toContain('0.1');
    });

    it('parses decimal range filter values as range masks (not equality expressions)', () => {
      const table = withLoopFrame(makeTable({
        tableId: 's10_binned',
        tableType: 'frequency',
        rows: [
          makeRow({ variable: 'S10', label: '56-245', filterValue: '56.0-244.6' }),
        ],
      }));

      const result = generateRScriptV2WithValidation({
        tables: [table],
        cuts: baseCuts,
      });

      expect(result.script).toContain('as.numeric(var_col) >= 56');
      expect(result.script).toContain('as.numeric(var_col) <= 244.6');
      expect(result.script).not.toContain('== 56.0-244.6');
    });

    it('closes var_col if/else branch for NET rows with numeric netComponents', () => {
      const table = withLoopFrame(makeTable({
        tableId: 'q1_scale',
        tableType: 'frequency',
        rows: [
          makeRow({
            variable: 'Q1',
            label: 'Top 2 Box',
            filterValue: '6,7',
            isNet: true,
            netComponents: ['6', '7'],
          }),
          makeRow({
            variable: 'Q1',
            label: '6',
            filterValue: '6',
          }),
        ],
      }));

      const result = generateRScriptV2WithValidation({
        tables: [table],
        cuts: baseCuts,
      });

      const row1Start = result.script.indexOf('# Row 1: Q1 IN (6, 7)');
      const row2Start = result.script.indexOf('# Row 2: Q1 == 6');

      expect(row1Start).toBeGreaterThan(-1);
      expect(row2Start).toBeGreaterThan(row1Start);

      const row1Block = result.script.slice(row1Start, row2Start);
      expect(row1Block).toContain('if (!is.null(var_col)) {');
      expect(row1Block).toContain('} else {');
      expect(row1Block).toContain('error = "Variable Q1 not found"');
    });

    it('skips invalid tables and counts them in report', () => {
      const result = generateRScriptV2WithValidation({
        tables: [
          withLoopFrame(makeTable({ tableId: 'valid', rows: [makeRow()] })),
          withLoopFrame(makeTable({ tableId: 'invalid', rows: [] })),
        ],
        cuts: baseCuts,
      });
      expect(result.validation.invalidTables).toBe(1);
      expect(result.validation.skippedTables).toHaveLength(1);
      expect(result.script).not.toContain('"invalid"');
    });

    it('produces valid R script header even with empty tables input', () => {
      const result = generateRScriptV2WithValidation({
        tables: [],
        cuts: baseCuts,
      });
      expect(result.script).toContain('library(haven)');
      expect(result.validation.totalTables).toBe(0);
    });

    it('defines safe_quantile guard before main cuts are evaluated', () => {
      const result = generateRScriptV2WithValidation({
        tables: [withLoopFrame(makeTable({ rows: [makeRow()] }))],
        cuts: [makeCut({ rExpression: 'S12 < quantile(S12, probs = 0.33, na.rm = TRUE)' })],
      });

      const guardIdx = result.script.indexOf('if (!exists("safe_quantile", mode = "function")) safe_quantile <- function(x, ...) quantile(as.numeric(x), ...)');
      const cutsIdx = result.script.indexOf('cuts <- list(');
      expect(guardIdx).toBeGreaterThan(-1);
      expect(cutsIdx).toBeGreaterThan(-1);
      expect(guardIdx).toBeLessThan(cutsIdx);
    });

    it('defines helper guards before stacked-loop cuts are evaluated', () => {
      const table = withLoopFrame(makeTable({
        tableId: 'loop_test',
        rows: [makeRow({ variable: 'Q1r1', filterValue: '1' })],
      }));
      table.loopDataFrame = 'stacked_loop_1';

      const loopMappings: LoopGroupMapping[] = [{
        skeleton: 'Q-N-r-N',
        stackedFrameName: 'stacked_loop_1',
        iterations: ['1', '2'],
        variables: [{
          baseName: 'Q1r1',
          label: 'Q1 Row 1',
          iterationColumns: { '1': 'Q1_1r1', '2': 'Q1_2r1' },
        }],
      }];

      const result = generateRScriptV2WithValidation({
        tables: [table],
        cuts: [makeCut({ rExpression: 'S12 < quantile(S12, probs = 0.33, na.rm = TRUE)' })],
        loopMappings,
      });

      const stackedCutsIdx = result.script.indexOf('cuts_stacked_loop_1 <- list(');
      const errorGuardIdx = result.script.indexOf('if (!exists(".hawktab_cut_errors", inherits = FALSE)) .hawktab_cut_errors <- c()');
      const quantileGuardIdx = result.script.indexOf('if (!exists("safe_quantile", mode = "function")) safe_quantile <- function(x, ...) quantile(as.numeric(x), ...)');
      expect(stackedCutsIdx).toBeGreaterThan(-1);
      expect(errorGuardIdx).toBeGreaterThan(-1);
      expect(quantileGuardIdx).toBeGreaterThan(-1);
      expect(errorGuardIdx).toBeLessThan(stackedCutsIdx);
      expect(quantileGuardIdx).toBeLessThan(stackedCutsIdx);
    });

    it('uses mutate-based loop remapping to avoid rename collisions on existing target columns', () => {
      const table = withLoopFrame(makeTable({
        tableId: 'loop_rename_collision',
        rows: [makeRow({ variable: 'hCHANNEL_1r', filterValue: '1' })],
      }));
      table.loopDataFrame = 'stacked_loop_1';

      const loopMappings: LoopGroupMapping[] = [{
        skeleton: 'hCHANNEL_NrN',
        stackedFrameName: 'stacked_loop_1',
        iterations: ['1', '2'],
        variables: [
          {
            baseName: 'hCHANNEL_1r',
            label: 'Supermarket',
            iterationColumns: { '1': 'hCHANNEL_1r1', '2': 'hCHANNEL_2r1' },
          },
          {
            baseName: 'hCHANNEL_1r2',
            label: 'Mass Merch/Supercenter',
            iterationColumns: { '1': 'hCHANNEL_1r2', '2': 'hCHANNEL_2r2' },
          },
        ],
      }];

      const result = generateRScriptV2WithValidation({
        tables: [table],
        cuts: baseCuts,
        loopMappings,
      });

      expect(result.script).toContain('dplyr::mutate(hCHANNEL_1r = .data[["hCHANNEL_2r1"]], hCHANNEL_1r2 = .data[["hCHANNEL_2r2"]], .loop_iter = 2)');
      expect(result.script).not.toContain('dplyr::rename(hCHANNEL_1r = hCHANNEL_2r1');
    });

    it('materializes stacked loop frames to export/data sav files after table computation', () => {
      const table = withLoopFrame(makeTable({
        tableId: 'loop_export_data',
        rows: [makeRow({ variable: 'Q1r1', filterValue: '1' })],
      }));
      table.loopDataFrame = 'stacked_loop_1';

      const loopMappings: LoopGroupMapping[] = [{
        skeleton: 'Q-N-r-N',
        stackedFrameName: 'stacked_loop_1',
        iterations: ['1', '2'],
        variables: [{
          baseName: 'Q1r1',
          label: 'Q1 Row 1',
          iterationColumns: { '1': 'Q1_1r1', '2': 'Q1_2r1' },
        }],
      }];

      const result = generateRScriptV2WithValidation({
        tables: [table],
        cuts: baseCuts,
        loopMappings,
      });

      const exportWriteIdx = result.script.indexOf('haven::write_sav(export_df, file.path("export", "data", "stacked_loop_1.sav"))');
      const jsonOutputIdx = result.script.indexOf('output_path <- file.path("results", "tables.json")');
      expect(exportWriteIdx).toBeGreaterThan(-1);
      expect(jsonOutputIdx).toBeGreaterThan(-1);
      expect(exportWriteIdx).toBeLessThan(jsonOutputIdx);
      expect(result.script).toContain('print("Export data file saved to: export/data/stacked_loop_1.sav")');
      // Verify internal computation columns are stripped before export
      expect(result.script).toContain('internal_cols <- grep("^\\\\.loop_iter$|^HT_", names(export_df), value = TRUE)');
      expect(result.script).toContain('if (length(internal_cols) > 0) export_df <- export_df[, !names(export_df) %in% internal_cols, drop = FALSE]');
      expect(result.script).toContain('if (exists(".hawktab_export_data_errors", inherits = FALSE) && length(.hawktab_export_data_errors) > 0) {');
    });

    it('applies structural table masks before row math when computeContext is present', () => {
      const table = withLoopFrame(makeTable({
        tableId: 'q7_anchor',
        rows: [
          makeRow({
            variable: 'Q7r1',
            filterValue: '1',
            computeContext: {
              version: 1,
              universeMode: 'masked_row_observed_n',
              aggregationMode: 'none',
              sourceVariable: 'Q7r1',
              componentVariables: [],
              componentValues: ['1'],
            },
          }),
        ],
        computeContext: {
          version: 1,
          referenceUniverse: 'question',
          effectiveBaseMode: 'table_mask_then_row_observed_n',
          tableMaskIntent: 'question_universe',
          tableMaskRecipe: { kind: 'any_answered', variables: ['Q7r1', 'Q7r2'] },
          rebasePolicy: 'none',
          rebaseSourceVariables: [],
          rebaseExcludedValues: [],
          validityPolicy: 'none',
          validityExpression: null,
          referenceBaseN: 120,
          itemBaseRange: [75, 120],
          baseViewRole: 'anchor',
          plannerBaseComparability: 'varying_but_acceptable',
          plannerBaseSignals: ['filtered-base'],
          computeRiskSignals: ['compute-mask-required'],
          legacyCompatibility: {
            basePolicy: 'question_base_shared',
            additionalFilter: '',
          },
        },
      }));

      const result = generateRScriptV2WithValidation({
        tables: [table],
        cuts: baseCuts,
      });

      const maskIdx = result.script.indexOf('structural_mask <- get_answered_mask(cut_data, c("Q7r1", "Q7r2"))');
      const rowIdx = result.script.indexOf('# Row 1: Q7r1 == 1');
      expect(maskIdx).toBeGreaterThan(-1);
      expect(rowIdx).toBeGreaterThan(maskIdx);
    });

    it('uses shared masked universe for multi-variable NET rows', () => {
      const table = withLoopFrame(makeTable({
        tableId: 'q1_net',
        rows: [
          makeRow({
            variable: '_NET_ANY',
            label: 'Any item',
            filterValue: '',
            isNet: true,
            netComponents: ['Q1r1', 'Q1r2'],
            computeContext: {
              version: 1,
              universeMode: 'masked_shared_table_n',
              aggregationMode: 'any_component_selected',
              sourceVariable: null,
              componentVariables: ['Q1r1', 'Q1r2'],
              componentValues: [],
            },
          }),
        ],
        computeContext: {
          version: 1,
          referenceUniverse: 'question',
          effectiveBaseMode: 'table_mask_then_row_observed_n',
          tableMaskIntent: 'question_universe',
          tableMaskRecipe: { kind: 'any_answered', variables: ['Q1r1', 'Q1r2'] },
          rebasePolicy: 'none',
          rebaseSourceVariables: [],
          rebaseExcludedValues: [],
          validityPolicy: 'none',
          validityExpression: null,
          referenceBaseN: 100,
          itemBaseRange: null,
          baseViewRole: 'anchor',
          plannerBaseComparability: 'shared',
          plannerBaseSignals: [],
          computeRiskSignals: ['compute-mask-required', 'net-uses-table-universe'],
          legacyCompatibility: {
            basePolicy: 'question_base_shared',
            additionalFilter: '',
          },
        },
      }));

      const result = generateRScriptV2WithValidation({
        tables: [table],
        cuts: baseCuts,
      });

      expect(result.script).toContain('base_n <- nrow(cut_data)');
      expect(result.script).toContain('count <- sum(net_respondents, na.rm = TRUE)');
    });

    it('keeps same-variable rollups on masked row-observed denominators and applies rebase exclusions from computeContext', () => {
      const table = withLoopFrame(makeTable({
        tableId: 'q5_t2b',
        rows: [
          makeRow({
            variable: 'Q5',
            label: 'Top 2 Box',
            filterValue: '6,7',
            isNet: true,
            netComponents: ['6', '7'],
            computeContext: {
              version: 1,
              universeMode: 'masked_row_observed_n',
              aggregationMode: 'single_variable_value_set',
              sourceVariable: 'Q5',
              componentVariables: [],
              componentValues: ['6', '7'],
            },
          }),
        ],
        computeContext: {
          version: 1,
          referenceUniverse: 'question',
          effectiveBaseMode: 'table_mask_then_row_observed_n',
          tableMaskIntent: 'question_universe',
          tableMaskRecipe: { kind: 'any_answered', variables: ['Q5'] },
          rebasePolicy: 'exclude_non_substantive_tail',
          rebaseSourceVariables: ['Q5'],
          rebaseExcludedValues: [98, 99],
          validityPolicy: 'none',
          validityExpression: null,
          referenceBaseN: 100,
          itemBaseRange: null,
          baseViewRole: 'anchor',
          plannerBaseComparability: 'shared',
          plannerBaseSignals: ['rebased-base'],
          computeRiskSignals: ['compute-mask-required'],
          legacyCompatibility: {
            basePolicy: 'question_base_rebased_excluding_non_substantive_tail',
            additionalFilter: '',
          },
        },
      }));

      const result = generateRScriptV2WithValidation({
        tables: [table],
        cuts: baseCuts,
      });

      expect(result.script).toContain('var_col[var_col %in% c(98, 99)] <- NA');
      expect(result.script).toContain('base_n <- sum(!is.na(var_col))');
      expect(result.script).toContain('count <- sum(as.numeric(var_col) %in% c(6, 7) & !is.na(var_col), na.rm = TRUE)');
    });

    it('uses shared masked universe for mean-row NET row sums', () => {
      const table = withLoopFrame(makeTable({
        tableId: 'mean_net',
        tableType: 'mean_rows',
        rows: [
          makeRow({
            variable: '_NET_MEAN',
            label: 'Any item mean',
            filterValue: '',
            isNet: true,
            netComponents: ['Q9r1', 'Q9r2'],
            computeContext: {
              version: 1,
              universeMode: 'masked_shared_table_n',
              aggregationMode: 'row_sum_components',
              sourceVariable: null,
              componentVariables: ['Q9r1', 'Q9r2'],
              componentValues: [],
            },
          }),
        ],
        computeContext: {
          version: 1,
          referenceUniverse: 'question',
          effectiveBaseMode: 'table_mask_then_row_observed_n',
          tableMaskIntent: 'question_universe',
          tableMaskRecipe: { kind: 'any_answered', variables: ['Q9r1', 'Q9r2'] },
          rebasePolicy: 'none',
          rebaseSourceVariables: [],
          rebaseExcludedValues: [],
          validityPolicy: 'none',
          validityExpression: null,
          referenceBaseN: 90,
          itemBaseRange: null,
          baseViewRole: 'anchor',
          plannerBaseComparability: 'shared',
          plannerBaseSignals: [],
          computeRiskSignals: ['compute-mask-required', 'net-uses-table-universe'],
          legacyCompatibility: {
            basePolicy: 'question_base_shared',
            additionalFilter: '',
          },
        },
      }));

      const result = generateRScriptV2WithValidation({
        tables: [table],
        cuts: baseCuts,
      });

      expect(result.script).toContain('net_mean <- if (all(is.na(row_sums))) NA else round_half_up(mean(row_sums, na.rm = TRUE), 1)');
      expect(result.script).toContain('n <- nrow(cut_data)');
    });

    it('falls back to legacy additionalFilter when computeContext is absent', () => {
      const table = withLoopFrame(makeTable({
        tableId: 'legacy_filter',
        additionalFilter: 'SEG == 1',
        rows: [makeRow({ variable: 'Q1', filterValue: '1' })],
      }));

      const result = generateRScriptV2WithValidation({
        tables: [table],
        cuts: baseCuts,
      });

      expect(result.script).toContain('additional_mask <- with(cut_data, eval(parse(text = "SEG == 1")))');
      expect(result.script).not.toContain('structural_mask <- get_answered_mask');
    });
  });
});
