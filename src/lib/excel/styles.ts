/**
 * Excel Styles for Crosstab Formatting
 *
 * Two style sets:
 * - Stacked: Vertical stacking format (3 rows per answer)
 * - Standard: Horizontal layout with minimal borders, colored sections
 *
 * Supports per-render theming via runWithExcelTheme().
 * Renderers import FILLS/FONTS/getGroupFill which are resolved from AsyncLocalStorage,
 * so concurrent workbook renders cannot mutate each other's style state.
 */

import type { Fill, Borders, Font, Alignment, Border } from 'exceljs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getTheme, type ThemePalette } from './themes';

// =============================================================================
// Base colors (ARGB format for ExcelJS)
// =============================================================================

const BASE_COLORS: Record<string, string> = {
  // Header colors (stacked format)
  titleBackground: 'FFE0E0E0',      // Light gray for title row
  groupHeaderBackground: 'FFD9E1F2', // Light blue for group/column headers
  baseRowBackground: 'FFFFF2CC',    // Light yellow for base n row
  labelColumnBackground: 'FFE2EFDA', // Light teal for row labels

  // Data colors
  dataBackground: 'FFFFFFFF',       // White for data cells

  // Border colors
  borderDark: 'FF000000',           // Black for borders
  borderLight: 'FFD0D0D0',          // Light gray for thin borders

  // Text colors
  textPrimary: 'FF000000',          // Black
  textSecondary: 'FF666666',        // Gray for secondary text

  // Standard format colors
  sigLetterRed: 'FFCC0000',         // Red for significance letters

  // Standard format - section colors
  stdContext: 'FFE4DFEC',           // Purple/lavender for context column
  stdBase: 'FFE4DFEC',              // Purple/lavender for base row
  stdLabel: 'FFFFF2CC',             // Yellow for label column (answer options)
  stdHeader: 'FFDCE6F1',            // Light blue for header/banner area
  stdHeaderStatLetter: 'FFDCE6F1',  // Same blue for stat letter row
  stdDataAlt1: 'FFDCE6F1',          // Light blue for alternating data (cut group 1)
  stdDataAlt2: 'FFFFFFFF',          // White for alternating data

  // Standard format - banner group data colors (rotating palette)
  // Each group has two shades (A = lighter, B = slightly darker) for row alternation
  stdGroup0A: 'FFDCE6F1',           // Light blue (Total) - shade A
  stdGroup0B: 'FFC5D9F1',           // Light blue - shade B (slightly darker)
  stdGroup1A: 'FFE2EFDA',           // Light green - shade A
  stdGroup1B: 'FFD4E6C8',           // Light green - shade B
  stdGroup2A: 'FFFFF2CC',           // Light yellow - shade A
  stdGroup2B: 'FFFFE699',           // Light yellow - shade B
  stdGroup3A: 'FFFCE4D6',           // Light peach/orange - shade A
  stdGroup3B: 'FFF8CBAD',           // Light peach/orange - shade B
  stdGroup4A: 'FFE4DFEC',           // Light purple - shade A
  stdGroup4B: 'FFD9D2E9',           // Light purple - shade B
  stdGroup5A: 'FFDAEEF3',           // Light teal - shade A
  stdGroup5B: 'FFCBE4EE',           // Light teal - shade B
};

// =============================================================================
// Fills
// =============================================================================

const BASE_FILLS: Record<string, Fill> = {
  // Stacked format fills
  title: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.titleBackground },
  },
  groupHeader: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.groupHeaderBackground },
  },
  baseRow: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.baseRowBackground },
  },
  labelColumn: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.labelColumnBackground },
  },
  data: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.dataBackground },
  },

  // Standard format fills
  stdContext: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.stdContext },
  },
  stdBase: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.stdBase },
  },
  stdLabel: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.stdLabel },
  },
  stdHeader: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.stdHeader },
  },
  stdDataWhite: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.dataBackground },
  },
  stdDataBlue: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.stdDataAlt1 },
  },

  // Standard format - banner group fills (rotating palette for data cells)
  // Shade A (lighter) - used for even rows (0, 2, 4, ...)
  stdGroup0A: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.stdGroup0A },
  },
  stdGroup1A: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.stdGroup1A },
  },
  stdGroup2A: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.stdGroup2A },
  },
  stdGroup3A: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.stdGroup3A },
  },
  stdGroup4A: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.stdGroup4A },
  },
  stdGroup5A: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.stdGroup5A },
  },
  // Shade B (slightly darker) - used for odd rows (1, 3, 5, ...)
  stdGroup0B: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.stdGroup0B },
  },
  stdGroup1B: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.stdGroup1B },
  },
  stdGroup2B: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.stdGroup2B },
  },
  stdGroup3B: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.stdGroup3B },
  },
  stdGroup4B: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.stdGroup4B },
  },
  stdGroup5B: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: BASE_COLORS.stdGroup5B },
  },
};

