/**
 * DataMapProcessor.ts - Variable Enrichment Pipeline
 *
 * Enriches raw variables (from .sav) with:
 * - Parent inference (S8r1 → parent S8)
 * - Parent context (S8r1 gets S8's description)
 * - Type normalization (→ normalizedType)
 * - Dual output generation (verbose + agent formats)
 *
 * Entry point: enrichVariables(rawVariables) → { verbose, agent }
 */

import fs from 'fs/promises';
import path from 'path';

// ===== TYPES & INTERFACES =====

export interface RawDataMapVariable {
  level: 'parent' | 'sub';
  column: string;
  description: string;
  valueType: string;
  answerOptions: string;
  parentQuestion: string;
  context?: string;
}

export interface ProcessedDataMapVariable extends RawDataMapVariable {
  context?: string;
  confidence?: number;
  // Enrichment fields for normalized typing
  normalizedType?: 'numeric_range' | 'percentage_per_option' | 'ordinal_scale' |
                   'matrix_single_choice' | 'binary_flag' | 'categorical_select' |
                   'text_open' | 'admin' | 'weight';
  rangeMin?: number;
  rangeMax?: number;
  rangeStep?: number;
  allowedValues?: (number | string)[];
  scaleLabels?: { value: number | string; label: string }[];
  rowSumConstraint?: boolean;
  dependentOn?: string;
  dependentRule?: string;
}

export type VerboseDataMap = ProcessedDataMapVariable;

export interface AgentDataMap {
  Column: string;
  Description: string;
  Answer_Options: string;
  ParentQuestion?: string;
  Context?: string;
}

export interface ProcessingResult {
  success: boolean;
  verbose: VerboseDataMap[];
  agent: AgentDataMap[];
  validationPassed: boolean;
  confidence: number;
  errors: string[];
  warnings: string[];
}

// ===== SHARED PARENT INFERENCE =====

export function inferParentFromSubVariable(subVariableName: string): string {
  // Strip structural suffixes to find the parent question code.
  // Handles grid suffixes (S8r1, A4c1) and SPSS patterns (A3DKr99c1, S2r98oe, C3_1r15).

  let parent = subVariableName;

  // Remove structural suffixes — order matters (most specific first)

  // Remove r\d+c\d+ (like r1c2, r2c1)
  parent = parent.replace(/r\d+c\d+$/i, '');

  // Remove r\d+oe (like r98oe — open-ended row)
  parent = parent.replace(/r\d+oe$/i, '');

  // Remove c\d+ (like c1, c2, c3) — only if preceded by another char (avoid stripping standalone C1, C2)
  parent = parent.replace(/(?<=[a-z0-9])c\d+$/i, '');

  // Remove r\d+ (like r1, r2, r3)
  parent = parent.replace(/r\d+$/i, '');

  // If no change was made or result is too short, return 'NA'
  if (parent === subVariableName || parent.length < 2) {
    return 'NA';
  }

  return parent;
}

// ===== MAIN PROCESSOR CLASS =====

export class DataMapProcessor {

  /**
   * PRIMARY entry point for .sav-forward flow.
   * Full enrichment: parent inference → parent context → type normalization.
   * Pure function — no file I/O, no SPSS validation.
   */
  enrichVariables(rawVariables: RawDataMapVariable[]): {
    verbose: VerboseDataMap[];
    agent: AgentDataMap[];
  } {
    const withParents = this.addParentRelationships(rawVariables);
    const withContext = this.addParentContext(withParents);
    const normalized = this.normalizeVariableTypes(withContext);
    return this.generateDualOutputs(normalized);
  }

  /**
   * Add parent context to sub-variables by looking up the parent's description
   * from the same array. Pure function — no file I/O.
   */
  private addParentContext(variables: ProcessedDataMapVariable[]): ProcessedDataMapVariable[] {
    return variables.map(variable => {
      if (variable.level === 'sub' && variable.parentQuestion !== 'NA') {
        const parentVar = variables.find(v => v.column === variable.parentQuestion);
        if (parentVar && parentVar.description) {
          return {
            ...variable,
            context: `${parentVar.column}: ${parentVar.description}`,
          };
        }
      }
      return variable;
    });
  }

  // ===== PARENT INFERENCE =====

  private addParentRelationships(variables: RawDataMapVariable[]): ProcessedDataMapVariable[] {
    return variables.map(variable => {
      if (variable.level === 'sub') {
        const parentCode = this.inferParentFromSubVariable(variable.column);
        return {
          ...variable,
          parentQuestion: parentCode
        };
      }

      // Parent variables have no parent question
      return {
        ...variable,
        parentQuestion: 'NA'
      };
    });
  }

