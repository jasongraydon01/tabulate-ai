import { describe, it, expect } from 'vitest';
import { enrichDataMapWithMessages } from '../enrichDataMapWithMessages';
import type { VerboseDataMapType } from '@/schemas/processingSchemas';
import type { MessageListEntry } from '../MessageListParser';
import type { MaxDiffFamilyDetectionResult, DetectedFamily } from '../detectMaxDiffFamilies';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEntry(column: string, description: string, scaleLabels?: { value: number; label: string }[]): VerboseDataMapType {
  return {
    column,
    description,
    answerOptions: scaleLabels?.map(sl => `${sl.value}=${sl.label}`).join('; ') ?? '',
    level: 'sub',
    valueType: 'numeric',
    parentQuestion: column,
    type: 'numeric',
    normalizedType: 'scale',
    rClass: 'numeric',
    nUnique: 5,
    observedMin: 1,
    observedMax: 5,
    spssFormat: 'F8.2',
    scaleLabels: scaleLabels ?? [],
  } as unknown as VerboseDataMapType;
}

function makeMessages(...items: Array<{ code: string; text: string; variantOf?: string }>): MessageListEntry[] {
  return items.map((m, i) => ({
    code: m.code,
    text: m.text,
    sourceRow: i + 1,
    ...(m.variantOf !== undefined && { variantOf: m.variantOf }),
  }));
}

function makeDetection(families: DetectedFamily[]): MaxDiffFamilyDetectionResult {
  return {
    families,
    questionIdsToAllow: families.filter(f => f.publishable).map(f => f.name),
    detected: families.length > 0,
  };
}

function makeFamily(name: string, variables: string[]): DetectedFamily {
  return {
    name,
    displayName: `${name} Scores`,
    variableCount: variables.length,
    publishable: true,
    defaultEnabled: true,
    variables,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('enrichDataMapWithMessages', () => {
  describe('Gap 1: variable description enrichment', () => {
    it('enriches MaxDiff score variable labels with full-text messages', () => {
      const datamap = [
        makeEntry('AnchProbInd_1', 'API: I1 - Truncated text here...'),
        makeEntry('AnchProbInd_2', 'API: I2 - Another truncated...'),
      ];
      const messages = makeMessages(
        { code: 'I1', text: 'Full text of first message that is much longer' },
        { code: 'I2', text: 'Full text of second message that is much longer' },
      );
      const detection = makeDetection([
        makeFamily('AnchProbInd', ['AnchProbInd_1', 'AnchProbInd_2']),
      ]);

      const result = enrichDataMapWithMessages(datamap, messages, detection);

      expect(result.enriched[0].description).toBe('API: I1 - Full text of first message that is much longer');
      expect(result.enriched[1].description).toBe('API: I2 - Full text of second message that is much longer');
      expect(result.stats.variableLabelsEnriched).toBe(2);
    });

    it('skips anchor variables', () => {
      const datamap = [
        makeEntry('AnchProbInd_3', 'API: Anchor'),
      ];
      const messages = makeMessages({ code: 'Anchor', text: 'Should not match' });
      const detection = makeDetection([
        makeFamily('AnchProbInd', ['AnchProbInd_3']),
      ]);

      const result = enrichDataMapWithMessages(datamap, messages, detection);
      expect(result.stats.variableLabelsEnriched).toBe(0);
    });

    it('resolves placeholder descriptions like "CODE preferred message"', () => {
      const datamap = [makeEntry('C5r1', 'I1 preferred message')];
      const messages = makeMessages({ code: 'I1', text: 'Message full text' });
      const detection = makeDetection([]);

      const result = enrichDataMapWithMessages(datamap, messages, detection);
      expect(result.enriched[0].description).toBe('I1: Message full text');
      expect(result.stats.variableLabelsEnriched).toBe(1);
    });
  });

  describe('Gap 2: value label enrichment', () => {
    it('enriches value labels with code-prefix matching', () => {
      const datamap = [
        makeEntry('Q5', 'Best message', [
          { value: 1, label: 'I1: Truncated text...' },
          { value: 2, label: 'I2: Another truncat...' },
        ]),
      ];
      const messages = makeMessages(
        { code: 'I1', text: 'Full text of message one' },
        { code: 'I2', text: 'Full text of message two' },
      );
      const detection = makeDetection([]);

      const result = enrichDataMapWithMessages(datamap, messages, detection);

      expect(result.enriched[0].scaleLabels![0].label).toBe('I1: Full text of message one');
      expect(result.enriched[0].scaleLabels![1].label).toBe('I2: Full text of message two');
      expect(result.stats.valueLabelsEnriched).toBe(2);
    });
  });

  describe('unmatched messages', () => {
    it('reports message codes that did not match anything', () => {
      const datamap = [
        makeEntry('AnchProbInd_1', 'API: I1 - Text'),
      ];
      const messages = makeMessages(
        { code: 'I1', text: 'Matched' },
        { code: 'I2', text: 'Unmatched' },
        { code: 'I3', text: 'Also unmatched' },
      );
      const detection = makeDetection([
        makeFamily('AnchProbInd', ['AnchProbInd_1']),
      ]);

      const result = enrichDataMapWithMessages(datamap, messages, detection);
      expect(result.stats.unmatchedMessages).toContain('I2');
      expect(result.stats.unmatchedMessages).toContain('I3');
    });
  });

  describe('variantOfMap construction', () => {
    it('builds variantOfMap from entries with variantOf', () => {
      const datamap = [makeEntry('S1', 'Question')];
      const messages = makeMessages(
        { code: 'I1', text: 'Primary' },
        { code: 'I1A', text: 'Alternate', variantOf: 'I1' },
        { code: 'E1', text: 'Another primary' },
        { code: 'E1A', text: 'Another alt', variantOf: 'E1' },
      );
      const detection = makeDetection([]);

      const result = enrichDataMapWithMessages(datamap, messages, detection);

      expect(result.variantOfMap.size).toBe(2);
      expect(result.variantOfMap.get('I1A')).toBe('I1');
      expect(result.variantOfMap.get('E1A')).toBe('E1');
    });

    it('returns empty variantOfMap when no entries have variantOf', () => {
      const datamap = [makeEntry('S1', 'Question')];
      const messages = makeMessages(
        { code: 'I1', text: 'Msg 1' },
        { code: 'I2', text: 'Msg 2' },
      );
      const detection = makeDetection([]);

      const result = enrichDataMapWithMessages(datamap, messages, detection);
      expect(result.variantOfMap.size).toBe(0);
    });
  });

  describe('pure function behavior', () => {
    it('does not mutate the input datamap', () => {
      const original = makeEntry('AnchProbInd_1', 'API: I1 - Truncated');
      const datamap = [original];
      const messages = makeMessages({ code: 'I1', text: 'Full text' });
      const detection = makeDetection([
        makeFamily('AnchProbInd', ['AnchProbInd_1']),
      ]);

      enrichDataMapWithMessages(datamap, messages, detection);

      expect(datamap[0].description).toBe('API: I1 - Truncated'); // Original unchanged
    });
  });
});
