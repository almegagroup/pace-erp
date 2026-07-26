# CODEX-GATE27.19-BATCH-NUMBER-PERSISTENCE-TASK-BRIEF

**Gate:** 27.19
**Domain:** PRODUCTION / INVENTORY
**Title:** Add batch_number persistence to the stock posting engine (MTO/HPS scope only)
**Scope:** 1 migration + `post_stock_movement()` function change + targeted call-site updates in Process PO and Packing PO handlers
**Dependency:** None on Gate-27.18 (PR09) — this is independent, backend/engine-level work
**Reference doc:** feasibility Section 83.7, subsection **"Batch Number Persistence Mechanism"** (LOCKED — 2026-07-12) — read this in full before starting, it is the single source of truth for this brief

---

## Why this brief exists

A direct DB check found the stock posting engine cannot carry a batch number at all today: `erp_inventory.stock_ledger.batch_id` (UUID) exists but has no FK, is never written by any handler, and is 0/21 NULL on every live row. `erp_inventory.post_stock_movement()` (both overloads) has no batch parameter in its signature. This blocks any batch-level FG dispatch, PID, or costing work for MTO/HPS. This brief lands the fix — schema plus the specific call sites that need to start passing a batch number. It does **not** design or implement dispatch, PID, or costing themselves — those are separate, still-open items.

---

## Change 1 — Migration

Create a new migration that:

1. On `erp_inventory.stock_ledger`: drop the `batch_id` column (confirm first via `information_schema` that it truly has no FK and no non-null rows in Dev before dropping — if either is false, STOP and flag it, do not drop). Add `batch_number TEXT NULL`.
2. On `erp_production.packing_order`: add `batch_number TEXT NULL`.
3. Idempotent (`IF NOT EXISTS` / `IF EXISTS` guards), no data backfill needed (both source tables have no meaningful existing batch data to migrate).

---

## Change 2 — `post_stock_movement()` function change

**Both overloads** (the one with `p_plant_id` and the one without) need one new parameter appended **last**, with a default:

```sql
p_batch_number TEXT DEFAULT NULL
```

The function should write this value into the new `stock_ledger.batch_number` column on insert. This must be genuinely backward-compatible — do not change the position or defaults of any existing parameter. Every current caller (GRN, RTV, STO, Sales Order, Opening Stock, Physical Inventory, and any other caller not listed in Change 3 below) must continue to work with zero code changes, resolving to `batch_number = NULL` exactly as today. This mirrors the same non-breaking extension pattern already used for `item_number` in feasibility Section 105 — read that section too if the exact mechanics of "add a param without breaking existing callers" aren't already obvious from the current function body.

---

## Change 3 — Call sites that must now pass `p_batch_number` (MTO/HPS scope only)

Update these specific call sites in `supabase/functions/api/_core/production/process_order.handlers.ts` and the equivalent Packing PO handler file to pass `p_batch_number`:

| Call site | Movement | Batch value to pass |
|---|---|---|
| `verifyProcessOrderHandler` | P101 (SFG receipt) | `process_order.batch_number` |
| `reverseProcessOrderHandler` (CORS) | P262, P322, P102 | the same batch being reversed (read from the process_order row before it's cleared) |
| Packing PO Final handler | P261 (SFG issue) + P101 (FG receipt) | the linked Process PO's `batch_number` — **and this is also the exact moment `packing_order.batch_number` itself gets set** (update the row alongside the movement postings, in the same transaction/flow) |
| Packing PO reversal handler | P262, P102 | same batch |

**Explicitly do not touch:** RM/PM issue (P261 on the input/consumption side stays batch-less — RM/PM use a separate GRN-lot mechanism, not this field), INT's P101 (INT has no batch number per §83.5), anything under MTS/MTEST, and Opening Stock / PID (those are out of scope for this brief specifically — see "Out of scope" below, they need their own follow-up once their own handlers are touched for other reasons).

If `packing_order`'s Final logic lives in a file you haven't seen yet, locate it first (search for wherever `packing_order` status transitions to a Final-equivalent and posts P261/P101) rather than guessing a file name.

---

## Hard rules

1. Do not change any existing parameter's position, type, or default in `post_stock_movement()` — only append the one new optional parameter.
2. Do not touch Opening Stock or PID handlers in this brief — they're explicitly out of scope here (see below).
3. Do not add batch_number handling to RM/PM/INT/MTS/MTEST paths.
4. Do not invent a `batch` master table or add any FK — `batch_number` is a plain denormalized text value, matching how `process_order.batch_number` itself already works.
5. If you find the Packing PO Final logic doesn't cleanly map to a single handler function, or the existing code structure makes "set `packing_order.batch_number` exactly at SFG-issue time" ambiguous, stop and describe the ambiguity in the log rather than guessing a different timing.

## Out of scope

- Opening Stock and PID call sites (separate future brief — they need batch_number too per the locked doc, but are deliberately excluded here to keep this brief small)
- Any batch-aware stock balance/availability query (reading stock by batch) — this brief is write-side only
- Dispatch, partial reversal for salvage, return+repack workflow, salvage-blend RM decomposition, reusable-PM flag — all separate, still-open design items, not part of this brief

## Verification

1. Confirm `stock_ledger.batch_id` is genuinely unused before dropping it (re-verify the 0-populated-rows claim yourself against current Dev data, don't just trust this brief).
2. Confirm every existing `post_stock_movement()` call site in the entire codebase still compiles/type-checks without modification.
3. Confirm the four listed call sites now pass the correct batch value.
4. Confirm `packing_order.batch_number` gets set at Final's SFG-issue moment, not at Packing PO creation.
5. `deno check` clean (only the same pre-existing shared-typing errors already documented in prior Gate-27 log entries, no new ones).

## Log + commit

- Append one entry to `docs/Codex-Log.md`
- Do not run git commands
