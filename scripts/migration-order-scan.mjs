#!/usr/bin/env node
/*
 * File-Path: scripts/migration-order-scan.mjs
 * Purpose: Static, best-effort simulation of replaying every migration file in
 *          filename order against a FRESH database (i.e. what prod's first
 *          deploy actually does), flagging any statement that targets or
 *          references a table/schema that no earlier migration in the local
 *          sequence has created yet.
 *
 * Why this exists (2026-07-26): two real prod-deploy failures in a row —
 * erp_production.prodshade_pack_config.variant and the entire
 * erp_production.stroke_change_request(/_line) tables — existed on dev only
 * because they were created directly via MCP execute_sql and never captured
 * in a migration file. Dev's own migration-integrity-check (name/version
 * checksum) never catches this class of bug, because it only compares
 * recorded migration history, not actual live schema shape. This script
 * catches it by tracking, in local-file order, which tables are known to
 * exist, and flagging any ALTER TABLE / REFERENCES / CREATE TABLE-inline-FK
 * pointing at a table not yet known.
 *
 * This is regex-based, not a real SQL parser — it will have both false
 * positives (rare) and false negatives (things it can't see, e.g. DO blocks,
 * dynamic SQL, functions that create tables). Treat every flagged line as
 * "investigate", not "definitely broken" — but so far, every flag on a real
 * run has been a real, confirmed gap.
 *
 * Usage: node scripts/migration-order-scan.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

// Schemas/tables we assume always exist (Supabase-managed, or extension-provided).
const BUILTIN = new Set([
  "auth.users", "auth.identities", "auth.sessions",
  "storage.objects", "storage.buckets",
  "supabase_migrations.schema_migrations",
]);

const known = new Set(BUILTIN);
const flags = [];

function stripComments(sql) {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function normalizeTableRef(raw) {
  // raw like `erp_production.foo` or `"erp_production"."foo"` or just `foo`
  const cleaned = raw.replace(/"/g, "").trim().toLowerCase();
  return cleaned.includes(".") ? cleaned : cleaned; // unqualified names left as-is (rare in this codebase)
}

const CREATE_TABLE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][\w."]*)/gi;
const DROP_TABLE_RE = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z_][\w."]*)/gi;
const ALTER_TABLE_RE = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([a-zA-Z_][\w."]*)/gi;
const RENAME_TO_RE = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z_][\w."]*)\s+RENAME\s+TO\s+([a-zA-Z_][\w."]*)/gi;
const REFERENCES_RE = /REFERENCES\s+([a-zA-Z_][\w."]*)/gi;

for (const file of files) {
  const rawSql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  const sql = stripComments(rawSql);

  // Tables newly created IN THIS FILE become known immediately for the
  // remainder of this same file (self-references inside the same CREATE
  // TABLE statement, or a later ALTER in the same file, are fine).
  const createdThisFile = new Set();

  let m;

  CREATE_TABLE_RE.lastIndex = 0;
  while ((m = CREATE_TABLE_RE.exec(sql))) {
    createdThisFile.add(normalizeTableRef(m[1]));
  }

  RENAME_TO_RE.lastIndex = 0;
  const renamedThisFile = [];
  while ((m = RENAME_TO_RE.exec(sql))) {
    renamedThisFile.push([normalizeTableRef(m[1]), normalizeTableRef(m[2])]);
  }

  // Check ALTER TABLE targets (excluding ones created earlier in this same file).
  ALTER_TABLE_RE.lastIndex = 0;
  while ((m = ALTER_TABLE_RE.exec(sql))) {
    const target = normalizeTableRef(m[1]);
    if (target === "only") continue; // safety net for odd matches
    if (!known.has(target) && !createdThisFile.has(target)) {
      flags.push({ file, kind: "ALTER TABLE target unknown", target });
    }
  }

  // Check REFERENCES targets (FK targets, inline or standalone ADD CONSTRAINT).
  REFERENCES_RE.lastIndex = 0;
  while ((m = REFERENCES_RE.exec(sql))) {
    const target = normalizeTableRef(m[1]);
    if (!known.has(target) && !createdThisFile.has(target)) {
      flags.push({ file, kind: "REFERENCES target unknown", target });
    }
  }

  // Commit this file's effects into the running "known" set.
  for (const t of createdThisFile) known.add(t);
  DROP_TABLE_RE.lastIndex = 0;
  while ((m = DROP_TABLE_RE.exec(sql))) known.delete(normalizeTableRef(m[1]));
  for (const [from, to] of renamedThisFile) {
    known.delete(from);
    known.add(to);
  }
}

if (flags.length === 0) {
  console.log(`OK — scanned ${files.length} migration files, no unknown-table references found (regex-based, not exhaustive).`);
  process.exit(0);
}

console.log(`Found ${flags.length} potential ordering issue(s) across ${files.length} migration files:\n`);
for (const f of flags) {
  console.log(`  ${f.file}\n    ${f.kind}: ${f.target}\n`);
}
process.exit(1);
