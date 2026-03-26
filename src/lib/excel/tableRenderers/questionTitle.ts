function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripRepeatedIdPrefix(questionId: string, questionText: string): string {
  const trimmedId = questionId.trim();
  let text = questionText.trim();
  if (!trimmedId || !text) return text;

  const escapedId = escapeRegExp(trimmedId);
  const prefixRegex = new RegExp(
    `^${escapedId}(?=\\b|\\s|[.:)\\-])(?:\\s*[.:)\\-]\\s*|\\s+)`,
    'i',
  );

  // Some sources include repeated prefixes like "S1. S1: ...".
  for (let i = 0; i < 3; i++) {
    if (!prefixRegex.test(text)) break;
    text = text.replace(prefixRegex, '').trim();
  }

  return text;
}

export function formatQuestionTitle(questionId: string, questionText: string): string {
  const normalizedId = questionId.trim();
  const normalizedText = stripRepeatedIdPrefix(normalizedId, questionText);

  if (!normalizedId) return normalizedText;
  if (!normalizedText) return normalizedId;
  return `${normalizedId}. ${normalizedText}`;
}
