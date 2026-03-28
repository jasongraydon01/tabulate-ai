const STEM_SEPARATOR_PATTERN = /[-:–—]/g;

function hasMeaningfulContent(input: string): boolean {
  return /[A-Za-z0-9]/.test(input);
}

export function normalizeDeterministicStemText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[‘’´`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s*([:;-])\s*/g, '$1')
    .replace(/[.?!,:;\-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function areDeterministicallyEquivalentLabelStems(a: string, b: string): boolean {
  const normalizedA = normalizeDeterministicStemText(a);
  const normalizedB = normalizeDeterministicStemText(b);
  if (!normalizedA || !normalizedB) return false;
  return normalizedA === normalizedB;
}

export function extractLabelSuffixAfterQuestionStem(
  label: string,
  questionText: string,
): string | null {
  const trimmedLabel = label.trim();
  const normalizedQuestion = normalizeDeterministicStemText(questionText);
  if (!trimmedLabel || !normalizedQuestion) return null;

  for (const match of trimmedLabel.matchAll(STEM_SEPARATOR_PATTERN)) {
    const idx = match.index ?? -1;
    if (idx <= 0) continue;

    const prefix = trimmedLabel.slice(0, idx).trim();
    const suffix = trimmedLabel.slice(idx + match[0].length).trim();
    if (!suffix || !hasMeaningfulContent(suffix)) continue;

    if (normalizeDeterministicStemText(prefix) === normalizedQuestion) {
      return suffix;
    }
  }

  return null;
}

export function stripTrailingQuestionStem(
  label: string,
  questionText: string,
): string | null {
  const trimmedLabel = label.trim();
  const normalizedQuestion = normalizeDeterministicStemText(questionText);
  if (!trimmedLabel || !normalizedQuestion) return null;

  for (const match of trimmedLabel.matchAll(STEM_SEPARATOR_PATTERN)) {
    const idx = match.index ?? -1;
    if (idx <= 0) continue;

    const prefix = trimmedLabel.slice(0, idx).trim();
    const suffix = trimmedLabel.slice(idx + match[0].length).trim();
    if (!prefix || !hasMeaningfulContent(prefix)) continue;

    if (normalizeDeterministicStemText(suffix) === normalizedQuestion) {
      return prefix;
    }
  }

  return null;
}

export function stripDeterministicQuestionStem(
  label: string,
  questionText: string,
): string | null {
  return stripTrailingQuestionStem(label, questionText)
    ?? extractLabelSuffixAfterQuestionStem(label, questionText);
}
