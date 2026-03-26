import { createHash } from 'crypto';

export type ExpressionNode =
  | { type: 'identifier'; name: string }
  | { type: 'number'; value: string }
  | { type: 'string'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'unary'; operator: '!'; argument: ExpressionNode }
  | { type: 'binary'; operator: '|' | '&' | '==' | '!=' | '>' | '>=' | '<' | '<=' | '%in%'; left: ExpressionNode; right: ExpressionNode }
  | { type: 'call'; callee: string; args: ExpressionNode[] };

export interface ExpressionAnalysis {
  functionCalls: string[];
  hasNegation: boolean;
  hasInOperator: boolean;
  hasComparisonBetweenVariables: boolean;
  operators: string[];
}

export interface ParsedExpression {
  ast: ExpressionNode;
  normalized: string;
  fingerprint: string;
  analysis: ExpressionAnalysis;
}

export interface ParseExpressionResult {
  ok: boolean;
  parsed?: ParsedExpression;
  error?: string;
}

type TokenType =
  | 'identifier'
  | 'number'
  | 'string'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'eof';

interface Token {
  type: TokenType;
  value: string;
  index: number;
}

class ExpressionTokenizer {
  private readonly input: string;
  private index = 0;

  constructor(input: string) {
    this.input = input;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (this.index < this.input.length) {
      this.skipWhitespace();
      if (this.index >= this.input.length) break;

      const start = this.index;
      const current = this.input[this.index];

      if (current === '(') {
        tokens.push({ type: 'lparen', value: current, index: start });
        this.index += 1;
        continue;
      }
      if (current === ')') {
        tokens.push({ type: 'rparen', value: current, index: start });
        this.index += 1;
        continue;
      }
      if (current === ',') {
        tokens.push({ type: 'comma', value: current, index: start });
        this.index += 1;
        continue;
      }

      const op = this.readOperator();
      if (op) {
        tokens.push({ type: 'operator', value: op, index: start });
        continue;
      }

      if (current === '"' || current === '\'') {
        tokens.push({ type: 'string', value: this.readString(current), index: start });
        continue;
      }

      if (/[0-9]/.test(current)) {
        tokens.push({ type: 'number', value: this.readNumber(), index: start });
        continue;
      }

      if (/[A-Za-z_.]/.test(current)) {
        tokens.push({ type: 'identifier', value: this.readIdentifier(), index: start });
        continue;
      }

      throw new Error(`Unsupported token '${current}' at offset ${start}`);
    }

    tokens.push({ type: 'eof', value: '', index: this.index });
    return tokens;
  }

  private skipWhitespace(): void {
    while (this.index < this.input.length && /\s/.test(this.input[this.index])) {
      this.index += 1;
    }
  }

  private readOperator(): string | null {
    const remainder = this.input.slice(this.index);
    const operators = ['%in%', '==', '!=', '>=', '<=', '>', '<', '&', '|', '!'];

    for (const op of operators) {
      if (remainder.startsWith(op)) {
        this.index += op.length;
        return op;
      }
    }
    return null;
  }

  private readString(quote: string): string {
    this.index += 1;
    let value = '';

    while (this.index < this.input.length) {
      const char = this.input[this.index];

      if (char === '\\') {
        const next = this.input[this.index + 1];
        if (next !== undefined) {
          value += next;
          this.index += 2;
          continue;
        }
      }

      if (char === quote) {
        this.index += 1;
        return value;
      }

      value += char;
      this.index += 1;
    }

    throw new Error('Unterminated string literal');
  }

  private readNumber(): string {
    const start = this.index;
    while (this.index < this.input.length && /[0-9.]/.test(this.input[this.index])) {
      this.index += 1;
    }
    return this.input.slice(start, this.index);
  }

  private readIdentifier(): string {
    const start = this.index;
    while (this.index < this.input.length && /[A-Za-z0-9_.]/.test(this.input[this.index])) {
      this.index += 1;
    }
    return this.input.slice(start, this.index);
  }
}

