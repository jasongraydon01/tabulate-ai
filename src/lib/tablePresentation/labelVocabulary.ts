import { z } from 'zod';

export const TABLE_LABEL_SLOT_ORDER = [
  'rankFormat',
  'topBoxFormat',
  'bottomBoxFormat',
  'meanLabel',
  'medianLabel',
  'stddevLabel',
  'stderrLabel',
  'totalLabel',
  'baseLabel',
  'netPrefix',
  'middleBoxLabel',
  'notRankedLabel',
  'npsScoreLabel',
  'promotersLabel',
  'passivesLabel',
  'detractorsLabel',
] as const;

export type TableLabelSlot = (typeof TABLE_LABEL_SLOT_ORDER)[number];

export const TABLE_LABEL_SLOT_LABELS: Record<TableLabelSlot, string> = {
  rankFormat: 'Ranking label format',
  topBoxFormat: 'Top box label format',
  bottomBoxFormat: 'Bottom box label format',
  meanLabel: 'Mean label',
  medianLabel: 'Median label',
  stddevLabel: 'Standard deviation label',
  stderrLabel: 'Standard error label',
  totalLabel: 'Total column label',
  baseLabel: 'Base row label',
  netPrefix: 'NET prefix',
  middleBoxLabel: 'Middle box label',
  notRankedLabel: 'Not ranked label',
  npsScoreLabel: 'NPS score label',
  promotersLabel: 'Promoters label',
  passivesLabel: 'Passives label',
  detractorsLabel: 'Detractors label',
};

export const TableLabelVocabularySchema = z.object({
  rankFormat: z.string().min(1).default('Ranked {ordinal}'),
  topBoxFormat: z.string().min(1).default('Top {N} Box'),
  bottomBoxFormat: z.string().min(1).default('Bottom {N} Box'),
  meanLabel: z.string().min(1).default('Mean'),
  medianLabel: z.string().min(1).default('Median'),
  stddevLabel: z.string().min(1).default('Std Dev'),
  stderrLabel: z.string().min(1).default('Std Err'),
  totalLabel: z.string().min(1).default('Total'),
  baseLabel: z.string().min(1).default('Base (n)'),
  netPrefix: z.string().default('NET: '),
  middleBoxLabel: z.string().min(1).default('Middle'),
  notRankedLabel: z.string().min(1).default('Not Ranked'),
  npsScoreLabel: z.string().min(1).default('NPS Score'),
  promotersLabel: z.string().min(1).default('Promoters'),
  passivesLabel: z.string().min(1).default('Passives'),
  detractorsLabel: z.string().min(1).default('Detractors'),
});

export const TablePresentationConfigSchema = z.object({
  labelVocabulary: TableLabelVocabularySchema.default(TableLabelVocabularySchema.parse({})),
});

export type TableLabelVocabulary = z.infer<typeof TableLabelVocabularySchema>;
export type TablePresentationConfig = z.infer<typeof TablePresentationConfigSchema>;

export const DEFAULT_TABLE_LABEL_VOCABULARY: TableLabelVocabulary = TableLabelVocabularySchema.parse({});

const ORDINAL_WORDS = [
  '',
  'First',
  'Second',
  'Third',
  'Fourth',
  'Fifth',
  'Sixth',
  'Seventh',
  'Eighth',
  'Ninth',
  'Tenth',
  'Eleventh',
  'Twelfth',
  'Thirteenth',
  'Fourteenth',
  'Fifteenth',
  'Sixteenth',
  'Seventeenth',
  'Eighteenth',
  'Nineteenth',
  'Twentieth',
  'Twenty-First',
  'Twenty-Second',
  'Twenty-Third',
  'Twenty-Fourth',
  'Twenty-Fifth',
  'Twenty-Sixth',
  'Twenty-Seventh',
  'Twenty-Eighth',
  'Twenty-Ninth',
  'Thirtieth',
];

const DEFAULT_LABEL_LOOKUP = {
  topBoxFormat: DEFAULT_TABLE_LABEL_VOCABULARY.topBoxFormat,
  bottomBoxFormat: DEFAULT_TABLE_LABEL_VOCABULARY.bottomBoxFormat,
  middleBoxLabel: DEFAULT_TABLE_LABEL_VOCABULARY.middleBoxLabel,
  meanLabel: DEFAULT_TABLE_LABEL_VOCABULARY.meanLabel,
  medianLabel: DEFAULT_TABLE_LABEL_VOCABULARY.medianLabel,
  stddevLabel: DEFAULT_TABLE_LABEL_VOCABULARY.stddevLabel,
  stderrLabel: DEFAULT_TABLE_LABEL_VOCABULARY.stderrLabel,
  notRankedLabel: DEFAULT_TABLE_LABEL_VOCABULARY.notRankedLabel,
  npsScoreLabel: DEFAULT_TABLE_LABEL_VOCABULARY.npsScoreLabel,
  promotersLabel: DEFAULT_TABLE_LABEL_VOCABULARY.promotersLabel,
  passivesLabel: DEFAULT_TABLE_LABEL_VOCABULARY.passivesLabel,
  detractorsLabel: DEFAULT_TABLE_LABEL_VOCABULARY.detractorsLabel,
} as const;