interface ThemeStyleOverrides {
  colors: Partial<Record<string, string>>;
  fills: Partial<Record<string, Fill>>;
  fonts: Partial<Record<string, Partial<Font>>>;
}

const themeOverrideStorage = new AsyncLocalStorage<ThemeStyleOverrides>();

function makeFill(argb: string): Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function createThemeOverrides(name: string): ThemeStyleOverrides {
  const palette: ThemePalette = getTheme(name);
  const colors: ThemeStyleOverrides['colors'] = {
    stdContext: palette.context,
    stdBase: palette.base,
    stdLabel: palette.label,
    stdHeader: palette.header,
    stdHeaderStatLetter: palette.header,
    stdDataAlt1: palette.groups[0].a,
    sigLetterRed: palette.sigLetter,
  };
  const fills: ThemeStyleOverrides['fills'] = {
    stdContext: makeFill(palette.context),
    stdBase: makeFill(palette.base),
    stdLabel: makeFill(palette.label),
    stdHeader: makeFill(palette.header),
    stdDataBlue: makeFill(palette.groups[0].a),
  };

  for (let i = 0; i < 6; i++) {
    const group = palette.groups[i % palette.groups.length];
    colors[`stdGroup${i}A`] = group.a;
    colors[`stdGroup${i}B`] = group.b;
    fills[`stdGroup${i}A`] = makeFill(group.a);
    fills[`stdGroup${i}B`] = makeFill(group.b);
  }

  return {
    colors,
    fills,
    fonts: {
      significanceLetterRed: {
        bold: true,
        size: 10,
        color: { argb: palette.sigLetter },
      },
      stdStatLetterRed: {
        bold: false,
        size: 10,
        color: { argb: palette.sigLetter },
      },
    },
  };
}

function createStyleProxy<T extends Record<string, unknown>>(
  base: T,
  getOverrides: () => Partial<Record<string, unknown>>,
): T {
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') {
        const overrides = getOverrides();
        if (Object.prototype.hasOwnProperty.call(overrides, prop)) {
          return overrides[prop];
        }
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(getOverrides(), prop)) {
        return true;
      }
      return Reflect.has(target, prop);
    },
    ownKeys(target) {
      const overrideKeys = Object.keys(getOverrides());
      return Array.from(new Set([...Reflect.ownKeys(target), ...overrideKeys]));
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === 'string') {
        const overrides = getOverrides();
        if (Object.prototype.hasOwnProperty.call(overrides, prop)) {
          return {
            value: overrides[prop],
            enumerable: true,
            configurable: true,
            writable: false,
          };
        }
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  });
}

function getThemeOverrides(): ThemeStyleOverrides | null {
  return themeOverrideStorage.getStore() ?? null;
}

export function runWithExcelTheme<T>(
  themeName: string | undefined,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  if (!themeName || themeName === 'classic') {
    return fn();
  }
  return themeOverrideStorage.run(createThemeOverrides(themeName), fn);
}

export const COLORS: Record<string, string> = createStyleProxy(BASE_COLORS, () => getThemeOverrides()?.colors ?? {});
export const FILLS: Record<string, Fill> = createStyleProxy(BASE_FILLS, () => getThemeOverrides()?.fills ?? {});

// Helper to get group fill by index and row (cycles through available colors, alternates shades)
export function getGroupFill(groupIndex: number, rowIndex: number = 0): Fill {
  const isEvenRow = rowIndex % 2 === 0;

  // Shade A fills (lighter) for even rows
  const groupFillsA = [
    FILLS.stdGroup0A,
    FILLS.stdGroup1A,
    FILLS.stdGroup2A,
    FILLS.stdGroup3A,
    FILLS.stdGroup4A,
    FILLS.stdGroup5A,
  ];

  // Shade B fills (slightly darker) for odd rows
  const groupFillsB = [
    FILLS.stdGroup0B,
    FILLS.stdGroup1B,
    FILLS.stdGroup2B,
    FILLS.stdGroup3B,
    FILLS.stdGroup4B,
    FILLS.stdGroup5B,
  ];

  const fills = isEvenRow ? groupFillsA : groupFillsB;
  return fills[groupIndex % fills.length];
}