class ExpressionParser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): ExpressionNode {
    const node = this.parseOr();
    this.expect('eof');
    return node;
  }

  private parseOr(): ExpressionNode {
    let node = this.parseAnd();
    while (this.match('operator', '|')) {
      const right = this.parseAnd();
      node = { type: 'binary', operator: '|', left: node, right };
    }
    return node;
  }

  private parseAnd(): ExpressionNode {
    let node = this.parseUnary();
    while (this.match('operator', '&')) {
      const right = this.parseUnary();
      node = { type: 'binary', operator: '&', left: node, right };
    }
    return node;
  }

  private parseUnary(): ExpressionNode {
    if (this.match('operator', '!')) {
      return { type: 'unary', operator: '!', argument: this.parseUnary() };
    }
    return this.parseComparison();
  }

  private parseComparison(): ExpressionNode {
    let node = this.parsePrimary();

    while (this.peek().type === 'operator' && this.isComparisonOperator(this.peek().value)) {
      const operator = this.consume().value as '==' | '!=' | '>' | '>=' | '<' | '<=' | '%in%';
      const right = this.parsePrimary();
      node = { type: 'binary', operator, left: node, right };
    }

    return node;
  }

  private parsePrimary(): ExpressionNode {
    const token = this.peek();

    if (token.type === 'lparen') {
      this.consume();
      const inner = this.parseOr();
      this.expect('rparen');
      return inner;
    }

    if (token.type === 'number') {
      this.consume();
      return { type: 'number', value: token.value };
    }

    if (token.type === 'string') {
      this.consume();
      return { type: 'string', value: token.value };
    }

    if (token.type === 'identifier') {
      this.consume();
      const normalized = token.value.toUpperCase();
      if (normalized === 'TRUE') {
        return { type: 'boolean', value: true };
      }
      if (normalized === 'FALSE') {
        return { type: 'boolean', value: false };
      }

      if (this.match('lparen')) {
        const args: ExpressionNode[] = [];
        if (!this.match('rparen')) {
          do {
            args.push(this.parseOr());
          } while (this.match('comma'));
          this.expect('rparen');
        }
        return { type: 'call', callee: token.value, args };
      }

      return { type: 'identifier', name: token.value };
    }

    throw new Error(`Unexpected token '${token.value}' at offset ${token.index}`);
  }

  private isComparisonOperator(op: string): op is '==' | '!=' | '>' | '>=' | '<' | '<=' | '%in%' {
    return op === '==' || op === '!=' || op === '>' || op === '>=' || op === '<' || op === '<=' || op === '%in%';
  }

  private peek(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1];
  }

  private consume(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new Error(`Expected token '${type}', found '${token.type}' at offset ${token.index}`);
    }
    return this.consume();
  }

  private match(type: TokenType, value?: string): boolean {
    const token = this.peek();
    if (token.type !== type) {
      return false;
    }
    if (value !== undefined && token.value !== value) {
      return false;
    }
    this.consume();
    return true;
  }
}

export function parseExpression(input: string): ParseExpressionResult {
  try {
    const tokenizer = new ExpressionTokenizer(input);
    const tokens = tokenizer.tokenize();
    const parser = new ExpressionParser(tokens);
    const ast = parser.parse();
    const normalized = normalizeExpression(ast);
    const fingerprint = createHash('sha256').update(normalized).digest('hex');
    const analysis = analyzeExpression(ast);
    return {
      ok: true,
      parsed: {
        ast,
        normalized,
        fingerprint,
        analysis,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function normalizeExpression(node: ExpressionNode): string {
  return printNode(node, 0);
}

function printNode(node: ExpressionNode, parentPrecedence: number): string {
  switch (node.type) {
    case 'identifier':
      return node.name;
    case 'number':
      return node.value;
    case 'string':
      return `'${node.value.replace(/'/g, "\\'")}'`;
    case 'boolean':
      return node.value ? 'TRUE' : 'FALSE';
    case 'call': {
      const args = node.args.map((arg) => printNode(arg, 0)).join(', ');
      return `${node.callee}(${args})`;
    }
    case 'unary': {
      const rendered = `!${printNode(node.argument, precedence(node))}`;
      return parenthesizeIfNeeded(rendered, precedence(node), parentPrecedence);
    }
    case 'binary': {
      const currentPrecedence = precedence(node);
      const left = printNode(node.left, currentPrecedence);
      const right = printNode(node.right, currentPrecedence + (node.operator === '&' || node.operator === '|' ? 1 : 0));
      const rendered = `${left} ${node.operator} ${right}`;
      return parenthesizeIfNeeded(rendered, currentPrecedence, parentPrecedence);
    }
    default:
      return '';
  }
}

function parenthesizeIfNeeded(text: string, currentPrecedence: number, parentPrecedence: number): string {
  if (currentPrecedence < parentPrecedence) {
    return `(${text})`;
  }
  return text;
}

function precedence(node: ExpressionNode): number {
  if (node.type === 'binary') {
    if (node.operator === '|') return 1;
    if (node.operator === '&') return 2;
    return 3;
  }
  if (node.type === 'unary') return 4;
  return 5;
}

export function analyzeExpression(node: ExpressionNode): ExpressionAnalysis {
  const functionCalls = new Set<string>();
  const operators = new Set<string>();
  let hasNegation = false;
  let hasInOperator = false;
  let hasComparisonBetweenVariables = false;

  const visit = (current: ExpressionNode): void => {
    if (current.type === 'call') {
      functionCalls.add(current.callee);
      for (const arg of current.args) visit(arg);
      return;
    }

    if (current.type === 'unary') {
      hasNegation = true;
      operators.add(current.operator);
      visit(current.argument);
      return;
    }

    if (current.type === 'binary') {
      operators.add(current.operator);
      if (current.operator === '%in%') {
        hasInOperator = true;
      }
      if (
        (current.operator === '==' || current.operator === '!=' || current.operator === '>' || current.operator === '>=' || current.operator === '<' || current.operator === '<=')
        && current.left.type === 'identifier'
        && current.right.type === 'identifier'
      ) {
        hasComparisonBetweenVariables = true;
      }
      visit(current.left);
      visit(current.right);
      return;
    }
  };

  visit(node);

  return {
    functionCalls: [...functionCalls].sort((a, b) => a.localeCompare(b)),
    hasNegation,
    hasInOperator,
    hasComparisonBetweenVariables,
    operators: [...operators].sort((a, b) => a.localeCompare(b)),
  };
}
