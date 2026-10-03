// Every { he: {...}, en: {...} } dictionary in the app must have the same keys in both languages (A14 bug hunt).
// Parses the sources with the TypeScript compiler (dev dependency) — no module needs to export its strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const APP = join(ROOT, 'public/app/js');

/** @param {string} dir @returns {string[]} */
function jsFiles(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'sim' ? [] : jsFiles(p); // sim is research code, not shipped UI
    return n.endsWith('.js') ? [p] : [];
  });
}

/** @param {ts.PropertyName} n */
const propName = (n) => (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) ? n.text : null);

/**
 * Keys of an object literal; nested object literals contribute dotted keys.
 * @param {ts.ObjectLiteralExpression} obj @param {string} prefix @returns {Set<string>|null} null = has spreads/computed keys
 */
function keysOf(obj, prefix = '') {
  const out = new Set();
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p) && !ts.isMethodDeclaration(p)) return null;
    const k = propName(p.name);
    if (k === null) return null;
    out.add(prefix + k);
    if (ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.initializer)) {
      const inner = keysOf(p.initializer, `${prefix}${k}.`);
      if (inner === null) return null;
      for (const x of inner) out.add(x);
    }
  }
  return out;
}

/** @returns {Array<{file: string, line: number, onlyHe: string[], onlyEn: string[]}>} */
export function compareDictionaries() {
  const report = [];
  for (const file of jsFiles(APP)) {
    const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const visit = (/** @type {ts.Node} */ node) => {
      if (ts.isObjectLiteralExpression(node)) {
        /** @type {Record<string, ts.ObjectLiteralExpression>} */
        const langs = {};
        for (const p of node.properties) {
          if (ts.isPropertyAssignment(p) && ['he', 'en'].includes(String(propName(p.name))) && ts.isObjectLiteralExpression(p.initializer)) {
            langs[String(propName(p.name))] = p.initializer;
          }
        }
        if (langs.he && langs.en) {
          const he = keysOf(langs.he); const en = keysOf(langs.en);
          if (he && en) {
            const onlyHe = [...he].filter((k) => !en.has(k));
            const onlyEn = [...en].filter((k) => !he.has(k));
            const { line } = src.getLineAndCharacterOfPosition(node.getStart());
            report.push({ file: relative(ROOT, file), line: line + 1, onlyHe, onlyEn, size: he.size });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return report;
}

test('i18n: every he/en dictionary has the same keys', () => {
  const report = compareDictionaries();
  assert.ok(report.length >= 20, `found only ${report.length} dictionaries — parser broken?`);
  const bad = report.filter((r) => r.onlyHe.length || r.onlyEn.length)
    .map((r) => `${r.file}:${r.line} only he: [${r.onlyHe.join(', ')}] only en: [${r.onlyEn.join(', ')}]`);
  assert.deepEqual(bad, []);
});