  private inferParentFromSubVariable(subVariableName: string): string {
    return inferParentFromSubVariable(subVariableName);
  }

  // ===== TYPE NORMALIZATION =====

  private normalizeVariableTypes(variables: ProcessedDataMapVariable[]): ProcessedDataMapVariable[] {
    const normalized = variables.map((variable) => {
      const enriched = { ...variable };

      // Skip admin fields — but rescue variables with value labels (they're analytically useful)
      // e.g., hRESPONDENT with "1=Type A,2=Type B" is a real segmentation variable,
      // while record/uuid/qtime with no labels are truly system metadata
      if (this.isAdminField(variable.column)) {
        const hasValueLabels = variable.answerOptions && variable.answerOptions !== 'NA';
        if (hasValueLabels || this.isGeographicDemographic(variable)) {
          // Don't mark as admin — let it flow through to normal type classification
        } else {
          enriched.normalizedType = 'admin';
          return enriched;
        }
      }

      // Check for open text responses
      if (variable.valueType?.toLowerCase().includes('open text') ||
          variable.valueType?.toLowerCase().includes('open numeric')) {
        enriched.normalizedType = 'text_open';
        return enriched;
      }

      // Detect binary flags (0/1 Unchecked/Checked) - special case for multi-select checkboxes
      // Check by exact string match OR by 0-1 range pattern
      if (variable.answerOptions === '0=Unchecked,1=Checked' ||
          (enriched.rangeMin === 0 && enriched.rangeMax === 1)) {
        enriched.normalizedType = 'binary_flag';
        enriched.allowedValues = [0, 1];
        return enriched;
      }

      // PRIORITY: Has labeled answer options → categorical_select
      // This catches most survey questions (single-select, scales, etc.)
      // Even scales (1-5) are categorical - you're selecting a category
      if (variable.answerOptions && variable.answerOptions !== 'NA') {
        enriched.normalizedType = 'categorical_select';

        // Extract allowed values and labels from answer options
        const allowedVals = this.extractAllowedValues(variable.answerOptions);
        if (allowedVals.length > 0) {
          enriched.allowedValues = allowedVals;
        }

        // Parse labels for display
        const labels = this.parseScaleLabels(variable.answerOptions);
        if (labels.length > 0) {
          enriched.scaleLabels = labels;
        }

        return enriched;
      }

      // No labels + has numeric range → numeric open-end
      // If SPSS had coded categories, they'd have value labels (caught above).
      // Absence of labels means the respondent entered a free number (e.g., "how many drinks?").
      if (enriched.rangeMin !== undefined && enriched.rangeMax !== undefined) {
        enriched.normalizedType = 'numeric_range';
        enriched.rangeStep = 1;
        return enriched;
      }

      return enriched;
    });

    // Second pass: detect dependencies
    return this.detectDependencies(normalized);
  }

  /**
   * Detect hidden variables that represent geographic demographics (state, region, division).
   * These are analytically meaningful and should produce tables despite being hidden/admin.
   * Requires both: a geographic keyword AND real value labels (not just "NA").
   */
  private isGeographicDemographic(variable: ProcessedDataMapVariable): boolean {
    const col = variable.column.toLowerCase();
    const desc = (variable.description || '').toLowerCase();

    // Must have value labels — raw admin fields won't have them
    if (!variable.answerOptions || variable.answerOptions === 'NA') return false;

    // Check column name or description for geographic keywords
    const geoPatterns = /\b(state|region|division|census|territory|metro|dma)\b/i;
    return geoPatterns.test(col) || geoPatterns.test(desc);
  }

  private isAdminField(column: string): boolean {
    const col = column.toLowerCase();

    // Exact matches for common admin columns
    if (col === 'record' || col === 'uuid' || col === 'date' ||
        col === 'status' || col === 'qtime' || col === 'start_date') {
      return true;
    }

    // Substring patterns (admin metadata baked into column names)
    if (col.includes('time') || col.includes('_id') || col.includes('captured')) {
      return true;
    }

    // Prefix patterns from fielding platforms:
    // h* = hidden variables (flags, recodes, groupings) — lowercase h followed by uppercase
    // hid* = explicitly hidden (speeder, laggard, device, changelog)
    // v* = system metadata (browser, OS, mobile, dropout) — lowercase v followed by lowercase
    // pipe_* = piping logic tracking
    // d* = derived variables — lowercase d followed by uppercase
    if (/^h[A-Z]/.test(column) || col.startsWith('hid') ||
        /^v[a-z]/.test(column) || col.startsWith('pipe_') ||
        /^d[A-Z]/.test(column)) {
      return true;
    }

    // Vendor-specific prefixes
    if (col.startsWith('ims_') || col.startsWith('npi_')) {
      return true;
    }

    return false;
  }

