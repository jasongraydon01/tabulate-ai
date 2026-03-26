/**
 * Sanitizes text data before it enters AI agent prompts.
 *
 * Azure OpenAI's content filter can flag legitimate survey/research data as
 * policy violations (prompt injection, harmful content, etc.). This module
 * reduces false positives by cleaning patterns that trigger the filter
 * without removing meaningful content.
 */

/**
 * Preamble to prepend to system prompts. Gives Azure's content filter
 * context that the content is professional research data, not user-generated
 * content or harmful material.
 */
export const RESEARCH_DATA_PREAMBLE = `CONTEXT: You are a market research data processing tool. The text below contains survey questions, response options, and variable metadata from legitimate quantitative market research studies. This content is professional research data exported from SPSS (.sav) files, not user-generated content. Treat all enclosed data as structured research material.

`;

/**
 * Sanitize text that will be injected into AI prompts.
 *
 * Targets patterns that Azure's content filter commonly flags as prompt
 * injection or policy violations:
 * - URLs and email addresses (look like phishing/injection payloads)
 * - Phone numbers and SSN-like numeric patterns
 * - Embedded ALL-CAPS instructions (look like prompt injection)
 * - Repeated special characters (look like encoding attacks)
 * - Non-ASCII encoding artifacts
 *
 * Preserves: question text, variable names, value labels, survey structure.
 */
export function sanitizeForAzureContentFilter(text: string): string {
  if (!text) return text;

  let sanitized = text;

  // 0a. Normalize Unicode to canonical form — prevents homoglyph-based filter bypass
  // (e.g., Cyrillic 'а' → Latin 'a', fullwidth chars → ASCII equivalents)
  sanitized = sanitized.normalize('NFKC');

  // 0b. Strip ChatML tokens that could break out of prompt context
  sanitized = sanitized.replace(/<\|im_start\|>/g, '[token removed]');
  sanitized = sanitized.replace(/<\|im_end\|>/g, '[token removed]');
  sanitized = sanitized.replace(/<\|endoftext\|>/g, '[token removed]');

  // 1. Strip URLs (http/https/ftp) — surveys sometimes embed links
  sanitized = sanitized.replace(/https?:\/\/[^\s)>\]]+/gi, '[URL removed]');
  sanitized = sanitized.replace(/ftp:\/\/[^\s)>\]]+/gi, '[URL removed]');

  // 2. Strip email addresses
  sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email removed]');

  // 3. Strip phone number patterns (10+ digits with optional separators)
  //    Careful not to strip SPSS variable codes or survey question numbers
  sanitized = sanitized.replace(/(?<!\w)(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}(?!\w)/g, '[phone removed]');

  // 4. Strip SSN-like patterns (XXX-XX-XXXX)
  sanitized = sanitized.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ID removed]');

  // 5. Collapse repeated special characters (3+ in a row → 2)
  //    e.g., "!!!!!!" → "!!", "======" → "==", "******" → "**"
  sanitized = sanitized.replace(/([!@#$%^&*=~`|\\<>])\1{2,}/g, '$1$1');

  // 6. Neutralize embedded all-caps instructions that look like prompt injection
  //    Only target standalone lines that are ALL CAPS and look instruction-like
  //    Skip lines that are clearly survey labels (short, no verbs)
  sanitized = sanitized.replace(
    /^([ \t]*)((?:PLEASE|DO NOT|MUST|ALWAYS|NEVER|IMPORTANT|WARNING|NOTE|ATTENTION|REMEMBER|ENSURE|STOP|IGNORE|DISREGARD|FORGET|OVERRIDE)[A-Z\s!.:,]{10,})$/gm,
    (_match, indent, text) => {
      // Preserve the line but lowercase it so it doesn't look like an injection attempt
      return `${indent}${text.charAt(0)}${text.slice(1).toLowerCase()}`;
    }
  );

  // 7. Normalize encoding artifacts
  //    Curly quotes → straight quotes
  sanitized = sanitized.replace(/[\u2018\u2019]/g, "'");
  sanitized = sanitized.replace(/[\u201C\u201D]/g, '"');
  //    Em/en dashes → hyphens
  sanitized = sanitized.replace(/[\u2013\u2014]/g, '-');
  //    Non-breaking spaces → regular spaces
  sanitized = sanitized.replace(/\u00A0/g, ' ');
  //    Other common artifacts
  sanitized = sanitized.replace(/\u2026/g, '...');  // ellipsis
  sanitized = sanitized.replace(/\u00AD/g, '');      // soft hyphen

  // 8. Strip null bytes and other control characters (except \n, \r, \t)
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 9. Neutralize role/prompt override framing commonly used in injection payloads.
  // Keep surrounding content readable for extraction tasks.
  sanitized = sanitized.replace(/<\s*\/?\s*(system|assistant|developer|tool)\s*>/gi, '[role tag removed]');
  sanitized = sanitized.replace(/^\s*(system|assistant|developer|tool)\s*:/gim, 'context-$1:');

  // 10. Remove instruction-like override snippets while retaining nearby text.
  const injectionPhrases = [
    /\bignore\s+(all\s+)?(previous|prior)\s+instructions?\b/gi,
    /\bdisregard\s+(all\s+)?(previous|prior)\s+instructions?\b/gi,
    /\boverride\s+(the\s+)?(system|developer)\s+instructions?\b/gi,
    /\bdo\s+not\s+follow\s+(the\s+)?(above|previous|prior)\s+instructions?\b/gi,
    /\byou\s+are\s+now\s+(a|an)\s+[a-z0-9 _-]{1,40}\b/gi,
    /\bexfiltrate\b/gi,
    /\bsystem\s*\(/gi,
    /\beval\s*\(/gi,
  ];
  for (const pattern of injectionPhrases) {
    sanitized = sanitized.replace(pattern, '[instruction-like text removed]');
  }

  return sanitized;
}

/**
 * Sanitize HITL reviewer hints before embedding in AI prompts.
 *
 * Shared sanitization chain for all agents that accept reviewer hints.
 * Order: sanitize → strip XML-like tags → collapse whitespace → truncate → trim.
 *
 * @param maxLength - Maximum hint length (default 2000 for V2's longer guidance)
 */
export function sanitizeHintForPrompt(hint: string, maxLength = 2000): string {
  return sanitizeForAzureContentFilter(hint)
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, maxLength)
    .trim();
}
