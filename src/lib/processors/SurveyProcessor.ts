/**
 * SurveyProcessor.ts
 *
 * Converts survey DOCX documents to markdown for agent consumption.
 * Uses LibreOffice for DOCX → HTML conversion, then turndown for HTML → Markdown.
 *
 * Preserves critical formatting:
 * - Strikethrough (converted to ~~text~~) - essential for skip logic extraction
 * - Tables (converted to proper Markdown table syntax via GFM plugin) - preserves
 *   row/column structure for complex survey grids
 *
 * Part of VerificationAgent and SkipLogicAgent pipelines - provides survey context.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { pathToFileURL } from 'url';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const execFileAsync = promisify(execFile);

// ===== TYPES =====

export interface SurveyResult {
  markdown: string;
  characterCount: number;
  warnings: string[];
}

export interface SurveyProcessorOptions {
  /** Keep intermediate HTML file for debugging */
  keepHtml?: boolean;
  /** Custom LibreOffice path (defaults to macOS location) */
  libreOfficePath?: string;
}

// ===== CONSTANTS =====

const DEFAULT_LIBREOFFICE_PATHS = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
];

const HTML_DETECTION_MAX_ATTEMPTS = 20;
const HTML_DETECTION_RETRY_MS = 150;
const HTML_READ_MAX_ATTEMPTS = 6;
const HTML_READ_RETRY_MS = 100;

// ===== COLOR SEMANTICS =====

/**
 * Classify a hex color into a semantic category.
 * Blue = programming notes (ASK IF, RANDOMIZE, routing logic)
 * Red = termination criteria (TERMINATE, CONTINUE)
 */
function classifyColor(hex: string): 'prog' | 'term' | null {
  if (hex.length !== 6) return null;
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  if (r > 180 && g < 100 && b < 100) return 'term';
  if (b > 140 && r < 100) return 'prog';
  return null;
}

/**
 * Process nested <font color="#hex"> tags using a state-machine scanner.
 *
 * LibreOffice nests font tags deeply:
 *   <font face><font size><font color><font face><font size>text</font></font></font></font></font>
 *
 * Simple regex can't match the color font's closing tag because of nesting.
 * This scanner finds <font color="#hex">, tracks nesting depth to find the
 * matching </font>, and wraps the content with {{PROG: ...}} or {{TERM: ...}}.
 */
