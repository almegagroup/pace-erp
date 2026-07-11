# CODEX-GATE27.4-RESERVATION-PRUNE-TASK-BRIEF

**Gate:** 27.4
**Domain:** PRODUCTION
**Title:** Process PO Reservation mechanism (reserve at Standard save, clear at Prune) + availability netting + new Prune endpoint
**Scope:** 1 migration + backend only (**no frontend**)
**Dependency:** Gate-27.3 (Process PO create now works)
**Reference doc:** feasibility §83.5 (Material Reservation Mechanism, Reservation sources, Stock check severity), §83.4 (PO Prune — STANDARD → CANCELLED); `PACE_ERP_MASTER_CONSTITUTION.md` §9 (File Header), §10 (Migration-First, idempotent), §16 (schema-first `db.schema()`); `CLAUDE.md` §8A Rule 4 (migration vs MCP), §8B (batch vs sequential loops); Gate-27.1 log lesson (register new `/api/production/*` routes in `route-acl-registry.ts`).

---

## Why this brief exists (design — already LOCKED in §83.5, do NOT re-design)

Per §83.5, a Process PO **Standard save** must create a **Reservation Document** per component line — a *soft hold* (no stock movement; material stays UNRESTRICTED, but its reserved qty is deducted from freely-available). Reservation is **keyed by material + plant(company) + storage location**, and nets **only against UNRESTRICTED** stock. **PO Prune (at STANDARD) → CANCELLED** must cancel those reservations.

Today none of this exists: no reservation table, no reservation logic, and there is **no Prune endpoint at all** (only `reverse`). The availability check (`checkStockAvailability`) sums company-wide UNRESTRICTED but does **not** subtract reservations.

### Locked reservation lifecycle (§83.5)
```
Process PO Standard Save → Reservation Document OPEN (one per component line)
Process PO PRUNE/Cancel  → Reservation Document CANCELLED (no stock impact)
```
(Issue-at-Verify updating Issued/Balance/PARTIAL/FULLY_ISSUED is a LATER task — see Out of Scope.)

### Two kinds of "status" — do not confuse
- **Stock type** (UNRESTRICTED / QA / BLOCKED…): reservation always implicitly nets against **UNRESTRICTED** only. The reservation table does **NOT** get a stock-type column.
- **Reservation's own status** (OPEN / PARTIAL / FULLY_ISSUED / CANCELLED): a lifecycle column on the reservation row.

---

## Change 1 — Migration (NEW file)

Create `supabase/migrations/20260711100000_gate27_reservation_document_and_prune.sql`. Must be **idempotent + order-safe** (Constitution §10). Do NOT apply it — Claude applies to Dev via MCP and reconciles the timestamp.

**A. New table `erp_production.reservation_document`** (generic for all 5 future sources; only Process PO is wired now):

```sql
CREATE SEQUENCE IF NOT EXISTS erp_production.reservation_number_seq;

CREATE TABLE IF NOT EXISTS erp_production.reservation_document (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_number  text NOT NULL DEFAULT ('RESV' || lpad(nextval('erp_production.reservation_number_seq')::text, 8, '0')),
  source_type         text NOT NULL DEFAULT 'PROCESS_PO'
                        CHECK (source_type = ANY (ARRAY['PROCESS_PO','PACKING_PO','SALES_ORDER','STO','LOCATION_TRANSFER'])),
  source_id           uuid NOT NULL,              -- the process_order id (parent doc)
  source_line_id      uuid,                        -- the process_order_line id (traceability)
  company_id          uuid NOT NULL,               -- plant
  material_id         uuid NOT NULL,
  storage_location_id uuid,                         -- nullable: resolved from segment config / line override; may be NULL until segment config seeded
  required_qty        numeric NOT NULL CHECK (required_qty >= 0),
  uom_code            text NOT NULL DEFAULT 'KG',
  required_by_date    date,
  issued_qty          numeric NOT NULL DEFAULT 0 CHECK (issued_qty >= 0),
  balance_qty         numeric GENERATED ALWAYS AS (required_qty - issued_qty) STORED,
  status              text NOT NULL DEFAULT 'OPEN'
                        CHECK (status = ANY (ARRAY['OPEN','PARTIAL','FULLY_ISSUED','CANCELLED'])),
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_updated_by     uuid,
  last_updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_reservation_avail
  ON erp_production.reservation_document (material_id, company_id, storage_location_id, status);
CREATE INDEX IF NOT EXISTS ix_reservation_source
  ON erp_production.reservation_document (source_type, source_id);
```

