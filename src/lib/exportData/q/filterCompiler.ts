import { createHash } from 'crypto';
import { parseExpression, type ExpressionNode } from '@/lib/exportData/expression';
import type { QExportFilterTree, QExportFilterTermOperator } from '@/lib/exportData/types';

export type CompileQFilterResult =
  | {
      parseStatus: 'parsed';
      loweringStrategy: 'direct' | 'derived_variable';
      reasonCodes: string[];
      normalized: string;
      fingerprint: string;
      filterTree: QExportFilterTree;
    }
  | {
      parseStatus: 'blocked';
      loweringStrategy: 'blocked';
      reasonCodes: string[];
      normalized?: string;
      fingerprint?: string;
      filterTree?: undefined;
    };

export interface CompileQFilterOptions {
  dataFrameRef: string;
  filterId: string;
}

interface CompileContext {
  helperPrefix: string;
}

interface CompiledNode {
  filterTree: QExportFilterTree;
  loweringStrategy: 'direct' | 'derived_variable';
}

export function compileQFilter(expression: string, options?: CompileQFilterOptions): CompileQFilterResult {
  const parsed = parseExpression(expression);
  if (!parsed.ok || !parsed.parsed) {
    return {
      parseStatus: 'blocked',
      loweringStrategy: 'blocked',
      reasonCodes: ['unsupported_expression'],
    };
  }

  try {
    const context = options
      ? {
          helperPrefix: `hawktab_cv_${createHash('sha256').update(`${options.filterId}|${parsed.parsed.fingerprint}`).digest('hex').slice(0, 16)}`,
        }
      : null;
    const compiled = compileNode(parsed.parsed.ast, context, 'root');
    return {
      parseStatus: 'parsed',
      loweringStrategy: compiled.loweringStrategy,
      reasonCodes: [compiled.loweringStrategy === 'derived_variable' ? 'derived_variable_lowering' : 'ready'],
      normalized: parsed.parsed.normalized,
      fingerprint: parsed.parsed.fingerprint,
      filterTree: compiled.filterTree,
    };
  } catch (error) {
    return {
      parseStatus: 'blocked',
      loweringStrategy: 'blocked',
      reasonCodes: [error instanceof Error ? error.message : 'unsupported_expression'],
      normalized: parsed.parsed.normalized,
      fingerprint: parsed.parsed.fingerprint,
    };
  }
}

function compileNode(node: ExpressionNode, context: CompileContext | null, nodePath: string): CompiledNode {
  if (node.type === 'binary') {
    if (node.operator === '&') {
      const left = compileNode(node.left, context, `${nodePath}_left`);
      const right = compileNode(node.right, context, `${nodePath}_right`);
      return {
        filterTree: {
          type: 'and',
          children: [left.filterTree, right.filterTree],
        },
        loweringStrategy: mergeLoweringStrategy(left.loweringStrategy, right.loweringStrategy),
      };
    }
    if (node.operator === '|') {
      const left = compileNode(node.left, context, `${nodePath}_left`);
      const right = compileNode(node.right, context, `${nodePath}_right`);
      return {
        filterTree: {
          type: 'or',
          children: [left.filterTree, right.filterTree],
        },
        loweringStrategy: mergeLoweringStrategy(left.loweringStrategy, right.loweringStrategy),
      };
    }
    if (node.operator === '%in%') {
      return compileInFilter(node.left, node.right);
    }
    return compileComparisonFilter(node.operator, node.left, node.right, context, nodePath);
  }

  if (node.type === 'unary') {
    const compiledArg = compileNode(node.argument, context, `${nodePath}_arg`);
    return {
      filterTree: {
        type: 'not',
        child: compiledArg.filterTree,
      },
      loweringStrategy: compiledArg.loweringStrategy,
    };
  }

  if (node.type === 'call') {
    if (node.callee.toLowerCase() === 'is.na') {
      if (node.args.length !== 1 || node.args[0].type !== 'identifier') {
        throw new Error('unsupported_expression');
      }
      return {
        filterTree: {
          type: 'term',
          leftRef: node.args[0].name,
          op: 'is_missing',
          values: [],
        },
        loweringStrategy: 'direct',
      };
    }
    throw new Error('unsupported_function_call');
  }

  throw new Error('unsupported_expression');
}