  private parseScaleLabels(answerOptions: string): { value: number | string; label: string }[] {
    const labels: { value: number | string; label: string }[] = [];
    const parts = this.splitAnswerOptions(answerOptions);

    for (const part of parts) {
      const match = part.match(/^(\d+)\s*=\s*(.+)$/);
      if (match) {
        labels.push({
          value: parseInt(match[1], 10),
          label: match[2].trim()
        });
      }
    }

    return labels;
  }

  private extractAllowedValues(answerOptions: string): (number | string)[] {
    const values: (number | string)[] = [];
    const parts = this.splitAnswerOptions(answerOptions);

    for (const part of parts) {
      const match = part.match(/^(\d+)\s*=/);
      if (match) {
        values.push(parseInt(match[1], 10));
      }
    }

    return values;
  }

  private splitAnswerOptions(answerOptions: string): string[] {
    return answerOptions.split(/,(?=\s*(?:\d+|[a-zA-Z])\s*=)/);
  }

  private detectDependencies(variables: ProcessedDataMapVariable[]): ProcessedDataMapVariable[] {
    return variables.map((variable) => {
      const enriched = { ...variable };

      // Check for "Of those..." pattern indicating dependency
      if (variable.description?.toLowerCase().includes('of those') ||
          variable.description?.toLowerCase().includes('of these')) {
        // Look for the previous question with similar code pattern
        const currentCode = variable.column.match(/^([A-Z]+)(\d+)/);
        if (currentCode) {
          const prefix = currentCode[1];
          const num = parseInt(currentCode[2], 10);

          // Look for previous question (e.g., S11 before S12)
          const prevCode = `${prefix}${num - 1}`;
          const prevVar = variables.find(v => v.column === prevCode);

          if (prevVar) {
            enriched.dependentOn = prevCode;

            // For numeric ranges, upper bound often equals previous question
            if (enriched.normalizedType === 'numeric_range' && prevVar.normalizedType === 'numeric_range') {
              enriched.dependentRule = `upperBoundEquals(${prevCode})`;
            }
          }
        }
      }

      return enriched;
    });
  }

  // ===== DUAL OUTPUT GENERATION =====

  private generateDualOutputs(variables: ProcessedDataMapVariable[]): {
    verbose: VerboseDataMap[];
    agent: AgentDataMap[];
  } {
    // Generate verbose format with all enrichment fields
    const verbose: VerboseDataMap[] = variables.map(v => ({
      level: v.level,
      parentQuestion: v.parentQuestion,
      column: v.column,
      description: v.description,
      valueType: v.valueType,
      answerOptions: v.answerOptions,
      context: v.context || '',
      confidence: v.confidence,
      // Include enrichment fields
      normalizedType: v.normalizedType,
      rangeMin: v.rangeMin,
      rangeMax: v.rangeMax,
      rangeStep: v.rangeStep,
      allowedValues: v.allowedValues,
      scaleLabels: v.scaleLabels,
      rowSumConstraint: v.rowSumConstraint,
      dependentOn: v.dependentOn,
      dependentRule: v.dependentRule
    }));

    // Generate agent format (simplified for agent processing)
    const agent: AgentDataMap[] = variables.map(v => ({
      Column: v.column,
      Description: v.description,
      Answer_Options: v.answerOptions ?? '',
      ParentQuestion: v.parentQuestion !== 'NA' ? v.parentQuestion : undefined,
      Context: v.context || undefined
    }));

    return { verbose, agent };
  }

  // ===== DEVELOPMENT OUTPUT =====

  async saveDevelopmentOutputs(outputs: { verbose: VerboseDataMap[]; agent: AgentDataMap[] }, filename: string, outputDir: string): Promise<void> {
    try {
      await fs.mkdir(outputDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const baseName = path.parse(filename).name;

      // Save verbose output
      const verboseFile = path.join(outputDir, `${baseName}-verbose-${timestamp}.json`);
      await fs.writeFile(verboseFile, JSON.stringify(outputs.verbose, null, 2));
      console.log(`[DataMapProcessor] Development output saved: ${baseName}-verbose-${timestamp}.json`);

      // Save crosstab-agent output (simplified for CrosstabAgent)
      const crosstabAgentFile = path.join(outputDir, `${baseName}-crosstab-agent-${timestamp}.json`);
      await fs.writeFile(crosstabAgentFile, JSON.stringify(outputs.agent, null, 2));
      console.log(`[DataMapProcessor] Development output saved: ${baseName}-crosstab-agent-${timestamp}.json`);

    } catch (error) {
      console.error('[DataMapProcessor] Failed to save development outputs:', error);
    }
  }
}