function processColorFonts(html: string): string {
  const result: string[] = [];
  let i = 0;

  while (i < html.length) {
    // Look for <font color=
    const fontColorIdx = html.indexOf('<font color=', i);
    if (fontColorIdx === -1) {
      result.push(html.slice(i));
      break;
    }

    // Push everything before this tag
    result.push(html.slice(i, fontColorIdx));

    // Extract the hex color from the tag
    const tagEnd = html.indexOf('>', fontColorIdx);
    if (tagEnd === -1) {
      result.push(html.slice(fontColorIdx));
      break;
    }

    const tagStr = html.slice(fontColorIdx, tagEnd + 1);
    const colorMatch = tagStr.match(/color=["']#?([0-9a-fA-F]{6})["']/);
    const hex = colorMatch ? colorMatch[1].toLowerCase() : null;
    const category = hex ? classifyColor(hex) : null;

    // Now find the matching </font> by tracking depth
    let depth = 1;
    let j = tagEnd + 1;
    while (j < html.length && depth > 0) {
      const nextOpen = html.indexOf('<font', j);
      const nextClose = html.indexOf('</font>', j);

      if (nextClose === -1) {
        // No closing tag found, bail
        j = html.length;
        break;
      }

      if (nextOpen !== -1 && nextOpen < nextClose) {
        // Found a nested <font> before the next </font>
        depth++;
        j = html.indexOf('>', nextOpen) + 1;
      } else {
        // Found </font>
        depth--;
        if (depth === 0) {
          // This is our matching close
          const innerHtml = html.slice(tagEnd + 1, nextClose);
          if (category) {
            const marker = category === 'prog' ? 'PROG' : 'TERM';
            result.push(`{{${marker}: ${innerHtml}}}`);
          } else {
            // Unclassified color — pass through inner content without the font tag
            result.push(innerHtml);
          }
          j = nextClose + '</font>'.length;
          break;
        } else {
          j = nextClose + '</font>'.length;
        }
      }
    }

    i = j;
  }

  return result.join('');
}

/**
 * Extract clean text from a table cell's HTML.
 *
 * 1. Run color font processor (handles nesting)
 * 2. Convert <b> → **, <strike>/<s>/<del> → ~~
 * 3. Strip all remaining HTML tags
 * 4. Normalize whitespace, trim
 * 5. Decode HTML entities
 */
function extractCellText(cellHtml: string): string {
  let text = cellHtml;

  // Process color semantics first (before stripping tags)
  text = processColorFonts(text);

  // Convert bold
  text = text.replace(/<b\b[^>]*>(.*?)<\/b>/gi, '**$1**');

  // Convert strikethrough (all three tag types)
  text = text.replace(/<(?:strike|s|del)\b[^>]*>(.*?)<\/(?:strike|s|del)>/gi, '~~$1~~');

  // Convert <br> to space (table cells are single-line in markdown)
  text = text.replace(/<br\s*\/?>/gi, ' ');

  // Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)));

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Clean up empty bold/strikethrough markers
  text = text.replace(/\*\*\s*\*\*/g, '');
  text = text.replace(/~~\s*~~/g, '');

  return text;
}

/**
 * Convert HTML <table> blocks to markdown tables before Turndown processes them.
 *
 * LibreOffice's HTML tables lack <thead>, so the Turndown GFM plugin skips them.
 * This pre-processor extracts tables from the raw HTML string, converts them to
 * markdown table syntax, and replaces them inline so Turndown only sees clean markdown.
 */
function preprocessHtmlTables(html: string): string {
  // Find all <table>...</table> blocks
  const tableRegex = /<table\b[^>]*>[\s\S]*?<\/table>/gi;

  return html.replace(tableRegex, (tableHtml) => {
    try {
      // Extract rows
      const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
      const rows: string[][] = [];
      let rowMatch;

      while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
        const rowHtml = rowMatch[1];
        const cells: string[] = [];

        // Extract cells (td or th)
        const cellRegex = /<(?:td|th)\b([^>]*)>([\s\S]*?)<\/(?:td|th)>/gi;
        let cellMatch;

        while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
          const attrs = cellMatch[1];
          const cellContent = cellMatch[2];
          const text = extractCellText(cellContent);
          cells.push(text);

          // Handle colspan — insert empty cells for spanned columns
          const colspanMatch = attrs.match(/colspan=["']?(\d+)["']?/i);
          if (colspanMatch) {
            const span = parseInt(colspanMatch[1], 10);
            for (let c = 1; c < span; c++) {
              cells.push('');
            }
          }
        }

        if (cells.length > 0) {
          rows.push(cells);
        }
      }

      // Need at least 2 rows (header + data) for a markdown table
      if (rows.length < 2) {
        if (rows.length === 1) {
          // Single row: render as a simple line
          return '\n' + rows[0].filter(c => c).join(' | ') + '\n';
        }
        // Empty table — pass through unchanged
        return tableHtml;
      }

      // Normalize column count (pad short rows with empty cells)
      const maxCols = Math.max(...rows.map(r => r.length));
      for (const row of rows) {
        while (row.length < maxCols) {
          row.push('');
        }
      }

      // Escape pipe characters in cell text
      const escapeCell = (cell: string) => cell.replace(/\|/g, '\\|');

      // Build markdown table
      const lines: string[] = [];
      // Header row
      lines.push('| ' + rows[0].map(escapeCell).join(' | ') + ' |');
      // Separator row
      lines.push('| ' + rows[0].map(() => '---').join(' | ') + ' |');
      // Data rows
      for (let r = 1; r < rows.length; r++) {
        lines.push('| ' + rows[r].map(escapeCell).join(' | ') + ' |');
      }

      return '\n' + lines.join('\n') + '\n';
    } catch {
      // If anything goes wrong, pass through original HTML
      return tableHtml;
    }
  });
}

/**
 * Merge adjacent same-type color markers that result from split <font> elements.
 * e.g., {{PROG: **[ASK**}}{{PROG:  ALL]}} → {{PROG: **[ASK ALL]**}}
 */
function mergeAdjacentColorMarkers(markdown: string): string {
  let prev = '';
  while (markdown !== prev) {
    prev = markdown;
    markdown = markdown.replace(
      /\{\{(PROG|TERM): ([^}]*)\}\}\s*\{\{\1: ([^}]*)\}\}/g,
      '{{$1: $2 $3}}'
    );
  }
  return markdown;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function findConvertedHtmlPath(
  conversionDir: string,
  expectedBasename: string,
): Promise<string | null> {
  const expectedPath = path.join(conversionDir, `${expectedBasename}.html`);

  for (let attempt = 1; attempt <= HTML_DETECTION_MAX_ATTEMPTS; attempt++) {
    try {
      const expectedStat = await fs.stat(expectedPath);
      if (expectedStat.size > 0) return expectedPath;
    } catch {
      // continue and look for fallback candidates
    }

    const entries = await fs.readdir(conversionDir).catch(() => []);
    const htmlCandidates = entries
      .filter(name => name.toLowerCase().endsWith('.html'))
      .map(name => path.join(conversionDir, name));

    const existingCandidates: Array<{ path: string; mtimeMs: number }> = [];
    for (const candidate of htmlCandidates) {
      try {
        const stat = await fs.stat(candidate);
        if (stat.size > 0) {
          existingCandidates.push({ path: candidate, mtimeMs: stat.mtimeMs });
        }
      } catch {
        // candidate disappeared; ignore
      }
    }

    if (existingCandidates.length === 1) {
      return existingCandidates[0].path;
    }

    if (existingCandidates.length > 1) {
      const exactBasename = existingCandidates.find(candidate =>
        path.basename(candidate.path, path.extname(candidate.path)).toLowerCase() === expectedBasename.toLowerCase(),
      );
      if (exactBasename) return exactBasename.path;

      existingCandidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return existingCandidates[0].path;
    }

    if (attempt < HTML_DETECTION_MAX_ATTEMPTS) {
      await wait(HTML_DETECTION_RETRY_MS);
    }
  }

  return null;
}

async function readNonEmptyTextFile(filePath: string): Promise<string | null> {
  for (let attempt = 1; attempt <= HTML_READ_MAX_ATTEMPTS; attempt++) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      if (content.length > 0) return content;
    } catch {
      // file may not be visible yet; retry
    }

    if (attempt < HTML_READ_MAX_ATTEMPTS) {
      await wait(HTML_READ_RETRY_MS);
    }
  }

  return null;
}

function getExecErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (typeof error === 'object' && error && 'stderr' in error) {
    const stderr = String((error as { stderr?: unknown }).stderr || '').trim();
    if (stderr) {
      return `${message} | stderr: ${stderr.slice(0, 400)}`;
    }
  }
  return message;
}

// ===== MAIN FUNCTION =====

/**
 * Process a survey DOCX file to markdown.
 *
 * @param docxPath - Path to the survey DOCX file
 * @param outputDir - Directory for intermediate files (HTML)
 * @param options - Processing options
 * @returns SurveyResult with markdown content and metadata
 */
export async function processSurvey(
  docxPath: string,
  outputDir: string,
  options: SurveyProcessorOptions = {}
): Promise<SurveyResult> {
  const warnings: string[] = [];
  const basename = path.basename(docxPath, path.extname(docxPath));
  let workDir: string | null = null;

  // Validate input file exists
  try {
    await fs.access(docxPath);
  } catch {
    return {
      markdown: '',
      characterCount: 0,
      warnings: [`Survey file not found: ${docxPath}`],
    };
  }

  // Find LibreOffice
  const libreOfficePath = options.libreOfficePath || (await findLibreOffice());
  if (!libreOfficePath) {
    return {
      markdown: '',
      characterCount: 0,
      warnings: ['LibreOffice not found. Install LibreOffice to process survey documents.'],
    };
  }

  try {
    await fs.mkdir(outputDir, { recursive: true });
    workDir = await fs.mkdtemp(path.join(outputDir, 'surveyproc-'));
    const conversionDir = path.join(workDir, 'conversion');
    const profileDir = path.join(workDir, 'profile');
    await fs.mkdir(conversionDir, { recursive: true });
    await fs.mkdir(profileDir, { recursive: true });

    // Step 1: DOCX → HTML via LibreOffice
    console.log('[SurveyProcessor] Converting DOCX to HTML...');
    await execFileAsync(
      libreOfficePath,
      [
        '--headless',
        '--nologo',
        '--nodefault',
        '--nolockcheck',
        '--norestore',
        `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
        '--convert-to',
        'html',
        '--outdir',
        conversionDir,
        docxPath,
      ]
    );

    // Step 2: Find and read HTML file
    const htmlPath = await findConvertedHtmlPath(conversionDir, basename);
    if (!htmlPath) {
      return {
        markdown: '',
        characterCount: 0,
        warnings: [`HTML conversion failed - file not created in ${conversionDir}`],
      };
    }
    const html = await readNonEmptyTextFile(htmlPath);
    if (!html) {
      return {
        markdown: '',
        characterCount: 0,
        warnings: [`HTML conversion failed - file was empty or unreadable: ${htmlPath}`],
      };
    }

    // Step 3: Pre-process HTML tables → markdown tables
    // LibreOffice's HTML tables lack <thead>, so the Turndown GFM plugin skips them.
    // This converts <table> blocks to markdown table syntax before Turndown runs.
    console.log('[SurveyProcessor] Pre-processing HTML tables...');
    const preprocessedHtml = preprocessHtmlTables(html);

    // Step 4: HTML → Markdown
    console.log('[SurveyProcessor] Converting HTML to Markdown...');
    const turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });

    // Use GFM plugin for proper table conversion (converts HTML tables to Markdown table syntax)
    turndown.use(gfm);

    // Preserve strikethrough formatting (critical for skip logic extraction)
    // LibreOffice converts DOCX strikethrough to <del>, <s>, or <strike> tags
    // Note: GFM plugin also handles strikethrough, but we keep this custom rule to ensure
    // all three tag types (DEL, S, STRIKE) are properly converted
    turndown.addRule('strikethrough', {
      filter: function (node) {
        return (
          node.nodeName === 'DEL' ||
          node.nodeName === 'S' ||
          node.nodeName === 'STRIKE'
        );
      },
      replacement: function (content) {
        // Convert to Markdown strikethrough syntax (~~text~~)
        return '~~' + content + '~~';
      },
    });

    // Capture color semantics from non-table colored text
    // (Table colors are already handled in preprocessHtmlTables via extractCellText)
    turndown.addRule('coloredText', {
      filter: function (node) {
        return node.nodeName === 'FONT' && !!node.getAttribute('color');
      },
      replacement: function (content, node) {
        const el = node as HTMLElement;
        const hex = (el.getAttribute('color') || '').replace('#', '').toLowerCase();
        const cat = classifyColor(hex);
        if (cat === 'prog') return `{{PROG: ${content.trim()}}}`;
        if (cat === 'term') return `{{TERM: ${content.trim()}}}`;
        return content;
      },
    });

    let markdown = turndown.turndown(preprocessedHtml);

    // Step 5: Merge adjacent color markers from split <font> elements
    markdown = mergeAdjacentColorMarkers(markdown);

    // Step 6: Optionally persist HTML for debugging
    if (options.keepHtml) {
      const debugHtmlPath = path.join(outputDir, `${basename}.html`);
      await fs.copyFile(htmlPath, debugHtmlPath).catch(() => {
        warnings.push(`Could not persist HTML file for debugging: ${debugHtmlPath}`);
      });
    }

    console.log(`[SurveyProcessor] Conversion complete: ${markdown.length} characters`);

    return {
      markdown,
      characterCount: markdown.length,
      warnings,
    };
  } catch (error) {
    const errorMessage = getExecErrorMessage(error);
    return {
      markdown: '',
      characterCount: 0,
      warnings: [`Survey conversion failed: ${errorMessage}`],
    };
  } finally {
    if (workDir) {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {
        warnings.push(`Could not clean up temp survey directory: ${workDir}`);
      });
    }
  }
}

// ===== HELPER FUNCTIONS =====

/**
 * Find LibreOffice installation path.
 */
async function findLibreOffice(): Promise<string | null> {
  for (const libPath of DEFAULT_LIBREOFFICE_PATHS) {
    try {
      await fs.access(libPath);
      return libPath;
    } catch {
      // Try next path
    }
  }
  return null;
}

/**
 * Extract a section of the survey around a specific question number.
 * Useful for context optimization when survey is too long.
 *
 * @param markdown - Full survey markdown
 * @param questionId - Question ID to find (e.g., "A1", "S8")
 * @param windowChars - Characters to include before/after match
 * @returns Extracted section or full markdown if not found
 */
export function extractQuestionSection(
  markdown: string,
  questionId: string,
  windowChars: number = 2000
): string {
  // Create regex pattern to find question (e.g., "A1.", "A1:", "A1 ", "A1)")
  const pattern = new RegExp(`\\b${questionId}[.:\\s)]`, 'i');
  const match = markdown.match(pattern);

  if (!match || match.index === undefined) {
    // Question not found, return full markdown
    return markdown;
  }

  const matchIndex = match.index;
  const start = Math.max(0, matchIndex - windowChars);
  const end = Math.min(markdown.length, matchIndex + windowChars);

  // Try to start/end at line boundaries
  let adjustedStart = start;
  let adjustedEnd = end;

  if (start > 0) {
    const lineStart = markdown.lastIndexOf('\n', start);
    if (lineStart !== -1) {
      adjustedStart = lineStart + 1;
    }
  }

  if (end < markdown.length) {
    const lineEnd = markdown.indexOf('\n', end);
    if (lineEnd !== -1) {
      adjustedEnd = lineEnd;
    }
  }

  const section = markdown.slice(adjustedStart, adjustedEnd);

  // Add markers to show this is a section
  const prefix = adjustedStart > 0 ? '...\n\n' : '';
  const suffix = adjustedEnd < markdown.length ? '\n\n...' : '';

  return prefix + section + suffix;
}

/**
 * Get basic stats about the survey markdown.
 */
export function getSurveyStats(markdown: string): {
  characterCount: number;
  lineCount: number;
  estimatedTokens: number;
} {
  return {
    characterCount: markdown.length,
    lineCount: markdown.split('\n').length,
    // Rough estimate: ~4 chars per token for English text
    estimatedTokens: Math.ceil(markdown.length / 4),
  };
}
