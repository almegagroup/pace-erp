#!/usr/bin/env node
/*
 * File-Path: scripts/migration-integrity-check.mjs
 * Domain: TOOLING / DB
 * Purpose: Detect drift between local migration FILES and a remote database's
 *          supabase_migrations.schema_migrations history.
 *
 * Why this exists (learned the hard way twice — CLAUDE.md §4-old-D, and again 2026-07-18):
 *   MCP `apply_migration` records the migration under ITS OWN timestamp, not the one in the local
 *   filename. Applying DDL via MCP `execute_sql` records nothing at all. Either way local and
 *   remote silently diverge, and it only surfaces much later as
 *   `supabase db push` → "Remote migration versions not found in local migrations directory".
 *
 * This script never connects to a database — it prints SQL you run against the target project
 * (via MCP execute_sql, the SQL editor, or psql). So the same script works for dev AND prod
 * without holding any credentials.
 *
 * Usage:
 *   node scripts/migration-integrity-check.mjs           # fast checksum probe (run this normally)
 *   node scripts/migration-integrity-check.mjs --diff    # full row-by-row diff (run when checksum fails)
 *   node scripts/migration-integrity-check.mjs --list    # just list local versions
 */

import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

const parsed = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => {
    const m = /^(\d+)_(.*)\.sql$/.exec(f);
    return m ? { version: m[1], name: m[2], file: f } : { version: null, name: null, file: f };
  });

let fatal = false;

const malformed = parsed.filter((p) => !p.version);
if (malformed.length > 0) {
  console.error("❌ Malformed migration filenames (expected <version>_<name>.sql):");
  for (const m of malformed) console.error("   " + m.file);
  fatal = true;
}

const good = parsed.filter((p) => p.version).sort((a, b) => a.version.localeCompare(b.version));

const seen = new Map();
for (const p of good) {
  if (seen.has(p.version)) {
    console.error(`❌ Duplicate migration version ${p.version}: ${seen.get(p.version)} <-> ${p.file}`);
    fatal = true;
  } else seen.set(p.version, p.file);
}

if (fatal) process.exit(1);

if (process.argv.includes("--list")) {
  for (const p of good) console.log(`${p.version}  ${p.name}`);
  console.log(`\n${good.length} local migration files.`);
  process.exit(0);
}

// Same canonical form the SQL side builds: "version|name" joined by "," in version order.
const canonical = good.map((p) => `${p.version}|${p.name}`).join(",");
const localMd5 = createHash("md5").update(canonical).digest("hex");

if (process.argv.includes("--diff")) {
  const values = good.map((p) => `('${p.version}','${p.name}')`).join(",\n    ");
  console.log(`-- FULL DIFF — ${good.length} local files. Zero rows = in sync.
WITH local_files(version, name) AS (VALUES
    ${values}
)
SELECT COALESCE(l.version, r.version) AS version,
       COALESCE(l.name, r.name)       AS name,
       CASE
         WHEN r.version IS NULL THEN 'LOCAL_ONLY  -> not recorded remotely (applied via execute_sql, or never applied)'
         WHEN l.version IS NULL THEN 'REMOTE_ONLY -> recorded remotely with no local file (db push WILL fail)'
         ELSE 'NAME_MISMATCH -> same version, different name'
       END AS drift
FROM local_files l
FULL OUTER JOIN supabase_migrations.schema_migrations r ON r.version = l.version
WHERE l.version IS NULL OR r.version IS NULL OR r.name IS DISTINCT FROM l.name
ORDER BY 1;`);
  process.exit(0);
}

console.log(`-- Migration integrity CHECKSUM probe
-- LOCAL:  count=${good.length}  md5=${localMd5}
-- Run this against the target project. Both values must match the LOCAL line above.
-- If they do NOT match, re-run with --diff to see exactly which migrations drifted.
SELECT count(*) AS remote_count,
       md5(string_agg(version || '|' || name, ',' ORDER BY version)) AS remote_md5,
       ${good.length} AS expected_count,
       '${localMd5}' AS expected_md5,
       (count(*) = ${good.length}
        AND md5(string_agg(version || '|' || name, ',' ORDER BY version)) = '${localMd5}') AS in_sync
FROM supabase_migrations.schema_migrations;`);
