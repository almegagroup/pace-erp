#!/usr/bin/env node
/*
 * JSX Undefined Component Guard — new pattern, found live 2026-08-20 (Plan
 * Feed prod crash: `CustomerEditForm` used in JSX inside PlanFeedPage.jsx but
 * never imported — JSX children evaluate eagerly regardless of a parent
 * Drawer's `visible` prop, so this threw a ReferenceError on every render of
 * the Edit FO tab and blanked the whole page in prod).
 *
 * কেন আলাদা guard লাগলো: এই project-এর `eslint.config.js`-এ আগে
 * eslint-plugin-react ছিলই না, তাই core ESLint-এর `no-undef` rule JSX
 * identifier চেক করে না -- undefined JSX component ব্যবহার করলে eslint কোনো
 * error-ই দেখাত না, আর compile-time-eo কোনো signal নেই (plain JS, no
 * TypeScript, তাই `tsc` ধরার সুযোগও নেই)। `eslint.config.js`-এ এখন
 * `react/jsx-no-undef` rule যোগ করা হয়েছে (manual `npx eslint <file>` run-এর
 * জন্য), কিন্তু CI কখনো `npm install` চালায় না (কোনো guard script-এই কোনো
 * npm package লাগে না, pure Node built-ins) -- তাই CI-level enforcement এর
 * জন্য এই script eslint/AST না ব্যবহার করে plain regex দিয়ে একই pattern ধরে,
 * বাকি guard script গুলোর মতোই (node:fs/node:path ছাড়া কোনো dependency না)।
 *
 * কী করে: frontend/src-এর ভিতরে থাকা প্রতিটা .jsx file-এ (a) সব JSX component ব্যবহার
 * (capitalized tag, `<Foo`/`<Foo.Bar` shape) বের করে, (b) সব import-করা বা
 * সেই একই file-এ local-define করা identifier বের করে, (c) কোনো ব্যবহৃত
 * component যদি কোনোটাতেই না থাকে -- flag করে।
 *
 * Scope intentionally narrow (high precision > completeness, same philosophy
 * as the other guards in this repo): শুধু `.jsx` file scan করে (JSX থাকতে
 * পারে এমন ফাইল), namespace-style ব্যবহার (`<Foo.Bar>`) হলে শুধু base
 * identifier (`Foo`) চেক করে।
 *
 * BASELINE: প্রথম run (2026-08-20)-এ পুরো `frontend/src`-এ zero violation
 * পাওয়া গেছে -- তাই কোনো BASELINE entry লাগেনি, শুরু থেকেই zero-tolerance।
 *
 * চালাও: node scripts/jsx-no-undef-guard.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, "frontend", "src");
const SKIP_DIRS = new Set(["node_modules", "dist"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith(".jsx")) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// Everything the file itself declares: imports (default/named/namespace,
// with aliasing), plus local function/const/class/let/var declarations.
function collectDefinedNames(source) {
  const names = new Set(["React", "Fragment"]);

  const importBlockRe = /import\s+([^;]+?)\s+from\s+["'][^"']+["']/g;
  let m;
  while ((m = importBlockRe.exec(source))) {
    const clause = m[1].trim();
    // import Default, { A, B as C }, * as NS
    const namedMatch = clause.match(/\{([^}]*)\}/);
    if (namedMatch) {
      for (const part of namedMatch[1].split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const asMatch = trimmed.match(/\bas\s+(\w+)/);
        names.add(asMatch ? asMatch[1] : trimmed.split(/\s+/)[0]);
      }
    }
    const before = clause.split("{")[0].replace(/,$/, "").trim();
    for (const token of before.split(",")) {
      const trimmed = token.trim();
      if (!trimmed) continue;
      const nsMatch = trimmed.match(/^\*\s+as\s+(\w+)/);
      if (nsMatch) { names.add(nsMatch[1]); continue; }
      if (/^\w+$/.test(trimmed)) names.add(trimmed);
    }
  }

  const localDeclRe = /\b(?:function|class)\s+([A-Z]\w*)/g;
  while ((m = localDeclRe.exec(source))) names.add(m[1]);

  const constDeclRe = /\b(?:const|let|var)\s+([A-Z]\w*)\s*=/g;
  while ((m = constDeclRe.exec(source))) names.add(m[1]);

  // Destructured const { Foo, Bar } = ...
  const destructureRe = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g;
  while ((m = destructureRe.exec(source))) {
    for (const part of m[1].split(",")) {
      const trimmed = part.trim().split(":").pop().trim();
      if (/^[A-Z]\w*$/.test(trimmed)) names.add(trimmed);
    }
  }

  return names;
}

// Capitalized JSX component references: <Foo, <Foo.Bar, <Foo />, closing </Foo>
// tags are skipped (they always pair with an opening tag already checked).
function collectUsedComponents(source) {
  const used = new Map(); // name -> first line number
  const jsxOpenRe = /<([A-Z]\w*)(?:\.[A-Za-z0-9_]+)?[\s/>]/g;
  let m;
  while ((m = jsxOpenRe.exec(source))) {
    const name = m[1];
    if (!used.has(name)) {
      const line = source.slice(0, m.index).split("\n").length;
      used.set(name, line);
    }
  }
  return used;
}

const files = walk(SRC_DIR);
const violations = [];

for (const file of files) {
  const raw = readFileSync(file, "utf8");
  const source = stripComments(raw);
  const defined = collectDefinedNames(source);
  const used = collectUsedComponents(source);
  for (const [name, line] of used) {
    if (!defined.has(name)) {
      violations.push({ file: relative(ROOT, file).split(sep).join("/"), line, name });
    }
  }
}

if (violations.length > 0) {
  console.error(`JSX undefined-component guard — ${violations.length} violation(s) found:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — <${v.name}> used but not imported or locally defined`);
  }
  console.error(
    "\nThis compiles fine but throws a ReferenceError and blanks the page at runtime " +
    "the moment that JSX renders — add the missing import before committing.",
  );
  process.exit(1);
}

console.log(`JSX undefined-component guard — scanned ${files.length} .jsx file(s), 0 violation(s)`);
console.log("OK — every JSX component reference resolves to an import or local definition.");
