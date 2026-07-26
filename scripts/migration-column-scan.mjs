#!/usr/bin/env node
/*
 * File-Path: scripts/migration-column-scan.mjs
 * Purpose: Static, best-effort simulation of replaying every migration file in
 *          filename order, tracking each table's KNOWN COLUMN SET as it goes,
 *          and flagging any INSERT column-list or CREATE INDEX column-list
 *          that references a column not yet known to exist on that table.
 *
 * Why this exists (2026-07-26): migration-order-scan.mjs (table-existence
 * only) missed a THIRD real prod-deploy failure — erp_production.
 * pack_code_master.bom_required, referenced in an INSERT column list, was
 * never created by any migration (added via MCP only). Table-level checking
 * is not enough; column-level drift is the more common failure mode in this
 * codebase's history, because MCP sessions routinely ADD/DROP columns on
 * already-migrated tables without ever writing that back to a migration file.
 *
 * This is regex/paren-matching based, not a real SQL parser. Every flag must
 * be manually verified against the actual migration content — this script is
 * a targeting aid, not a verdict.
 *
 * Usage: node scripts/migration-column-scan.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

const SQL_NOISE = new Set([
  "select", "true", "false", "null", "now", "coalesce", "lower", "upper",
  "trim", "cast", "extract", "count", "sum", "min", "max", "current_date",
  "gen_random_uuid", "array", "values", "default", "exists", "not", "and",
  "or", "in", "is", "on", "using", "btree", "text", "uuid", "integer",
  "numeric", "boolean", "timestamptz", "date", "jsonb", "bigint", "varchar",
  "desc", "asc", "nulls", "first", "last", "extensions", "gin_trgm_ops",
  "gist_trgm_ops", "gin", "gist", "hash",
]);

function stripComments(sql) {
  return sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Finds the balanced-paren substring immediately following `startIdx` (which
// must point at an opening '('). Returns { content, endIdx } or null.
function extractParens(sql, openIdx) {
  if (sql[openIdx] !== "(") return null;
  let depth = 0;
  for (let i = openIdx; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") {
      depth--;
      if (depth === 0) return { content: sql.slice(openIdx + 1, i), endIdx: i };
    } else if (sql[i] === "'") {
      // skip string literal
      i++;
      while (i < sql.length && sql[i] !== "'") i++;
    }
  }
  return null;
}

// Splits a paren-interior string on top-level commas (respecting nested parens/strings).
function splitTopLevel(content) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === "(") { depth++; cur += c; }
    else if (c === ")") { depth--; cur += c; }
    else if (c === "'") {
      cur += c;
      i++;
      while (i < content.length && content[i] !== "'") { cur += content[i]; i++; }
      cur += content[i] ?? "";
    } else if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim());
}

function bareIdentifier(expr) {
  // A "plain column reference" entry: just an identifier, optionally
  // schema-free, no function call, no operator, no cast to a TYPE (:: is ok
  // if what follows isn't consumed as part of identifier extraction below).
  const trimmed = expr.trim().replace(/::\w+$/i, "").trim();
  if (/^[a-zA-Z_][\w]*$/.test(trimmed) && !SQL_NOISE.has(trimmed.toLowerCase())) {
    return trimmed.toLowerCase();
  }
  return null;
}

function extractIdentifiersFromExpr(expr) {
  // For CREATE INDEX-style entries like COALESCE(variant, '') — pull out bare
  // word tokens that aren't SQL keywords/functions/casts, best-effort.
  const out = [];
  const withoutCasts = expr.replace(/::\w+/gi, "");
  const tokenRe = /[a-zA-Z_]\w*/g;
  let m;
  while ((m = tokenRe.exec(withoutCasts))) {
    const word = m[0];
    const isFunctionCall = withoutCasts[m.index + word.length] === "(";
    if (isFunctionCall) continue;
    if (SQL_NOISE.has(word.toLowerCase())) continue;
    out.push(word.toLowerCase());
  }
  return out;
}

const tableColumns = new Map(); // "schema.table" -> Set(colname lowercase)
const flags = [];