const DEFAULT_TITLE_LOOKUP = {
  meanLabel: 'Mean Summary',
  npsScoreLabel: 'Net Promoter Score Summary',
  middleBoxLabel: 'Middle Box Summary',
} as const;

export function resolveTablePresentationConfig(
  value: unknown,
): TablePresentationConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { labelVocabulary: DEFAULT_TABLE_LABEL_VOCABULARY };
  }
  return TablePresentationConfigSchema.parse(value);
}

export function resolveTableLabelVocabulary(
  value: unknown,
): TableLabelVocabulary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_TABLE_LABEL_VOCABULARY;
  }
  return TableLabelVocabularySchema.parse(value);
}

export function formatOrdinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  const mod10 = value % 10;
  if (mod10 === 1) return `${value}st`;
  if (mod10 === 2) return `${value}nd`;
  if (mod10 === 3) return `${value}rd`;
  return `${value}th`;
}

export function ordinalWord(value: number): string {
  if (ORDINAL_WORDS[value]) return ORDINAL_WORDS[value];
  return `${value}th`;
}

export function renderLabelTemplate(
  template: string,
  params: { N: number },
): string {
  return template
    .replaceAll('{N}', String(params.N))
    .replaceAll('{ordinal}', formatOrdinal(params.N))
    .replaceAll('{word}', ordinalWord(params.N));
}

export function getRankLabel(rank: number, vocabulary: TableLabelVocabulary): string {
  return renderLabelTemplate(vocabulary.rankFormat, { N: rank });
}

export function getTopBoxLabel(width: number, vocabulary: TableLabelVocabulary): string {
  return renderLabelTemplate(vocabulary.topBoxFormat, { N: width });
}

export function getBottomBoxLabel(width: number, vocabulary: TableLabelVocabulary): string {
  return renderLabelTemplate(vocabulary.bottomBoxFormat, { N: width });
}

export function getDisplayBannerLabel(name: string, vocabulary: TableLabelVocabulary): string {
  return name === 'Total' ? vocabulary.totalLabel : name;
}

export function rewriteGeneratedRowLabel(
  label: string,
  vocabulary: TableLabelVocabulary,
): string {
  const trimmed = label.trim();
  if (!trimmed) return label;

  const rankMatch = trimmed.match(/^Ranked (\d+)(?:st|nd|rd|th)$/);
  if (rankMatch) {
    return getRankLabel(Number(rankMatch[1]), vocabulary);
  }

  const topBoxMatch = trimmed.match(/^Top (\d+) Box$/);
  if (topBoxMatch) {
    return getTopBoxLabel(Number(topBoxMatch[1]), vocabulary);
  }

  const bottomBoxMatch = trimmed.match(/^Bottom (\d+) Box$/);
  if (bottomBoxMatch) {
    return getBottomBoxLabel(Number(bottomBoxMatch[1]), vocabulary);
  }

  if (trimmed === DEFAULT_LABEL_LOOKUP.middleBoxLabel) {
    return vocabulary.middleBoxLabel;
  }
  if (trimmed === DEFAULT_LABEL_LOOKUP.meanLabel) {
    return vocabulary.meanLabel;
  }
  if (trimmed === DEFAULT_LABEL_LOOKUP.medianLabel) {
    return vocabulary.medianLabel;
  }
  if (trimmed === DEFAULT_LABEL_LOOKUP.stddevLabel) {
    return vocabulary.stddevLabel;
  }
  if (trimmed === DEFAULT_LABEL_LOOKUP.stderrLabel) {
    return vocabulary.stderrLabel;
  }
  if (trimmed === DEFAULT_LABEL_LOOKUP.notRankedLabel) {
    return vocabulary.notRankedLabel;
  }
  if (trimmed === DEFAULT_LABEL_LOOKUP.npsScoreLabel) {
    return vocabulary.npsScoreLabel;
  }
  if (trimmed === DEFAULT_LABEL_LOOKUP.promotersLabel) {
    return vocabulary.promotersLabel;
  }
  if (trimmed === DEFAULT_LABEL_LOOKUP.passivesLabel) {
    return vocabulary.passivesLabel;
  }
  if (trimmed === DEFAULT_LABEL_LOOKUP.detractorsLabel) {
    return vocabulary.detractorsLabel;
  }
  if (trimmed.startsWith(DEFAULT_TABLE_LABEL_VOCABULARY.netPrefix)) {
    return `${vocabulary.netPrefix}${trimmed.slice(DEFAULT_TABLE_LABEL_VOCABULARY.netPrefix.length)}`;
  }

  return label;
}

