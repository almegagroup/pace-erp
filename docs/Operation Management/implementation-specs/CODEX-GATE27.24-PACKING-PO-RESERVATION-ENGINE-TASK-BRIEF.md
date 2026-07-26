# CODEX-GATE27.24-PACKING-PO-RESERVATION-ENGINE-TASK-BRIEF

**Gate:** 27.24
**Domain:** PRODUCTION
**Title:** Reservation engine for Packing PO — generic PM reservation (mirrors Process PO) + batch-specific SFG reservation (new mechanism) + batch-aware availability checks at Create/Final/Reverse/Correct.
**Scope:** extend `packing_order.handlers.ts` only. No new tables beyond the already-applied `reservation_document.batch_number` column. No frontend changes required (reservation is a backend hard-block, not a new UI surface) unless you find the existing Packing PO Create/Detail pages need a shortage message surfaced — check `PackingOrderPage.jsx` first.
**Dependency:** Hard dependency on Gate-27.22 and Gate-27.23 (both landed and verified against Dev as of 2026-07-13). Do not start until those are confirmed working.
**Reference doc:** feasibility doc, subsection **"Packing PO Reservation — Batch-Specific SFG Line (LOCKED — 2026-07-13)"**, inside §83.4 (`docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`, immediately after the "Reservation sources (LOCKED — 2026-07-11)" table). Read the whole subsection before writing code — this brief summarizes it but the doc has the full reasoning for *why* each rule exists, which matters for judgment calls you'll hit while implementing.

---

## Before you write any code

1. Read **CLAUDE.md** in full, especially §8 (Key Architecture Rules), §8A (no raw UUIDs — R-01, `useQuery` not `useEffect`), §8B (batch vs sequential loop rule), §8C (stock posting `document_number`/`item_number` rule), and the **83.5-addendum** note (Packing PO Reservation) plus the original **83.5** note it extends.
2. Read `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md` and `OM-CORRECTION-NOTES.md`, and specifically the two most recent entries for Gate-27.22/27.23 (including the verification-findings fix pass) — this brief's code sits directly on top of that work.
3. **Do exactly what this brief and the referenced doc section say — do not improvise a different mechanism because it seems simpler.** If something is genuinely ambiguous, say so in your log rather than guessing a resolution.
4. You have Supabase MCP access to the same Dev project (`ytapuwiqicmvpanmzelb`). **Verify every claim in this brief against live Dev before relying on it, and verify every change you make against live Dev immediately after making it — don't batch verification to the end.** Specifically: confirm `reservation_document.batch_number` already exists (it should — migration `20260713110000_gate27_24_reservation_batch_number.sql`, applied); confirm the exact current shape of `reservation_document` (`id, reservation_number, source_type, source_id, source_line_id, company_id, material_id, storage_location_id, required_qty, uom_code, required_by_date, issued_qty, balance_qty, status, created_by, created_at, last_updated_by, last_updated_at, batch_number`) before writing inserts — don't assume this list is still accurate by the time you get to it.
5. Batch independent DB work per §8B. The reservation reads/writes in this brief are per-Packing-PO (a handful of lines), not a bulk cross-order operation, so this mostly means: don't add a new sequential-await loop where `Promise.all` would do, matching the discipline `process_order.handlers.ts` already has for the equivalent Process PO code.
6. Never invent a suffixed `document_number` (§8C) — not touched by this brief anyway, since reservations don't go through `post_stock_movement()`.

---

## Ground truth for reuse (verified against `process_order.handlers.ts`, 2026-07-13)

Process PO's own reservation mechanism is the pattern to mirror for Packing PO's **PM lines** and to **extend** (add the batch dimension) for the **SFG line**. Concrete anchors already in that file:

