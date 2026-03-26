import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const TARGET_DIRECTORIES = [
  'src/agents/tools',
  'src/lib/pipeline',
];

const TARGET_FILES = [
  'src/lib/CircuitBreaker.ts',
];

const BANNED_IDENTIFIERS = new Set([
  'emittedRules',
  'contextEmitters',
  'contextScratchpads',
  'activeBreaker',
  'activeTheme',
  'DEFAULT_KEY',
  'globalScratchpad',
]);

function isMutableStoreInitializer(node: ts.Expression): boolean {
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
    return ['Map', 'Set', 'WeakMap', 'WeakSet'].includes(node.expression.text);
  }

  return false;
}

describe('Global pipeline-state guardrail', () => {
  it('blocks module-level mutable pipeline state in critical modules', () => {
    const violations: string[] = [];
    const files = [
      ...TARGET_FILES,
      ...TARGET_DIRECTORIES.flatMap((dir) => {
        const absoluteDir = path.resolve(process.cwd(), dir);
        return readdirSync(absoluteDir)
          .filter((name) => name.endsWith('.ts'))
          .filter((name) => !name.endsWith('.test.ts'))
          .map((name) => path.join(dir, name));
      }),
    ];

    for (const relativeFile of files) {
      const absoluteFile = path.resolve(process.cwd(), relativeFile);
      const sourceText = readFileSync(absoluteFile, 'utf-8');
      const sourceFile = ts.createSourceFile(absoluteFile, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

      for (const statement of sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue;

        const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
        if (!isConst) {
          violations.push(`${relativeFile}: top-level let/var is not allowed`);
          continue;
        }

        for (const declaration of statement.declarationList.declarations) {
          const variableName = declaration.name.getText(sourceFile);

          if (BANNED_IDENTIFIERS.has(variableName)) {
            violations.push(`${relativeFile}: banned identifier \`${variableName}\` found at module scope`);
          }

          if (declaration.initializer && isMutableStoreInitializer(declaration.initializer)) {
            violations.push(`${relativeFile}: mutable module-level initializer found for \`${variableName}\``);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
