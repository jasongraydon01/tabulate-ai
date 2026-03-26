/**
 * Script Discovery Utility
 *
 * Scans the scripts/ directory and extracts metadata about each script.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ScriptInfo } from '../state/types';

// =============================================================================
// Script Metadata
// =============================================================================

/**
 * Known script metadata (for better descriptions and categorization)
 */
const SCRIPT_METADATA: Record<string, { description: string; category: 'long' | 'fast' | 'normal' }> = {
  'test-pipeline.ts': {
    description: 'Full pipeline (45-60 min)',
    category: 'long',
  },
  'test-verification-agent.ts': {
    description: 'VerificationAgent isolation',
    category: 'normal',
  },
  'test-table-generator.ts': {
    description: 'Deterministic table gen (<1s)',
    category: 'fast',
  },
  'compare-to-golden.ts': {
    description: 'Compare to reference output',
    category: 'fast',
  },
  'test-r-regenerate.ts': {
    description: 'Regenerate R script from existing tables',
    category: 'normal',
  },
  'calculate-metrics.ts': {
    description: 'Calculate pipeline metrics',
    category: 'fast',
  },
  'extract-data-json.ts': {
    description: 'Extract data to JSON',
    category: 'fast',
  },
  'export-excel.ts': {
    description: 'Export Excel from tables.json',
    category: 'fast',
  },
  'test-validation-runner.ts': {
    description: 'Validate .sav files across datasets',
    category: 'normal',
  },
  'test-loop-stacking.ts': {
    description: 'Test loop detection and stacking',
    category: 'normal',
  },
  'test-parser-analysis.ts': {
    description: 'Quick .sav parser analysis',
    category: 'fast',
  },
};

// =============================================================================
// Discovery Functions
// =============================================================================

/**
 * Discover all TypeScript scripts in the scripts/ directory
 */
export function discoverScripts(scriptsDir: string): ScriptInfo[] {
  const scripts: ScriptInfo[] = [];

  try {
    const files = fs.readdirSync(scriptsDir);

    for (const file of files) {
      if (!file.endsWith('.ts')) continue;

      const fullPath = path.join(scriptsDir, file);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;

      const metadata = SCRIPT_METADATA[file] || extractMetadataFromFile(fullPath, file);

      scripts.push({
        name: file,
        description: metadata.description,
        category: metadata.category,
        path: fullPath,
      });
    }

    // Sort: long scripts last, fast first, then alphabetical
    scripts.sort((a, b) => {
      const categoryOrder = { fast: 0, normal: 1, long: 2 };
      const orderDiff = categoryOrder[a.category] - categoryOrder[b.category];
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name);
    });

  } catch (error) {
    console.error('Failed to discover scripts:', error);
  }

  return scripts;
}

/**
 * Extract metadata from script file by reading the first few lines
 */
function extractMetadataFromFile(
  filePath: string,
  fileName: string
): { description: string; category: 'long' | 'fast' | 'normal' } {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').slice(0, 20);

    // Look for a description in comments
    let description = '';
    for (const line of lines) {
      // Match JSDoc or single-line comment with description
      const jsdocMatch = line.match(/^\s*\*\s*(.+)$/);
      const singleMatch = line.match(/^\/\/\s*(.+)$/);
      if (jsdocMatch && jsdocMatch[1].length > 10 && !jsdocMatch[1].includes('@')) {
        description = jsdocMatch[1].trim();
        break;
      }
      if (singleMatch && singleMatch[1].length > 10) {
        description = singleMatch[1].trim();
        break;
      }
    }

    // Determine category from file name patterns
    let category: 'long' | 'fast' | 'normal' = 'normal';
    if (fileName.includes('pipeline')) {
      category = 'long';
    } else if (
      fileName.includes('calculate') ||
      fileName.includes('extract') ||
      fileName.includes('export') ||
      fileName.includes('compare')
    ) {
      category = 'fast';
    }

    return {
      description: description || `Run ${fileName}`,
      category,
    };
  } catch {
    return {
      description: `Run ${fileName}`,
      category: 'normal',
    };
  }
}

/**
 * Get the category badge for display
 */
export function getCategoryBadge(category: 'long' | 'fast' | 'normal'): { text: string; color: string } | null {
  switch (category) {
    case 'long':
      return { text: 'LONG', color: 'red' };
    case 'fast':
      return { text: 'FAST', color: 'green' };
    default:
      return null;
  }
}
