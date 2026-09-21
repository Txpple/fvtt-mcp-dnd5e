// How typed is the tool↔page seam? For every member of the page `api` (src/page/index.ts) the
// checker reports its first parameter and its awaited return type; `any` / `unknown` on either
// side is what the 3.0 M6 `SeamGuard` refuses at `tsc`. This prints the numbers the release notes
// restate (M6: 156 handlers, 0 untyped args, 0 untyped returns; the review's baseline was 26 / 74
// by regex — the checker counted 9 / 93). Offline; ~10 s (a full program build).
import ts from 'typescript';

const cfgPath = ts.findConfigFile('.', ts.sys.fileExists, 'tsconfig.json');
const cfg = ts.parseJsonConfigFileContent(
  ts.readConfigFile(cfgPath, ts.sys.readFile).config,
  ts.sys,
  '.'
);
const program = ts.createProgram(cfg.fileNames, cfg.options);
const checker = program.getTypeChecker();
const sf = program.getSourceFile('src/page/index.ts');
let apiDecl;
ts.forEachChild(sf, n => {
  if (!ts.isVariableStatement(n)) return;
  for (const d of n.declarationList.declarations) if (d.name.getText() === 'api') apiDecl = d;
});
const flag = t =>
  t.flags & ts.TypeFlags.Any ? 'any' : t.flags & ts.TypeFlags.Unknown ? 'unknown' : 'typed';
const rows = [];
for (const prop of checker.getPropertiesOfType(checker.getTypeAtLocation(apiDecl.name))) {
  const sig = checker.getTypeOfSymbolAtLocation(prop, apiDecl).getCallSignatures()[0];
  const [p0] = sig.getParameters();
  const arg = p0 ? flag(checker.getTypeOfSymbolAtLocation(p0, apiDecl)) : 'none';
  const ret = sig.getReturnType();
  rows.push({ name: prop.name, arg, ret: flag(checker.getAwaitedType(ret) ?? ret) });
}
const count = (k, v) => rows.filter(r => r[k] === v).length;
console.log(
  `seam typing: ${rows.length} handlers; args any ${count('arg', 'any')} · unknown ${count('arg', 'unknown')} · none ${count('arg', 'none')} · typed ${count('arg', 'typed')}; ` +
    `returns any ${count('ret', 'any')} · unknown ${count('ret', 'unknown')} · typed ${count('ret', 'typed')}`
);
for (const r of rows.filter(r => (r.arg !== 'typed' && r.arg !== 'none') || r.ret !== 'typed')) {
  console.log(`  ${r.name.padEnd(28)} arg=${r.arg.padEnd(7)} ret=${r.ret}`);
}