- `RESERVATION_OPEN_STATUSES = ["OPEN", "PARTIAL"]`, `RESERVATION_ACTIVE_STATUSES = ["OPEN", "PARTIAL", "FULLY_ISSUED"]` — reuse these exact status vocab constants (define your own copy in `packing_order.handlers.ts` with the same values, don't import cross-file for two constants).
- Reservation insert shape (e.g. around `process_order.handlers.ts:798`):
  ```ts
  {
    source_type: "PROCESS_PO", source_id: orderId, source_line_id: insertedLineRecord.id,
    company_id: po.company_id, material_id: materialId,
    storage_location_id: toTrimmedString(insertedLineRecord.issue_sloc_id) || null,
    required_qty: actualQty, uom_code: ..., required_by_date: plannedStartDate,
    issued_qty: 0, status: "OPEN", created_by: ctx.auth_user_id, created_at: now,
    last_updated_by: ctx.auth_user_id, last_updated_at: now,
  }
  ```
  For Packing PO, `source_type` becomes `"PACKING_PO"`, `source_id` = the Packing PO id, `source_line_id` = the `packing_order_line` id. `reservation_number` is never set by any existing insert in `process_order.handlers.ts` (it's apparently unused/nullable in practice) — match that, don't invent a generator for it.
- Availability computation pattern: `computeAvailabilityRows(companyId, needed: Map<key, AvailabilityNeed>)` (around `process_order.handlers.ts:831`) — sums `stock_ledger` UNRESTRICTED IN/OUT per `(material_id, storage_location_id)`, subtracts open `reservation_document.balance_qty` for the same key, returns `{needed_qty, available_qty, short}` per key. This is the function shape to mirror; for Packing PO's SFG line you need a **batch-aware variant** (see Change 2).
- Release-at-completion pattern (around `process_order.handlers.ts:2424` and `:2700`): on successful posting, `UPDATE reservation_document SET issued_qty = required_qty, status = 'FULLY_ISSUED'` for the matching reservation row.
- Cancel-on-prune/reverse pattern (around `process_order.handlers.ts:360`): `UPDATE reservation_document SET status = 'CANCELLED' WHERE source_type = 'PROCESS_PO' AND source_id = :id AND status IN (OPEN, PARTIAL)`.

Do not copy these functions verbatim into `packing_order.handlers.ts` if the shapes end up needing to diverge for the batch dimension — adapt them, but keep the same status vocabulary, same column usage, same batching discipline.

---

## Change 1 — Reservation creation at `createPackingOrderHandler`

After the existing line-derivation logic (from Gate-27.23's Change 1, which already builds SFG/FG/PM `packing_order_line` rows from the ACTIVE Pack BOM), insert one `reservation_document` row per **SFG line** and per **PM line** (not the FG/OUTPUT line — that's a receipt, never reserved):

- **SFG line:** `source_type="PACKING_PO"`, `material_id` = the Prodshade material, `storage_location_id` = the SFG line's `issue_sloc_id`, `required_qty` = the SFG line's `total_qty` (already correctly in KG per the Gate-27.23 verification fix), `batch_number` = the parent Process PO's `batch_number` (already available on the same line row per Gate-27.23 Change 1.6). This is the one new thing Process PO's own reservation never does — **all four other reservation-insert call sites you looked at set `batch_number` implicitly to NULL by omitting the column; for this one row you must explicitly set it.**
- **PM lines:** same shape, one per PM `packing_order_line`, `batch_number` left `NULL` (omit the field, matching Process PO's own PM/RM reservation rows exactly).
- These inserts are independent of each other (§8B) — batch as `Promise.all`, don't loop sequentially with `await` inside.

## Change 2 — Batch-aware availability check, hard block at Create

Before inserting anything (Change 1) or the `packing_order`/`packing_order_line` rows themselves, compute availability and hard-block on shortage — matching §83.5's already-locked severity table ("Standard: hard block if any line short... stricter than SAP's default soft warning").

Write a Packing-PO-local availability function (don't reuse Process PO's `computeAvailabilityRows` cross-file — it doesn't take a batch parameter and mixing concerns across files risks exactly the kind of subtle divergence this brief is trying to prevent). Shape:

1. For the **SFG need**: sum `stock_ledger` rows where `stock_type_code='UNRESTRICTED'`, `material_id` = Prodshade material, `storage_location_id` = the SFG line's location, **and `batch_number` = the parent Process PO's batch_number** (IN direction adds, OUT subtracts). Then subtract the sum of **all open `reservation_document.balance_qty`** rows matching the same `(material_id, storage_location_id, batch_number)` — not just this Packing PO's own reservations, **every** open SFG reservation against that batch, since sibling Packing POs may have already reserved against it (this is the "multiple Packing POs sharing one batch" rule from the locked design — get this right, it's the actual point of this brief). If the remaining amount is less than the SFG qty this Packing PO needs, hard-block the create with a clear 422 (e.g. `PROD_PACK_SFG_BATCH_SHORTAGE`) and **do not insert anything** — same all-or-nothing behavior Process PO's own Standard-creation shortage check has.
2. For **PM needs**: same as Process PO's own PM check — no batch filter, sum by `(material_id, storage_location_id)` only, subtract open reservations the same way. Hard-block the same way on shortage (`PROD_PACK_PM_SHORTAGE` or similar).
3. Batch these lookups (§8B) — one `stock_ledger` query with `.in()` across all needed material/location/batch combinations for this PO, one `reservation_document` query the same way, not one query per line.

## Change 3 — Release at `finalizePackingOrderHandler`

After each line's stock posting succeeds (Gate-27.23's Change 2, already implemented), update that line's matching reservation: `issued_qty = required_qty`, `status = 'FULLY_ISSUED'`, `last_updated_at/by`. Match the exact Process-PO-Verify pattern (`process_order.handlers.ts` around line 2424/2700) — find the reservation by `(source_type='PACKING_PO', source_line_id=<line.id>)`.

## Change 4 — Cancel at `reversePackingOrderHandler`

Before (or alongside) the existing stock-reversal logic (Gate-27.23's Change 3), cancel any still-open reservations for this Packing PO: `UPDATE reservation_document SET status='CANCELLED' WHERE source_type='PACKING_PO' AND source_id=:id AND status IN ('OPEN','PARTIAL')`. Note a Packing PO reaching `FINAL` will already have `FULLY_ISSUED` reservations (from Change 3) by the time Reverse is called on it — those don't need cancelling, they're historically accurate (issued, then reversed via the separate stock-reversal path) — only genuinely still-open ones (which would only exist if Reverse is somehow called on a STANDARD-status PO, if that's even a valid transition — check the existing status-gate on `reversePackingOrderHandler` before assuming this path is reachable at all).

## Change 5 — Fresh batch-level check on `correctPackingOrderHandler`'s SFG-line increases

Per the locked design's core point: Process PO's own COR6 never re-checks availability because it isn't drawing from a finite shared batch pool; Packing PO's COR6 **must**, specifically for the SFG line, because `stock_snapshot` doesn't split by batch and the generic ledger guard can't catch a batch-specific overdraw. In `correctPackingOrderHandler` (Gate-27.23's Change 4, already implemented): when the correction's `delta > 0` (an increase) **and** the line being corrected is the SFG line, run the same batch-aware check from Change 2 for just that delta amount before posting the correction's stock movement. Hard-block with a clear error if short. Decreases (delta < 0) don't need this check — reducing SFG consumption can't overdraw anything. PM-line corrections don't need it either (no batch dimension).

---

## Hard rules

1. Batch-specific SFG reservation logic must never leak into PM reservation handling — keep them as two clearly separate code paths sharing only the status-vocabulary constants and general insert/update shape, not a single "reservation for a line" function with an `if (isBatchSpecific)` branch buried inside it in a way that's easy to get wrong later.
2. Every new hard-block error code must be genuinely new and specific (`PROD_PACK_SFG_BATCH_SHORTAGE`, etc.) — don't reuse an existing Process-PO error code for a Packing-PO-specific condition, per this codebase's established one-code-per-condition convention.
3. No raw UUIDs in any new error message or log line beyond what's already the convention (internal `console.error` JSON dumps are fine, user-facing messages are not — same rule as always, §8A).
4. Do not touch `process_order.handlers.ts` at all in this brief — read-only reference for patterns, nothing there should change.
5. Do not touch `stock_snapshot` or `post_stock_movement()` — this brief works entirely within `reservation_document` and existing ledger read queries, no engine changes.
6. If you find `reversePackingOrderHandler` can actually be called on a STANDARD PO (not just FINAL) and that path currently has no stock-reversal logic to run alongside Change 4's reservation-cancel, don't invent new stock-reversal behavior for that case here — that's out of scope; just make sure the reservation-cancel itself is correct for whichever statuses `reversePackingOrderHandler` genuinely accepts today.

## Explicitly out of scope

- Any QA step for Packing PO (still not designed, per Gate-27.23's own "explicitly out of scope" note — unchanged).
- SO↔FO, Dispatch (L5), PID — all still deferred to their own formal sessions, unchanged from Gate-27.22/27.23.
- Any change to how PM reservation works for **Process PO** — this brief only adds the equivalent for Packing PO, it doesn't touch the original.
- `stock_snapshot` batch-splitting — still explicitly decided against; this brief works around that gap via `reservation_document`+`stock_ledger` queries, it doesn't fix the underlying gap.

## Verification

1. Create a Packing PO for an SFG batch with more than enough stock — confirm a `reservation_document` row appears for the SFG line with the correct `batch_number`, and separate rows for each PM line with `batch_number IS NULL`.
2. Create a **second** Packing PO drawing from the **same** Process PO batch, sized so that combined with the first PO's reservation it would exceed what's actually in that batch — confirm this second create is hard-blocked with `PROD_PACK_SFG_BATCH_SHORTAGE`, and confirm a *third* Packing PO sized to fit within the truly remaining balance still succeeds.
3. Finalize a Packing PO — confirm its SFG and PM reservations both flip to `FULLY_ISSUED` with `issued_qty = required_qty`.
4. Reverse a FINAL Packing PO — confirm the stock reversal (already working, Gate-27.23) still posts correctly, and confirm no still-open reservation is left dangling in a way that would incorrectly suppress a sibling Packing PO's availability going forward.
5. Use the COR6 `/correct` endpoint to *increase* a FINAL Packing PO's SFG line beyond what the batch has left (seed the batch to be nearly exhausted first) — confirm it's hard-blocked. Confirm a decrease is never blocked by this new check.
6. `deno check` clean (zero new errors beyond the documented pre-existing baseline).

## Log + commit

- Append one entry to `docs/Codex-Log.md` and to `docs/Operation Management/implementation-specs/OM-IMPLEMENTATION-LOG.md` (Gate-27.24 entry, same format as prior Gate-27.22/27.23 entries including the verification-fix-pass one).
- Commit with `Co-Authored-By: Codex`. Do not push.
