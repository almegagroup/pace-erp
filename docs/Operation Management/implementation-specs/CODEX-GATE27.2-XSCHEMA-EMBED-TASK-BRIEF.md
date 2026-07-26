# CODEX-GATE27.2-XSCHEMA-EMBED-TASK-BRIEF

**Gate:** 27.2
**Domain:** PRODUCTION
**Title:** Replace all cross-schema PostgREST embeds in production handlers with two-query batch joins
**Dependency:** Gate-27.1 (pack_config already fixed — use it as the reference)
**Reference commit (proven fix):** `e5b56ce` — `pack_config.handlers.ts` `listApprovedProdshadesHandler` + `listPackConfigsHandler`
**Reference doc:** `OM-IMPLEMENTATION-LOG.md` section G (2026-07-10); `CLAUDE.md` §8A (batch-resolve FKs), §8 (new-schema PostgREST note)

---

## Why this brief exists (root cause — already diagnosed, do NOT re-investigate)

`erp_production` was just exposed to PostgREST (2026-07-10). That surfaced a latent, **module-wide** bug: production handlers embed related rows that live in a **different schema** — e.g. `material:erp_master.material_master!material_id(...)` while the queried table is in `erp_production`. **PostgREST embedding is schema-local and cannot follow a foreign key into another schema.** Both spellings fail at runtime:

- `erp_master.material_master!fk` → `PGRST100` (parse error — schema-qualified embed target is not valid syntax)
- `material_master!fk` → `PGRST200` ("could not find a relationship … in the schema erp_production")

Either way the whole query 500s — even when it should return an empty array. None of these were ever exercised before because the schema was unexposed. Confirmed by direct PostgREST probe.

**Intra-schema embeds are fine and MUST be kept** — e.g. `pack_code:pack_code_master!pack_code_id(...)` where both tables are in `erp_production`. Only *cross-schema* embeds break.

**Single-table cross-schema reads are also fine** — `serviceRoleClient.schema("erp_master").from("material_master").select(...).in("id", ids)` works perfectly. The codebase already does this correctly in several places (e.g. `process_order.handlers.ts` `checkStockAvailability`, lines ~86-89). It is *only* PostgREST resource **embedding** across schemas that fails.

---

## The fix pattern (apply uniformly)

For every cross-schema embed, replace it with a **two-query batch join** that **reconstructs the exact same nested key** the embed produced, so the JSON response shape is byte-compatible and **no frontend change is needed**.

**Before (broken):**
```typescript
const { data, error } = await serviceRoleClient
  .schema("erp_production").from("process_order_line")
  .select(`
    id, material_id, planned_qty, uom_code,
    material:erp_master.material_master!material_id(id, pace_code, material_name, base_uom_code, production_mode)
  `)
  .eq("process_order_id", orderId);
```

**After (two-query batch join, same output shape):**
```typescript
const { data: rows, error } = await serviceRoleClient
  .schema("erp_production").from("process_order_line")
  .select(`id, material_id, planned_qty, uom_code`)
  .eq("process_order_id", orderId);
if (error) { console.error("[<handler>] line query failed:", JSON.stringify(error)); throw new Error("<EXISTING_ERROR_CODE>"); }

const lines = (rows ?? []) as JsonRecord[];
const matIds = [...new Set(lines.map((r) => String(r.material_id ?? "")).filter(Boolean))];
const matMap = new Map<string, JsonRecord>();
if (matIds.length > 0) {
  const { data: mats, error: matErr } = await serviceRoleClient
    .schema("erp_master").from("material_master")
    .select("id, pace_code, material_name, base_uom_code, production_mode")
    .in("id", matIds);
  if (matErr) { console.error("[<handler>] material query failed:", JSON.stringify(matErr)); throw new Error("<EXISTING_ERROR_CODE>"); }
  for (const m of (mats ?? []) as JsonRecord[]) matMap.set(String(m.id), m);
}

const result = lines.map((r) => ({
  ...r,
  material: matMap.get(String(r.material_id ?? "")) ?? null,   // reconstruct the embedded key EXACTLY
}));
```