function compileComparisonFilter(
  operator: '==' | '!=' | '>' | '>=' | '<' | '<=',
  left: ExpressionNode,
  right: ExpressionNode,
  context: CompileContext | null,
  nodePath: string,
): CompiledNode {
  if (left.type !== 'identifier') {
    throw new Error('unsupported_expression');
  }
  if (right.type === 'identifier') {
    if (!context) {
      throw new Error('cross_variable_comparison');
    }
    const pathSuffix = nodePath.replace(/[^a-zA-Z0-9_]/g, '_');
    const helperVarName = `${context.helperPrefix}_${pathSuffix}`;
    return {
      filterTree: {
        type: 'derived_comparison',
        leftVar: left.name,
        op: operator,
        rightVar: right.name,
        helperVarName,
      },
      loweringStrategy: 'derived_variable',
    };
  }
  if (!isLiteralNode(right)) {
    throw new Error('cross_variable_comparison');
  }

  return {
    filterTree: {
      type: 'term',
      leftRef: left.name,
      op: comparisonOperatorToTermOperator(operator),
      values: [parseLiteralValue(right)],
    },
    loweringStrategy: 'direct',
  };
}

function compileInFilter(left: ExpressionNode, right: ExpressionNode): CompiledNode {
  if (left.type !== 'identifier') {
    throw new Error('unsupported_expression');
  }

  const values = extractInValues(right);
  if (values.length === 0) {
    throw new Error('unsupported_expression');
  }

  return {
    filterTree: {
      type: 'term',
      leftRef: left.name,
      op: 'any_of',
      values: values.map((value) => parseLiteralValue(value)),
    },
    loweringStrategy: 'direct',
  };
}

function extractInValues(node: ExpressionNode): Array<Extract<ExpressionNode, { type: 'number' | 'string' | 'boolean' }>> {
  if (isLiteralNode(node)) {
    return [node];
  }

  if (node.type === 'call' && node.callee.toLowerCase() === 'c') {
    if (!node.args.every((arg) => isLiteralNode(arg))) {
      throw new Error('unsupported_expression');
    }
    return node.args;
  }

  throw new Error('unsupported_expression');
}

function isLiteralNode(node: ExpressionNode): node is Extract<ExpressionNode, { type: 'number' | 'string' | 'boolean' }> {
  return node.type === 'number' || node.type === 'string' || node.type === 'boolean';
}

function parseLiteralValue(node: Extract<ExpressionNode, { type: 'number' | 'string' | 'boolean' }>): string | number | boolean {
  if (node.type === 'number') {
    if (!/^[0-9]+(?:\.[0-9]+)?$/.test(node.value)) {
      throw new Error('unsupported_numeric_literal');
    }
    return Number(node.value);
  }
  if (node.type === 'boolean') {
    return node.value;
  }
  return node.value;
}

function mergeLoweringStrategy(
  left: CompiledNode['loweringStrategy'],
  right: CompiledNode['loweringStrategy'],
): CompiledNode['loweringStrategy'] {
  return left === 'derived_variable' || right === 'derived_variable'
    ? 'derived_variable'
    : 'direct';
}

function comparisonOperatorToTermOperator(
  operator: '==' | '!=' | '>' | '>=' | '<' | '<=',
): QExportFilterTermOperator {
  if (operator === '==') return 'equals';
  if (operator === '!=') return 'not_equals';
  if (operator === '>') return 'greater_than';
  if (operator === '>=') return 'greater_than_or_equals';
  if (operator === '<') return 'less_than';
  return 'less_than_or_equals';
}
