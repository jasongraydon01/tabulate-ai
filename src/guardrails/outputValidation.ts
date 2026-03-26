// Output validation guardrails for CrosstabAgent system
// Ensures mapping completeness and quality

import { ValidationResultType } from '../schemas/agentOutputSchema';
import { BannerPlanInputType } from '../schemas/bannerPlanSchema';
import { GuardrailResult } from './inputValidation';

export interface OutputValidationResult extends GuardrailResult {
  qualityMetrics?: {
    averageConfidence: number;
    highConfidenceColumns: number;
    lowConfidenceColumns: number;
    totalColumns: number;
    completionRate: number;
  };
}

// Validate that agent output matches expected structure
export const validateAgentOutput = (
  output: unknown,
  originalBanner: BannerPlanInputType
): OutputValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Type check the output
    if (typeof output !== 'object' || output === null) {
      errors.push('Agent output must be an object');
      return { success: false, errors, warnings };
    }

    const result = output as ValidationResultType;

    // Check structure exists
    if (!result.bannerCuts || !Array.isArray(result.bannerCuts)) {
      errors.push('Agent output missing bannerCuts array');
      return { success: false, errors, warnings };
    }

    // Check group completeness
    const originalGroups = originalBanner.bannerCuts.map(g => g.groupName);
    const outputGroups = result.bannerCuts.map(g => g.groupName);
    
    for (const originalGroup of originalGroups) {
      if (!outputGroups.includes(originalGroup)) {
        errors.push(`Missing group in output: ${originalGroup}`);
      }
    }

    // Check column completeness for each group
    for (let i = 0; i < originalBanner.bannerCuts.length; i++) {
      const originalGroup = originalBanner.bannerCuts[i];
      const outputGroup = result.bannerCuts.find(g => g.groupName === originalGroup.groupName);

      if (!outputGroup) continue;

      const originalColumns = originalGroup.columns.map(c => c.name);
      const outputColumns = outputGroup.columns.map(c => c.name);

      for (const originalColumn of originalColumns) {
        if (!outputColumns.includes(originalColumn)) {
          errors.push(`Missing column in group ${originalGroup.groupName}: ${originalColumn}`);
        }
      }
    }

    // Calculate quality metrics
    const allColumns = result.bannerCuts.flatMap(g => g.columns);
    const totalColumns = allColumns.length;
    const averageConfidence = totalColumns > 0 
      ? allColumns.reduce((sum, col) => sum + col.confidence, 0) / totalColumns 
      : 0;
    
    const highConfidenceColumns = allColumns.filter(col => col.confidence >= 0.8).length;
    const lowConfidenceColumns = allColumns.filter(col => col.confidence < 0.5).length;
    
    const expectedTotalColumns = originalBanner.bannerCuts
      .reduce((total, group) => total + group.columns.length, 0);
    const completionRate = expectedTotalColumns > 0 ? totalColumns / expectedTotalColumns : 0;

    // Quality checks
    if (averageConfidence < 0.6) {
      warnings.push(`Low average confidence: ${(averageConfidence * 100).toFixed(1)}%`);
    }

    if (lowConfidenceColumns > totalColumns * 0.3) {
      warnings.push(`High number of low-confidence columns: ${lowConfidenceColumns}/${totalColumns}`);
    }

    if (completionRate < 1.0) {
      warnings.push(`Incomplete processing: ${(completionRate * 100).toFixed(1)}% completion rate`);
    }

    // Validate individual columns
    for (const group of result.bannerCuts) {
      for (const column of group.columns) {
        // Check required fields
        if (!column.name || !column.adjusted || typeof column.confidence !== 'number' || !column.reasoning) {
          errors.push(`Incomplete column data in group ${group.groupName}: ${column.name || 'unnamed'}`);
        }

        // Check confidence bounds
        if (column.confidence < 0 || column.confidence > 1) {
          errors.push(`Invalid confidence value for ${column.name}: ${column.confidence} (must be 0-1)`);
        }

        // Check for empty adjustments
        if (column.adjusted.trim().length === 0) {
          warnings.push(`Empty R syntax for ${column.name} in group ${group.groupName}`);
        }
      }
    }

    return {
      success: errors.length === 0,
      errors,
      warnings,
      qualityMetrics: {
        averageConfidence,
        highConfidenceColumns,
        lowConfidenceColumns,
        totalColumns,
        completionRate
      }
    };

  } catch (error) {
    errors.push(`Output validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { success: false, errors, warnings };
  }
};

// Validate R syntax quality (basic checks)
export const validateRSyntax = (rExpression: string): { valid: boolean; issues: string[] } => {
  const issues: string[] = [];
  
  if (!rExpression || rExpression.trim().length === 0) {
    issues.push('Empty R expression');
    return { valid: false, issues };
  }

  const expression = rExpression.trim();

  // Check for common R syntax patterns
  const validPatterns = [
    /\w+\s*==\s*\d+/,           // Variable equals number: S2 == 1
    /\w+\s*%in%\s*c\([^)]+\)/,  // Variable in set: S2 %in% c(1,2,3)
    /\w+\s*[<>=!]+\s*\d+/,      // Variable comparison: S2 > 1
    /\([^)]+\)/,                // Parentheses grouping
    /\w+/                       // Simple variable name
  ];

  // Check if it matches any valid pattern
  const hasValidPattern = validPatterns.some(pattern => pattern.test(expression));
  if (!hasValidPattern) {
    issues.push('Expression does not match common R syntax patterns');
  }

  // Check for common issues
  // Only flag single '=' when it looks like an equality test (e.g., S2 = 1 or Segment = "A")
  // Do NOT flag named arguments in function calls such as na.rm = TRUE
  const looksLikeEquality = /\b[A-Za-z_][A-Za-z0-9_]*\s*=\s*(\d+|"[^"]*"|'[^']*')/.test(expression);
  if (looksLikeEquality && !/==/.test(expression)) {
    issues.push('Use == for equality comparison, not =');
  }

  // Detect textual AND/OR operators as separate words only (avoid matching inside names like PRIORITY)
  if (/\bAND\b/.test(expression) || /\bOR\b/.test(expression)) {
    issues.push('Use & for AND and | for OR in R syntax');
  }

  // Check for balanced parentheses
  const openParens = (expression.match(/\(/g) || []).length;
  const closeParens = (expression.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    issues.push('Unbalanced parentheses');
  }

  return {
    valid: issues.length === 0,
    issues
  };
};

// Comprehensive output validation with R syntax checks
export const runOutputGuardrails = (
  output: unknown,
  originalBanner: BannerPlanInputType
): OutputValidationResult => {
  const mainResult = validateAgentOutput(output, originalBanner);
  
  if (!mainResult.success) {
    return mainResult;
  }

  // Additional R syntax validation
  const result = output as ValidationResultType;
  const syntaxWarnings: string[] = [...mainResult.warnings];

  for (const group of result.bannerCuts) {
    for (const column of group.columns) {
      const syntaxCheck = validateRSyntax(column.adjusted);
      if (!syntaxCheck.valid) {
        syntaxWarnings.push(
          `R syntax issues in ${group.groupName}.${column.name}: ${syntaxCheck.issues.join(', ')}`
        );
      }
    }
  }

  return {
    ...mainResult,
    warnings: syntaxWarnings
  };
};