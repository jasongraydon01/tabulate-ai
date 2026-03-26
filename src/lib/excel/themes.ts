/**
 * Excel Color Themes
 *
 * Defines semantic color palettes for crosstab workbooks.
 * Each theme provides colors for the same set of roles (header, label, base,
 * context, 6 banner group pairs, significance letters). Renderers don't change —
 * they read from FILLS/FONTS which are resolved in run-local style context.
 *
 * Usage:
 *   const formatter = new ExcelFormatter({ theme: 'coastal' });
 *   await formatter.formatFromJson(tablesJson);
 */

// =============================================================================
// Types
// =============================================================================

export interface ThemeGroupColors {
  a: string; // ARGB — lighter shade (even rows)
  b: string; // ARGB — slightly darker shade (odd rows)
}

export interface ThemePalette {
  name: string;
  displayName: string;

  // Structural fill colors (ARGB format)
  header: string;
  context: string;
  base: string;
  label: string;

  // 6 banner group color pairs (A = lighter, B = darker for alternating rows)
  groups: ThemeGroupColors[];

  // Accent colors
  sigLetter: string;
}

// =============================================================================
// Color Helpers
// =============================================================================

/**
 * Lighten a hex color toward white.
 * @param hex - 6-char hex string (no # prefix), e.g. "60C9FC"
 * @param amount - 0.0 = original color, 1.0 = pure white
 * @returns ARGB string for ExcelJS, e.g. "FFD4EFFD"
 */
function lighten(hex: string, amount: number): string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);

  const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  return `FF${toHex(lr)}${toHex(lg)}${toHex(lb)}`;
}

/**
 * Build A/B shade pair from an accent hex color.
 * A shade (lighter) for even rows, B shade (slightly darker) for odd rows.
 */
function makeGroup(hex: string): ThemeGroupColors {
  return {
    a: lighten(hex, 0.78),
    b: lighten(hex, 0.64),
  };
}

// =============================================================================
// Theme Definitions
// =============================================================================

/**
 * Classic — the original palette.
 * Hardcoded values preserved exactly as they were before theming was added.
 */
const classic: ThemePalette = {
  name: 'classic',
  displayName: 'Classic',

  header: 'FFDCE6F1',
  context: 'FFE4DFEC',
  base: 'FFE4DFEC',
  label: 'FFFFF2CC',

  groups: [
    { a: 'FFDCE6F1', b: 'FFC5D9F1' }, // Blue (Total)
    { a: 'FFE2EFDA', b: 'FFD4E6C8' }, // Green
    { a: 'FFFFF2CC', b: 'FFFFE699' }, // Yellow
    { a: 'FFFCE4D6', b: 'FFF8CBAD' }, // Peach
    { a: 'FFE4DFEC', b: 'FFD9D2E9' }, // Purple
    { a: 'FFDAEEF3', b: 'FFCBE4EE' }, // Teal
  ],

  sigLetter: 'FFCC0000',
};

/**
 * Coastal — sky blue, sand, warm orange, slate, taupe.
 * Source accents: #60C9FC, #BD9D77, #FCB660, #7798A7, #7D766E, #3E4C52
 */
const coastal: ThemePalette = {
  name: 'coastal',
  displayName: 'Coastal',

  header: lighten('60C9FC', 0.78),
  context: lighten('3E4C52', 0.80),
  base: lighten('3E4C52', 0.80),
  label: lighten('BD9D77', 0.82),

  groups: [
    makeGroup('60C9FC'), // Sky blue
    makeGroup('BD9D77'), // Sand
    makeGroup('FCB660'), // Orange
    makeGroup('7798A7'), // Slate blue
    makeGroup('7D766E'), // Taupe
    makeGroup('3E4C52'), // Dark teal
  ],

  sigLetter: 'FFCC0000',
};

/**
 * Blush — soft pinks, peach, mauve, lavender, coral.
 * Source accents: #F0D7D3, #F3C2A3, #CFB1BD, #D5D0DC, #EA946E
 */
const blush: ThemePalette = {
  name: 'blush',
  displayName: 'Blush',

  header: lighten('CFB1BD', 0.72),
  context: lighten('D5D0DC', 0.72),
  base: lighten('D5D0DC', 0.72),
  label: lighten('F0D7D3', 0.65),

  groups: [
    makeGroup('CFB1BD'), // Mauve
    makeGroup('F3C2A3'), // Peach
    makeGroup('F0D7D3'), // Blush pink
    makeGroup('D5D0DC'), // Lavender
    makeGroup('EA946E'), // Coral
    makeGroup('B8A8A0'), // Warm gray (derived)
  ],

  sigLetter: 'FFCC0000',
};

/**
 * Tropical — pink, indigo, teal, amber, cream.
 * Source accents: #F288A4, #4E5B98, #3FBFBF, #F2C36B, #F2E9D8
 */
const tropical: ThemePalette = {
  name: 'tropical',
  displayName: 'Tropical',

  header: lighten('3FBFBF', 0.78),
  context: lighten('4E5B98', 0.80),
  base: lighten('4E5B98', 0.80),
  label: lighten('F2C36B', 0.80),

  groups: [
    makeGroup('3FBFBF'), // Teal
    makeGroup('F288A4'), // Pink
    makeGroup('4E5B98'), // Indigo
    makeGroup('F2C36B'), // Amber
    makeGroup('F2E9D8'), // Cream
    makeGroup('7CB07C'), // Sage (derived)
  ],

  sigLetter: 'FFCC0000',
};

/**
 * Bold — navy, cream, gold, red, olive.
 * Source accents: #344164, #F4DEC7, #F8C74E, #E93F3F, #5F6B53
 */
const bold: ThemePalette = {
  name: 'bold',
  displayName: 'Bold',

  header: lighten('344164', 0.80),
  context: lighten('344164', 0.82),
  base: lighten('344164', 0.82),
  label: lighten('F4DEC7', 0.60),

  groups: [
    makeGroup('344164'), // Navy
    makeGroup('F4DEC7'), // Cream
    makeGroup('F8C74E'), // Gold
    makeGroup('E93F3F'), // Red
    makeGroup('5F6B53'), // Olive
    makeGroup('6883A0'), // Steel blue (derived)
  ],

  sigLetter: 'FFCC0000',
};

/**
 * Earth — brown, yellow, green, olive, red.
 * Source accents: #8B501B, #FFE797, #CCEFBE, #718444, #FF3333
 */
const earth: ThemePalette = {
  name: 'earth',
  displayName: 'Earth',

  header: lighten('CCEFBE', 0.72),
  context: lighten('8B501B', 0.80),
  base: lighten('8B501B', 0.80),
  label: lighten('FFE797', 0.65),

  groups: [
    makeGroup('8B501B'), // Brown
    makeGroup('FFE797'), // Yellow
    makeGroup('CCEFBE'), // Mint green
    makeGroup('718444'), // Olive
    makeGroup('FF3333'), // Red
    makeGroup('A67C52'), // Warm tan (derived)
  ],

  sigLetter: 'FFCC0000',
};

// =============================================================================
// Registry
// =============================================================================

export const THEMES: Record<string, ThemePalette> = {
  classic,
  coastal,
  blush,
  tropical,
  bold,
  earth,
};

export function getThemeNames(): string[] {
  return Object.keys(THEMES);
}

export function getTheme(name: string): ThemePalette {
  return THEMES[name] ?? THEMES.classic;
}
