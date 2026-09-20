// perf-results: classify every registered tool's RESULT format (string/markdown vs JSON object vs mixed)
// by resolving the declared return type of each handler in src/registry.ts with the TypeScript
// compiler API, then falling back to a body heuristic for `any`/`unknown` returns.
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const cfgPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
const cfg = ts.readConfigFile(cfgPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, path.dirname(cfgPath));
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const sf = program.getSourceFile(path.join(root, 'src', 'registry.ts'));

let handlersObj = null;
function visit(n) {
  if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'handlers' && n.initializer && ts.isObjectLiteralExpression(n.initializer)) handlersObj = n.initializer;
  ts.forEachChild(n, visit);
}
visit(sf);

// Heuristic on a function body: does it return a string, an object, or both?
function bodyKind(fnNode, srcFile) {
  let str = 0, obj = 0, other = 0;
  const seen = new Set();
  function walk(n) {
    if (ts.isReturnStatement(n) && n.expression) {
      const e = n.expression;
      if (ts.isTemplateExpression(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isStringLiteral(e)) str++;
      else if (ts.isObjectLiteralExpression(e) || ts.isArrayLiteralExpression(e)) obj++;
      else if (ts.isCallExpression(e)) {
        const t = checker.typeToString(checker.getTypeAtLocation(e));
        if (t === 'string') str++; else if (/^\{|\[\]$|Record|any|unknown/.test(t)) { if (t==='any'||t==='unknown') other++; else obj++; } else other++;
      } else {
        const t = checker.typeToString(checker.getTypeAtLocation(e));
        if (t === 'string') str++; else if (t==='any'||t==='unknown') other++; else obj++;
      }
    }
    // don't descend into nested function expressions (callbacks)
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) { if (n !== fnNode) return; }
    ts.forEachChild(n, walk);
  }
  walk(fnNode);
  return { str, obj, other };
}

const rows = [];
for (const prop of handlersObj.properties) {
  if (!ts.isPropertyAssignment(prop)) continue;
  const name = prop.name.getText(sf).replace(/'/g, '');
  const init = prop.initializer;
  const sig = checker.getSignaturesOfType(checker.getTypeAtLocation(init), ts.SignatureKind.Call)[0];
  const ret = checker.typeToString(sig.getReturnType());
  // find the underlying method to inspect its body
  let kind = null, target = '';
  let body = init.body;
  let call = null;
  if (ts.isCallExpression(body)) call = body;
  else if (ts.isBlock(body)) { /* multi-line arrow (add-feature etc.) */ }
  if (call && ts.isPropertyAccessExpression(call.expression)) {
    const s = checker.getSymbolAtLocation(call.expression.name);
    const decl = s?.declarations?.[0];
    if (decl && (ts.isMethodDeclaration(decl) || ts.isPropertyAssignment(decl) || ts.isArrowFunction(decl))) {
      target = path.relative(root, decl.getSourceFile().fileName).split(path.sep).join('/') + ':' + (decl.getSourceFile().getLineAndCharacterOfPosition(decl.getStart()).line + 1);
      const fn = ts.isPropertyAssignment(decl) ? decl.initializer : decl;
      const inner = checker.typeToString(checker.getSignaturesOfType(checker.getTypeAtLocation(call.expression), ts.SignatureKind.Call)[0]?.getReturnType() ?? sig.getReturnType());
      kind = { declared: inner, ...bodyKind(fn, decl.getSourceFile()) };
    }
  } else if (ts.isBlock(body)) {
    target = 'src/registry.ts:' + (sf.getLineAndCharacterOfPosition(init.getStart()).line + 1);
    kind = { declared: ret, ...bodyKind(init, sf) };
  }
  rows.push({ name, declared: kind?.declared ?? ret, target, ...(kind ?? {}) });
}

function classify(r) {
  const d = r.declared ?? '';
  if (/^Promise<string>$/.test(d)) return 'string';
  if (/^Promise<(\{|Array|[A-Z][A-Za-z]*(Result|Response|Summary|Info|Report|Output)\b)/.test(d) && !/string/.test(d)) return 'json';
  if (/Promise<string \|/.test(d) || (/Promise<.*\| string/.test(d))) return 'mixed(declared)';
  // any/unknown: use body
  if ((r.str ?? 0) > 0 && (r.obj ?? 0) === 0) return 'string(body)';
  if ((r.obj ?? 0) > 0 && (r.str ?? 0) === 0) return 'json(body)';
  if ((r.obj ?? 0) > 0 && (r.str ?? 0) > 0) return 'mixed(body)';
  return 'unknown';
}
const out = rows.map(r => ({ ...r, cls: classify(r) }));
const counts = {};
for (const r of out) counts[r.cls] = (counts[r.cls] || 0) + 1;
console.log(JSON.stringify({ counts, total: out.length }, null, 2));
for (const r of out) console.log(`${r.name.padEnd(30)} ${r.cls.padEnd(16)} ${(r.declared||'').slice(0,60).padEnd(60)} str=${r.str??'-'} obj=${r.obj??'-'} other=${r.other??'-'}  ${r.target}`);