export function rewriteGeneratedSubtitle(
  subtitle: string,
  vocabulary: TableLabelVocabulary,
): string {
  const trimmed = subtitle.trim();
  if (!trimmed) return subtitle;

  const rankMatch = trimmed.match(/^Ranked (\d+)(?:st|nd|rd|th) Summary$/);
  if (rankMatch) {
    return `${getRankLabel(Number(rankMatch[1]), vocabulary)} Summary`;
  }

  const topBoxMatch = trimmed.match(/^Top (\d+) Box Summary$/);
  if (topBoxMatch) {
    return `${getTopBoxLabel(Number(topBoxMatch[1]), vocabulary)} Summary`;
  }

  const bottomBoxMatch = trimmed.match(/^Bottom (\d+) Box Summary$/);
  if (bottomBoxMatch) {
    return `${getBottomBoxLabel(Number(bottomBoxMatch[1]), vocabulary)} Summary`;
  }

  if (trimmed === DEFAULT_TITLE_LOOKUP.middleBoxLabel) {
    return `${vocabulary.middleBoxLabel} Box Summary`;
  }
  if (trimmed === DEFAULT_TITLE_LOOKUP.meanLabel) {
    return `${vocabulary.meanLabel} Summary`;
  }
  if (trimmed === DEFAULT_TITLE_LOOKUP.npsScoreLabel) {
    return 'Net Promoter Score Summary';
  }

  return subtitle;
}

export function detectUsedLabelSlotsFromCanonicalTables(
  tables: Array<Record<string, unknown>>,
): TableLabelSlot[] {
  const used = new Set<TableLabelSlot>();

  for (const table of tables) {
    const subtitle = typeof table.tableSubtitle === 'string' ? table.tableSubtitle : '';
    const rows = Array.isArray(table.rows) ? table.rows : [];

    if (/^Ranked \d+(?:st|nd|rd|th) Summary$/.test(subtitle)) {
      used.add('rankFormat');
    }
    if (/^Top \d+ Box Summary$/.test(subtitle)) {
      used.add('topBoxFormat');
    }
    if (/^Bottom \d+ Box Summary$/.test(subtitle)) {
      used.add('bottomBoxFormat');
    }
    if (subtitle === 'Middle Box Summary') {
      used.add('middleBoxLabel');
    }

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      const label = typeof record.label === 'string' ? record.label : '';
      const statType = typeof record.statType === 'string' ? record.statType : '';

      if (/^Ranked \d+(?:st|nd|rd|th)$/.test(label)) {
        used.add('rankFormat');
      }
      if (/^Top \d+ Box$/.test(label)) {
        used.add('topBoxFormat');
      }
      if (/^Bottom \d+ Box$/.test(label)) {
        used.add('bottomBoxFormat');
      }
      if (label === 'Middle') {
        used.add('middleBoxLabel');
      }
      if (label === 'Not Ranked') {
        used.add('notRankedLabel');
      }
      if (label === 'Promoters') {
        used.add('promotersLabel');
      }
      if (label === 'Passives') {
        used.add('passivesLabel');
      }
      if (label === 'Detractors') {
        used.add('detractorsLabel');
      }
      if (label === 'NPS Score') {
        used.add('npsScoreLabel');
      }
      if (statType === 'mean' || label === 'Mean') {
        used.add('meanLabel');
      }
      if (statType === 'median' || label === 'Median') {
        used.add('medianLabel');
      }
      if (statType === 'stddev' || label === 'Std Dev') {
        used.add('stddevLabel');
      }
      if (statType === 'stderr' || label === 'Std Err') {
        used.add('stderrLabel');
      }
      if (label.startsWith('NET: ')) {
        used.add('netPrefix');
      }
    }
  }

  used.add('baseLabel');
  used.add('totalLabel');

  return TABLE_LABEL_SLOT_ORDER.filter((slot) => used.has(slot));
}