// Helper to get group fill shade A only (for spacer columns, headers, etc.)
export function getGroupFillShadeA(groupIndex: number): Fill {
  const groupFillsA = [
    FILLS.stdGroup0A,
    FILLS.stdGroup1A,
    FILLS.stdGroup2A,
    FILLS.stdGroup3A,
    FILLS.stdGroup4A,
    FILLS.stdGroup5A,
  ];
  return groupFillsA[groupIndex % groupFillsA.length];
}

// =============================================================================
// Border Styles
// =============================================================================

const thinBorderStyle: Partial<Border> = { style: 'thin', color: { argb: BASE_COLORS.borderDark } };
const mediumBorderStyle: Partial<Border> = { style: 'medium', color: { argb: BASE_COLORS.borderDark } };

export const BORDERS: Record<string, Partial<Borders>> = {
  // All sides thin
  thin: {
    top: thinBorderStyle,
    left: thinBorderStyle,
    bottom: thinBorderStyle,
    right: thinBorderStyle,
  },
  // All sides medium (for box around table)
  medium: {
    top: mediumBorderStyle,
    left: mediumBorderStyle,
    bottom: mediumBorderStyle,
    right: mediumBorderStyle,
  },
  // Heavy right border (between groups)
  groupSeparatorRight: {
    top: thinBorderStyle,
    left: thinBorderStyle,
    bottom: thinBorderStyle,
    right: mediumBorderStyle,
  },
  // Heavy left border (start of new group)
  groupSeparatorLeft: {
    top: thinBorderStyle,
    left: mediumBorderStyle,
    bottom: thinBorderStyle,
    right: thinBorderStyle,
  },
  // Top border only (for table box top)
  boxTop: {
    top: mediumBorderStyle,
  },
  // Bottom border only (for table box bottom)
  boxBottom: {
    bottom: mediumBorderStyle,
  },
  // Left border only (for table box left)
  boxLeft: {
    left: mediumBorderStyle,
  },
  // Right border only (for table box right)
  boxRight: {
    right: mediumBorderStyle,
  },
};

// =============================================================================
// Standard Format Borders - Minimal, structural only
// =============================================================================

// Double-line border style for group separation
const doubleBorderStyle: Partial<Border> = { style: 'double', color: { argb: BASE_COLORS.borderDark } };

export const STD_BORDERS: Record<string, Partial<Borders>> = {
  // No border (default for most cells)
  none: {},

  // Double-line border for group separation (standard format)
  doubleRight: {
    right: doubleBorderStyle,
  },
  doubleLeft: {
    left: doubleBorderStyle,
  },

  // Thick borders for structural separation
  thickTop: {
    top: mediumBorderStyle,
  },
  thickBottom: {
    bottom: mediumBorderStyle,
  },
  thickLeft: {
    left: mediumBorderStyle,
  },
  thickRight: {
    right: mediumBorderStyle,
  },

  // Combined structural borders
  thickTopLeft: {
    top: mediumBorderStyle,
    left: mediumBorderStyle,
  },
  thickTopRight: {
    top: mediumBorderStyle,
    right: mediumBorderStyle,
  },
  thickBottomLeft: {
    bottom: mediumBorderStyle,
    left: mediumBorderStyle,
  },
  thickBottomRight: {
    bottom: mediumBorderStyle,
    right: mediumBorderStyle,
  },
  thickLeftRight: {
    left: mediumBorderStyle,
    right: mediumBorderStyle,
  },
  thickTopBottom: {
    top: mediumBorderStyle,
    bottom: mediumBorderStyle,
  },

  // Three-sided borders
  thickTopLeftRight: {
    top: mediumBorderStyle,
    left: mediumBorderStyle,
    right: mediumBorderStyle,
  },
  thickBottomLeftRight: {
    bottom: mediumBorderStyle,
    left: mediumBorderStyle,
    right: mediumBorderStyle,
  },
  thickTopBottomLeft: {
    top: mediumBorderStyle,
    bottom: mediumBorderStyle,
    left: mediumBorderStyle,
  },
  thickTopBottomRight: {
    top: mediumBorderStyle,
    bottom: mediumBorderStyle,
    right: mediumBorderStyle,
  },

  // All sides thick (for special cells)
  thickAll: {
    top: mediumBorderStyle,
    bottom: mediumBorderStyle,
    left: mediumBorderStyle,
    right: mediumBorderStyle,
  },
};

