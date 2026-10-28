import type { FlagValue } from "./schema";

/**
 * Condition grammar for history events (03_HISTORY.md §6.1).
 *
 *   expr := term (("and" | "or") term)*
 *   term := "not" term | "(" expr ")" | atom
 *   atom := name | name op value | fn "(" args ")"
 *
 * `and` binds tighter than `or`. No code evaluation; names resolve through a
 * `ConditionContext` the engine builds from the world state.
 */

export type ConditionContext = {
  flags: Record<string, FlagValue>;
  fired: (id: string) => boolean;
  chose: (eventId: string, optionId: string) => boolean;
  feature: (name: string) => boolean;
  /** Named numbers and words: rank, renown, age, year, units, manses, denarii, tenure, swornTo, … */
  vars: Record<string, FlagValue | undefined>;
};

type Token =
  | { kind: "word"; value: string }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "op"; value: string }
  | { kind: "punct"; value: "(" | ")" | "," }
  | { kind: "end" };

const OPS = ["==", "!=", ">=", "<=", ">", "<", "="] as const;

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === ",") {
      out.push({ kind: "punct", value: ch });
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = src.indexOf(ch, i + 1);
      if (end < 0) throw new Error(`Unterminated string in condition: ${src}`);
      out.push({ kind: "string", value: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      out.push({ kind: "op", value: op === "=" ? "==" : op });
      i += op.length;
      continue;
    }
    const eventId = /^\d{3}-[A-Z]?[0-9A-Z]+/.exec(src.slice(i));
    if (eventId) {
      out.push({ kind: "word", value: eventId[0] });
      i += eventId[0].length;
      continue;
    }
    const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ kind: "number", value: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_\-.]*/.exec(src.slice(i));
    if (word) {
      out.push({ kind: "word", value: word[0] });
      i += word[0].length;
      continue;
    }
    throw new Error(`Bad character '${ch}' in condition: ${src}`);
  }
  out.push({ kind: "end" });
  return out;
}

export type Ast =
  | { t: "and"; a: Ast; b: Ast }
  | { t: "or"; a: Ast; b: Ast }
  | { t: "not"; a: Ast }
  | { t: "truthy"; name: string }
  | { t: "cmp"; name: string; op: string; value: FlagValue }
  | { t: "fn"; name: string; args: string[] };

class Parser {
  private pos = 0;
  constructor(private tokens: Token[], private src: string) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }
  private next(): Token {
    return this.tokens[this.pos++];
  }
  private isWord(v: string): boolean {
    const t = this.peek();
    return t.kind === "word" && t.value.toLowerCase() === v;
  }

  parse(): Ast {
    const ast = this.expr();
    if (this.peek().kind !== "end") throw new Error(`Trailing input in condition: ${this.src}`);
    return ast;
  }

  private expr(): Ast {
    let left = this.andExpr();
    while (this.isWord("or")) {
      this.next();
      left = { t: "or", a: left, b: this.andExpr() };
    }
    return left;
  }

  private andExpr(): Ast {
    let left = this.term();
    while (this.isWord("and")) {
      this.next();
      left = { t: "and", a: left, b: this.term() };
    }
    return left;
  }

  private term(): Ast {
    if (this.isWord("not")) {
      this.next();
      return { t: "not", a: this.term() };
    }
    const t = this.peek();
    if (t.kind === "punct" && t.value === "(") {
      this.next();
      const inner = this.expr();
      const close = this.next();
      if (close.kind !== "punct" || close.value !== ")") throw new Error(`Expected ')' in condition: ${this.src}`);
      return inner;
    }
    return this.atom();
  }

  private atom(): Ast {
    const t = this.next();
    if (t.kind !== "word") throw new Error(`Expected a name in condition: ${this.src}`);
    const name = t.value;
    const after = this.peek();
    if (after.kind === "punct" && after.value === "(") {
      this.next();
      const args: string[] = [];
      for (;;) {
        const a = this.next();
        if (a.kind === "word" || a.kind === "string") args.push(a.value);
        else if (a.kind === "number") args.push(String(a.value));
        else throw new Error(`Bad argument to ${name}() in condition: ${this.src}`);
        const sep = this.next();
        if (sep.kind === "punct" && sep.value === ")") break;
        if (!(sep.kind === "punct" && sep.value === ",")) throw new Error(`Expected ',' or ')' in condition: ${this.src}`);
      }
      return { t: "fn", name: name.toLowerCase(), args };
    }
    if (after.kind === "op") {
      this.next();
      const v = this.next();
      let value: FlagValue;
      if (v.kind === "number") value = v.value;
      else if (v.kind === "string") value = v.value;
      else if (v.kind === "word") {
        if (v.value === "true") value = true;
        else if (v.value === "false") value = false;
        else value = v.value;
      } else throw new Error(`Expected a value after '${after.value}' in condition: ${this.src}`);
      return { t: "cmp", name, op: after.value, value };
    }
    return { t: "truthy", name };
  }
}

