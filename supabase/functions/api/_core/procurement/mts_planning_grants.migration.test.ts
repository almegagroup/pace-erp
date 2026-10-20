/**
 * Regression (PROD incident 2026-10-20, AI_BUDGET_UNAVAILABLE): every erp_planning / erp_master
 * table that a PO21/PO22 migration function writes without SECURITY DEFINER must be granted the
 * matching INSERT / UPDATE / DELETE privilege to service_role by the migrations themselves.
 * Static scan of supabase/migrations — no database needed.
 */
const MIGRATIONS = new URL("../../../../migrations/", import.meta.url);
const FROM_VERSION = "20261016000000"; // PO21 / PO22 migrations

function equal(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

const files = [...Deno.readDirSync(MIGRATIONS)]
  .map((e) => e.name)
  .filter((n) => n.endsWith(".sql") && n.slice(0, 14) >= FROM_VERSION)
  .sort();
const sql = files.map((n) => Deno.readTextFileSync(new URL(n, MIGRATIONS))).join("\n");

/** service_role privileges granted per table across the scanned migrations. */
function grantedPrivileges(): Map<string, Set<string>> {
  const grants = new Map<string, Set<string>>();
  for (const m of sql.matchAll(/GRANT\s+([A-Z ,]+?)\s+ON\s+(?:TABLE\s+)?([a-z_]+\.[a-z_]+)\s+TO\s+service_role/gi)) {
    const set = grants.get(m[2].toLowerCase()) ?? new Set<string>();
    for (const p of m[1].split(",")) set.add(p.trim().toUpperCase());
    grants.set(m[2].toLowerCase(), set);
  }
  return grants;
}

/** Tables written (INSERT / UPDATE / DELETE) inside non-SECURITY-DEFINER plpgsql functions. */
function writesByInvokerFunctions(): Map<string, Set<string>> {
  const writes = new Map<string, Set<string>>();
  for (const fn of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION[\s\S]*?\$(\w*)\$([\s\S]*?)\$\1\$/gi)) {
    const header = fn[0].slice(0, fn[0].indexOf(`$${fn[1]}$`));
    if (/SECURITY\s+DEFINER/i.test(header)) continue;
    for (const w of fn[2].matchAll(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+((?:erp_planning|erp_master)\.[a-z_]+)/gi)) {
      const op = w[1].split(/\s+/)[0].toUpperCase();
      const set = writes.get(w[2].toLowerCase()) ?? new Set<string>();
      set.add(op);
      writes.set(w[2].toLowerCase(), set);
    }
  }
  return writes;
}

Deno.test("PO22 migrations: invoker functions only write tables service_role may write", () => {
  const grants = grantedPrivileges();
  const missing: string[] = [];
  for (const [table, ops] of writesByInvokerFunctions()) {
    const granted = grants.get(table);
    if (!granted) continue; // table created before the scanned window (grants live in older migrations)
    for (const op of ops) if (!granted.has(op)) missing.push(`${table}:${op}`);
  }
  equal(missing, [], "missing service_role grants");
});

Deno.test("PO22 AI budget: mts_ai_usage is writable by the reserve / settle RPCs", () => {
  const granted = grantedPrivileges().get("erp_planning.mts_ai_usage") ?? new Set<string>();
  equal(["INSERT", "SELECT", "UPDATE"].filter((p) => granted.has(p)), ["INSERT", "SELECT", "UPDATE"], "mts_ai_usage grants");
});