**B. Grants** — mirror EXACTLY the roles/privileges that already exist on `erp_production.process_order` (so PostgREST + service_role behave identically). Add a `GRANT USAGE, SELECT ON SEQUENCE erp_production.reservation_number_seq` to the same role(s). (Inspect process_order's grants and replicate; do not invent a different grant set.)

**C. Prune support on `erp_production.process_order`:**
```sql
ALTER TABLE erp_production.process_order
  ADD COLUMN IF NOT EXISTS prune_reason text,
  ADD COLUMN IF NOT EXISTS pruned_by    uuid,
  ADD COLUMN IF NOT EXISTS pruned_at    timestamptz;

-- status CHECK currently lacks CANCELLED (verified live). Replace it to add CANCELLED.
ALTER TABLE erp_production.process_order DROP CONSTRAINT IF EXISTS process_order_status_check;
ALTER TABLE erp_production.process_order ADD CONSTRAINT process_order_status_check
  CHECK (status = ANY (ARRAY['STANDARD','QA_APPROVED','QA_REJECTED','BATCH_STARTED','FINAL','VERIFIED','REVERSED','CANCELLED']));
```

---

## Change 2 — Reserve at Standard save (`process_order.handlers.ts` → `createProcessOrderHandler`)

After the PO and its component lines are inserted, create one OPEN reservation per inserted component line.

1. Change the line INSERT(s) so the inserted rows are returned with their ids: add `.select("id, material_id, planned_qty, issue_sloc_id, is_rm")` to the stroke-prepopulate insert (and the manual-lines insert). Collect all inserted lines into one array.
2. Resolve the storage location: fetch segment config once via the existing `getSegmentLocConfig(companyId, segmentCode)`. For each line, `storage_location_id = line.issue_sloc_id ?? (line.is_rm ? segConfig?.rm_sloc_id : segConfig?.pm_sloc_id) ?? null`. **NULL is acceptable** (segment config is currently empty in Dev — do not error on missing config here).
3. **Batch-insert** all reservation rows in ONE `.insert([...])` (CLAUDE.md §8B — these are INDEPENDENT, never loop per-row). Each row:
   - `source_type: 'PROCESS_PO'`, `source_id: poId`, `source_line_id: line.id`
   - `company_id`, `material_id: line.material_id`, `storage_location_id` (resolved above)
   - `required_qty: line.planned_qty`, `uom_code: line.uom_code || 'KG'`
   - `required_by_date`: from `body.planned_start_date` if present, else null
   - `status: 'OPEN'`, `created_by: ctx.auth_user_id`
   - Do NOT set `reservation_number`, `balance_qty` (DB generates them).
4. Leave `reservation_number` generation entirely to the DB default (race-free per CLAUDE.md §8B). Do not build it in TS.

> The availability check already runs BEFORE the PO/line/reservation inserts, so this PO's own reservations correctly do not count against itself.

---

## Change 3 — New Prune endpoint (`process_order.handlers.ts` + routes + ACL registry)

**New handler `pruneProcessOrderHandler`:**
- `assertProdReadRole(ctx)` (same guard as create).
- `id` from path; fetch PO. 404 if missing.
- If `po.status !== 'STANDARD'` → 422 `PROD_PO_PRUNE_STATUS_INVALID` ("Prune allowed only at STANDARD").
- `reason = toTrimmedString(body.reason)`; if empty → 400 `PROD_PO_PRUNE_REASON_REQUIRED`.
- Update PO: `status='CANCELLED', prune_reason=reason, pruned_by=ctx.auth_user_id, pruned_at=now, last_updated_*`.
- Cancel reservations in ONE bulk UPDATE: `reservation_document SET status='CANCELLED', last_updated_by, last_updated_at WHERE source_type='PROCESS_PO' AND source_id=id AND status <> 'CANCELLED'`.
- Return `okResponse({ id, status: 'CANCELLED' }, ...)`.

**Route** (`_routes/production.routes.ts`): add, next to the existing `/reverse` route:
```ts
if (/^\/api\/production\/process-orders\/[^/]+\/prune$/.test(pathname) && req.method === "POST") {
  return await pruneProcessOrderHandler(req, ctx);
}
```
Import `pruneProcessOrderHandler` in the handler import block.

**ACL registry** (`_acl/route-acl-registry.ts`): register `POST /api/production/process-orders/:id/prune` with the SAME resource/action mapping the sibling process-order write routes use (e.g. copy the `/reverse` or `/start-batch` entry). Missing registration → the route is denied (403) — do not skip this.

---

## Change 4 — Availability netting (`process_order.handlers.ts` → `checkStockAvailability`)

After building the `available` map (UNRESTRICTED sum + INT planned output), subtract open reservations:
- Query `erp_production.reservation_document` `.select("material_id, balance_qty").eq("company_id", companyId).in("material_id", matIds).in("status", ["OPEN","PARTIAL"])`.
- Sum `balance_qty` per `material_id`, subtract from that material's `available`.
- Keep the existing shortfall comparison unchanged.

> **Interim granularity (intentional, documented):** net by **material + company** (matching the current company-wide UNRESTRICTED sum). The table and index are already storage-location-keyed, so when segment config + per-location stock snapshots land later, this query moves to per-location netting with no schema change. Do NOT attempt per-location netting now (storage_location is NULL while segment config is empty — it would just break). Add a one-line comment saying so.

---

## Hard rules
1. Implement **only** §83.5's locked reserve-at-Standard + clear-at-Prune + availability-netting, plus the Prune endpoint. **No design beyond the doc.** No extra fields, no reserve-at-approve (reserve is at Standard save, per doc — not at QA approve).
2. **No frontend changes.** The "red / per-line available" grid is a separate later task.
3. **Do NOT** implement issue-at-Verify (updating issued_qty/balance/PARTIAL/FULLY_ISSUED), and do NOT touch `verifyProcessOrderHandler`, `finalize`, `startBatch`, `qa*`, or `reverse` — those are separate tasks.
4. Batch all reservation inserts / cancels (§8B). Never per-row loop with await. `checkStockAvailability` reservation read = one batched `.in()`.
5. Every query uses `serviceRoleClient.schema("erp_production")…` (Constitution §16). Migration idempotent (§10).
6. Migration file: create it, **do NOT apply it, do NOT run any git commands.** Claude applies to Dev via MCP and reconciles the filename timestamp.
7. New/edited files keep the mandatory file header (Constitution §9). `process_order.handlers.ts` already has one — don't break it.
8. Add `console.error(..., JSON.stringify(error))` before any new `throw` (existing convention in this file).

## Out of scope (do NOT do)
- Issue-at-Verify reservation updates (PARTIAL/FULLY_ISSUED, P261 wiring).
- `machine_id` column / machine assignment.
- Reservation for Packing PO / Sales Order / STO / Location Transfer (table is generic-ready, but only Process PO is wired now).
- CORS/reverse redesign; the reco table; per-location availability.
- Any frontend file.

## Verification (Codex: before writing the log entry)
1. `deno check` the edited handler/route/registry files — only care about errors anchored in files you edited (ignore the known pre-existing shared `serviceRoleClient.ts`/`canonical_access.ts`/`context.ts` typing errors).
2. Re-read your migration: confirm idempotent (IF NOT EXISTS / DROP…IF EXISTS), the `CANCELLED` status is added, grants mirror `process_order`.
3. Confirm no per-row awaited DB loop was introduced; reservation insert/cancel are single batched statements.
4. Confirm no frontend file and no other handler changed.

## Log + commit
- Append one entry to `docs/Codex-Log.md` (existing template, dated today): the new table + prune columns + status-constraint change, reserve-at-Standard, new Prune endpoint + route + ACL registration, availability netting; list files touched.
- **Do NOT run any git commands.** Claude reviews, applies the migration to Dev, then stages/commits.