const cache = new Map<string, Ast>();

export function parseCondition(src: string): Ast {
  const key = src.trim();
  const hit = cache.get(key);
  if (hit) return hit;
  const ast = new Parser(tokenize(key), key).parse();
  cache.set(key, ast);
  return ast;
}

function resolve(ctx: ConditionContext, name: string): FlagValue | undefined {
  if (name in ctx.flags) return ctx.flags[name];
  if (name in ctx.vars) return ctx.vars[name];
  return undefined;
}

function truthy(v: FlagValue | undefined): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return v !== "" && v !== "false" && v !== "none";
}

function compare(left: FlagValue | undefined, op: string, right: FlagValue): boolean {
  if (typeof right === "number") {
    const l = typeof left === "number" ? left : typeof left === "boolean" ? (left ? 1 : 0) : left === undefined ? 0 : Number(left);
    if (Number.isNaN(l)) return op === "!=";
    switch (op) {
      case "==":
        return l === right;
      case "!=":
        return l !== right;
      case ">=":
        return l >= right;
      case "<=":
        return l <= right;
      case ">":
        return l > right;
      case "<":
        return l < right;
    }
    return false;
  }
  const l = left === undefined ? "" : String(left);
  const r = String(right);
  if (op === "==") return l === r;
  if (op === "!=") return l !== r;
  throw new Error(`Operator ${op} needs a number, got '${r}'`);
}

export function evalAst(ast: Ast, ctx: ConditionContext): boolean {
  switch (ast.t) {
    case "and":
      return evalAst(ast.a, ctx) && evalAst(ast.b, ctx);
    case "or":
      return evalAst(ast.a, ctx) || evalAst(ast.b, ctx);
    case "not":
      return !evalAst(ast.a, ctx);
    case "truthy":
      return truthy(resolve(ctx, ast.name));
    case "cmp":
      return compare(resolve(ctx, ast.name), ast.op, ast.value);
    case "fn": {
      switch (ast.name) {
        case "fired":
          return ast.args.length === 1 && ctx.fired(ast.args[0]);
        case "chose":
          return ast.args.length === 2 && ctx.chose(ast.args[0], ast.args[1]);
        case "feature":
          return ast.args.length === 1 && ctx.feature(ast.args[0]);
        case "any":
          return ast.args.some((a) => truthy(resolve(ctx, a)));
        case "all":
          return ast.args.every((a) => truthy(resolve(ctx, a)));
        default:
          throw new Error(`Unknown function ${ast.name}() in condition`);
      }
    }
  }
}

/** Evaluate a condition; an empty or missing condition is true. */
export function evalCondition(src: string | undefined | null, ctx: ConditionContext): boolean {
  if (!src || !src.trim()) return true;
  return evalAst(parseCondition(src), ctx);
}

/** Every bare name and function argument a condition refers to, for the lint pass. */
export function referencedNames(src: string): { flags: string[]; events: string[]; choices: Array<[string, string]>; features: string[] } {
  const out = { flags: [] as string[], events: [] as string[], choices: [] as Array<[string, string]>, features: [] as string[] };
  const walk = (ast: Ast) => {
    switch (ast.t) {
      case "and":
      case "or":
        walk(ast.a);
        walk(ast.b);
        return;
      case "not":
        walk(ast.a);
        return;
      case "truthy":
      case "cmp":
        out.flags.push(ast.name);
        return;
      case "fn":
        if (ast.name === "fired") out.events.push(ast.args[0]);
        else if (ast.name === "chose") {
          out.events.push(ast.args[0]);
          out.choices.push([ast.args[0], ast.args[1]]);
        } else if (ast.name === "feature") out.features.push(ast.args[0]);
        else out.flags.push(...ast.args);
        return;
    }
  };
  if (src && src.trim()) walk(parseCondition(src));
  return out;
}
