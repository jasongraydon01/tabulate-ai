import { describe, expect, it } from 'vitest';
import { buildContactPath, parseContactTopic } from '@/lib/contact';

describe('contact helpers', () => {
  it('builds a contact path with an optional topic', () => {
    expect(buildContactPath()).toBe('/contact');
    expect(buildContactPath({ topic: 'wincross' })).toBe('/contact?topic=wincross');
  });

  it('parses known topics and falls back safely', () => {
    expect(parseContactTopic('billing')).toBe('billing');
    expect(parseContactTopic('unknown')).toBe('general');
    expect(parseContactTopic(undefined)).toBe('general');
  });
});