// =============================================================================
// Fonts
// =============================================================================

const BASE_FONTS: Record<string, Partial<Font>> = {
  title: {
    bold: true,
    size: 11,
    color: { argb: BASE_COLORS.textPrimary },
  },
  header: {
    bold: true,
    size: 10,
    color: { argb: BASE_COLORS.textPrimary },
  },
  statLetter: {
    bold: false,
    size: 9,
    color: { argb: BASE_COLORS.textSecondary },
  },
  label: {
    bold: false,
    size: 10,
    color: { argb: BASE_COLORS.textPrimary },
  },
  labelNet: {
    bold: true,
    size: 10,
    color: { argb: BASE_COLORS.textPrimary },
  },
  data: {
    bold: false,
    size: 10,
    color: { argb: BASE_COLORS.textPrimary },
  },
  significance: {
    bold: false,
    size: 9,
    color: { argb: BASE_COLORS.textSecondary },
  },
  footer: {
    bold: false,
    size: 9,
    italic: true,
    color: { argb: BASE_COLORS.textSecondary },
  },
  // Standard format fonts
  significanceLetterRed: {
    bold: true,  // Bold to make sig letters pop
    size: 10,
    color: { argb: BASE_COLORS.sigLetterRed },
  },
  context: {
    bold: false,
    size: 10,
    color: { argb: BASE_COLORS.textPrimary },
  },
  // Standard format - bold base row
  stdBaseBold: {
    bold: true,
    italic: true,
    size: 10,
    color: { argb: BASE_COLORS.textPrimary },
  },
  // Standard format - red stat letters in header
  stdStatLetterRed: {
    bold: false,
    size: 10,
    color: { argb: BASE_COLORS.sigLetterRed },
  },
};

export const FONTS: Record<string, Partial<Font>> = createStyleProxy(
  BASE_FONTS,
  () => getThemeOverrides()?.fonts ?? {},
);

// =============================================================================
// Alignments
// =============================================================================

export const ALIGNMENTS: Record<string, Partial<Alignment>> = {
  left: {
    horizontal: 'left',
    vertical: 'middle',
  },
  center: {
    horizontal: 'center',
    vertical: 'middle',
  },
  right: {
    horizontal: 'right',
    vertical: 'middle',
  },
  wrapText: {
    horizontal: 'left',
    vertical: 'middle',
    wrapText: true,
  },
};

// =============================================================================
// Column Widths
// =============================================================================

export const COLUMN_WIDTHS = {
  label: 30,        // Row labels column
  data: 10,         // Data columns (n, %, etc.)
  statLetter: 6,    // Stat letter column width
  min: 8,           // Minimum column width
  max: 50,          // Maximum column width
} as const;

// Standard format column widths
export const COLUMN_WIDTHS_STD = {
  context: 25,      // Context/question column (merged per table)
  label: 35,        // Answer label column
  labelMaxDiff: 55, // Wider label column for MaxDiff message text (100+ chars)
  value: 15,        // Value columns (percent or count) - wider for readability
  significance: 5,  // Significance letter columns
  spacer: 2,        // Spacer columns between groups
} as const;

// =============================================================================
// Row Heights
// =============================================================================

export const ROW_HEIGHTS = {
  title: 20,        // Title row
  header: 18,       // Header rows
  data: 16,         // Data rows
  footer: 14,       // Footer rows
  gap: 8,           // Gap between tables
} as const;

// =============================================================================
// Table Spacing
// =============================================================================

export const TABLE_SPACING = {
  gapBetweenTables: 2,  // Number of blank rows between tables
  startRow: 1,          // Starting row for first table
  startCol: 1,          // Starting column (A = 1)
} as const;

/**
 * Hard-cutover guardrail: global theme mutation is intentionally removed.
 * Pass `theme` into `ExcelFormatter` options so render-local context is used.
 */
export function setActiveTheme(_name: string): never {
  throw new Error('setActiveTheme() is no longer supported. Pass `theme` via ExcelFormatter options.');
}