### Hard rules
1. **Select exactly the same columns** the embed selected (so the reconstructed object has the same fields).
2. **Reconstruct the embed key with the same alias.** If the embed was `material:...`, attach `material`. If it was `sku:...`, attach `sku`. If `old_material:` / `new_material:` / `rm_sloc:` etc., keep those exact aliases. When two aliases point at the same target table with different FK columns (e.g. `old_material!old_material_id` + `new_material!new_material_id`), fetch both id sets, build one map, and attach both keys.
3. **Keep every intra-schema embed untouched** (same-schema `pack_code_master`, `process_order_line`, etc.). Only pull out the `erp_master.*` and `erp_inventory.*` embeds.
4. **Preserve the missing-row behavior of an embed:** an embed yields `null` when no match — so attach `?? null`, never `?? {}`, and never throw just because a material is missing.
5. **Batch, don't loop** (CLAUDE.md §8B): one `.in("id", ids)` per related table per handler, dedupe ids via `Set`. Never fetch per-row in a loop.
6. **Add `console.error(..., JSON.stringify(error))` before every new `throw`** (matches the reference commit + `vendor.handlers.ts` convention) so future failures surface the real Postgres error.
7. **Do not change any existing error code, status, or `okResponse` shape.**
8. For nested cases where the embed is inside a line array (pack_bom lines, stroke_change_request lines), collect ids across **all** lines first, one batched fetch, then map back onto each line.

---

## Files and embeds to fix (22 embeds across 7 files)

Run this grep first to get exact current line numbers (they may have shifted):
```
grep -rn "erp_[a-z]*\.[a-z_]*![a-z_]*(" supabase/functions/api/_core/production/*.ts
```

| File | Embeds | Target(s) |
|---|---|---|
| `process_order.handlers.ts` | 3 | `erp_master.material_master` (lines ~55, 192, 224) |
| `packing_order.handlers.ts` | 5 | `erp_master.material_master` (lines ~77, 113, 127, 376, 452) |
| `pack_bom.handlers.ts` | 4 | `erp_master.material_master` as `sku:` and `material:` (lines ~54, 87, 92, 433) — nested in lines |
| `plan_feed.handlers.ts` | 2 | `erp_master.material_master` (lines ~51, 85) |
| `stroke_change_request.handlers.ts` | 3 | `erp_master.material_master` incl. `old_material:`/`new_material:` (lines ~90, 109, 110) — nested in lines |
| `batch_series.handlers.ts` | 1 | `erp_master.material_master` (line ~42) |
| `segment_location.handlers.ts` | 4 | `erp_inventory.storage_location_master` as `rm_sloc:`/`pm_sloc:`/`shopfloor_sloc:`/`fg_sloc:` (lines ~40-43) — 4 different FK columns → one batched fetch of `storage_location_master` by the union of the 4 id sets, attach 4 keys |

**`segment_location.handlers.ts` note:** the 4 embeds are 4 different FK columns (`rm_sloc_id`, `pm_sloc_id`, `shopfloor_sloc_id`, `fg_sloc_id`) all pointing at `erp_inventory.storage_location_master`. Collect all four id values across the rows into one `Set`, do ONE `.schema("erp_inventory").from("storage_location_master").select("id, code, name").in("id", allIds)`, build one map, then attach `rm_sloc`/`pm_sloc`/`shopfloor_sloc`/`fg_sloc` per row from that map (each `?? null`).

---

## Explicitly OUT OF SCOPE

- **`stroke_master.handlers.ts`** (4 embeds, lines ~187, 224, 229, 230) — a concurrent session owns this file. **Do NOT touch it.** It has the same bug and must be fixed too, but by that session, to avoid a shared-working-tree clobber. Leave it alone.
- **`pack_config.handlers.ts`** — already fixed in `e5b56ce`. Do not touch.
- No migrations. No frontend changes (the whole point of reconstructing the embed key is that frontends keep working unchanged). No route/ACL changes.

---

## Verification (Codex: do this before writing the log entry)

1. `deno check` each modified file. There is a known **pre-existing** set of ~13 codebase-wide `DbClient`/implicit-any errors in `serviceRoleClient.ts`, `canonical_access.ts`, `context.ts` — those are NOT yours; only care about errors anchored in the files you edited (`grep "<file>.ts:"` should be empty).
2. For each handler you touched, re-read the frontend/consumer that reads its response and confirm the field it reads (e.g. `row.material.pace_code`, `line.sku.material_name`, `cfg.rm_sloc.code`) still exists on the reconstructed object. If any consumer read a field the embed selected, make sure your select list includes it.
3. Confirm no new `for`/`for...of` + `await` per-row DB loop was introduced (CLAUDE.md §8B) — all related-table reads must be a single batched `.in()`.

## Log + commit

Append an entry to `OM-IMPLEMENTATION-LOG.md` (list files, embeds fixed per file, any consumer field you had to add to a select list, and confirm stroke_master was left untouched). Commit with your `Co-Authored-By: Codex` marker; stage only the 7 handler files + the log. Do not `git add -A`.