function normTable(raw) {
  return raw.replace(/"/g, "").trim().toLowerCase();
}

for (const file of files) {
  const raw = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  const sql = stripComments(raw);

  // 1. CREATE TABLE schema.table ( col1 type ..., col2 type ..., ... )
  const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][\w."]*)\s*\(/gi;
  let m;
  while ((m = createRe.exec(sql))) {
    const table = normTable(m[1]);
    const openIdx = sql.indexOf("(", m.index + m[0].length - 1);
    const parens = extractParens(sql, openIdx);
    if (!parens) continue;
    const cols = new Set();
    for (const entry of splitTopLevel(parens.content)) {
      const words = entry.trim().split(/\s+/);
      const first = words[0]?.replace(/"/g, "");
      const upper = first?.toUpperCase();
      if (["CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN"].includes(upper)) continue;
      if (first) cols.add(first.toLowerCase());
    }
    tableColumns.set(table, cols);
  }

  // 2/3. ALTER TABLE schema.table <clause>, <clause>, ...; — Postgres allows
  // multiple comma-separated ADD COLUMN / DROP COLUMN clauses under ONE
  // ALTER TABLE. Walk each full statement body (up to its terminating `;`)
  // and pick up every ADD/DROP COLUMN clause inside it, not just the first.
  const alterStmtRe = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([a-zA-Z_][\w."]*)\s+([\s\S]*?);/gi;
  while ((m = alterStmtRe.exec(sql))) {
    const table = normTable(m[1]);
    const body = m[2];
    if (!tableColumns.has(table)) tableColumns.set(table, new Set());
    const colsSet = tableColumns.get(table);

    const addRe = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_]\w*)/gi;
    let am;
    while ((am = addRe.exec(body))) colsSet.add(am[1].toLowerCase());

    const dropRe = /DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([a-zA-Z_]\w*)/gi;
    let dm;
    while ((dm = dropRe.exec(body))) colsSet.delete(dm[1].toLowerCase());
  }

  // 4. ALTER TABLE schema.table RENAME COLUMN old TO new
  const renameColRe = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z_][\w."]*)\s+RENAME\s+COLUMN\s+([a-zA-Z_]\w*)\s+TO\s+([a-zA-Z_]\w*)/gi;
  while ((m = renameColRe.exec(sql))) {
    const table = normTable(m[1]);
    const oldCol = m[2].toLowerCase();
    const newCol = m[3].toLowerCase();
    const set = tableColumns.get(table);
    if (set) { set.delete(oldCol); set.add(newCol); }
  }

  // 5. INSERT INTO schema.table (col1, col2, ...) — verify each column known.
  const insertRe = /INSERT\s+INTO\s+([a-zA-Z_][\w."]*)\s*\(/gi;
  while ((m = insertRe.exec(sql))) {
    const table = normTable(m[1]);
    const openIdx = sql.indexOf("(", m.index + m[0].length - 1);
    const parens = extractParens(sql, openIdx);
    if (!parens) continue;
    const known = tableColumns.get(table);
    if (!known) continue; // table itself unknown -> already flagged by the table-level scanner
    for (const entry of splitTopLevel(parens.content)) {
      const col = bareIdentifier(entry);
      if (col && !known.has(col)) {
        flags.push({ file, kind: "INSERT column unknown", table, column: col });
      }
    }
  }

  // 6. CREATE [UNIQUE] INDEX ... ON schema.table (col-expr, ...)
  const indexRe = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[\w."]+\s+ON\s+([a-zA-Z_][\w."]*)\s*(?:USING\s+\w+\s*)?\(/gi;
  while ((m = indexRe.exec(sql))) {
    const table = normTable(m[1]);
    const openIdx = sql.indexOf("(", m.index + m[0].length - 1);
    const parens = extractParens(sql, openIdx);
    if (!parens) continue;
    const known = tableColumns.get(table);
    if (!known) continue;
    for (const entry of splitTopLevel(parens.content)) {
      for (const ident of extractIdentifiersFromExpr(entry)) {
        if (!known.has(ident)) {
          flags.push({ file, kind: "INDEX column unknown", table, column: ident });
        }
      }
    }
  }
}

if (flags.length === 0) {
  console.log(`OK — scanned ${files.length} migration files, no unknown-column references found (regex-based, not exhaustive; verify manually).`);
  process.exit(0);
}

console.log(`Found ${flags.length} potential column-ordering issue(s) across ${files.length} migration files:\n`);
for (const f of flags) {
  console.log(`  ${f.file}\n    ${f.kind}: ${f.table}.${f.column}\n`);
}
process.exit(1);
