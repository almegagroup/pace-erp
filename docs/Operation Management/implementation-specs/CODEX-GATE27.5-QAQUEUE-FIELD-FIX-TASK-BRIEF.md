# CODEX-GATE27.5-QAQUEUE-FIELD-FIX-TASK-BRIEF

**Gate:** 27.5
**Domain:** PRODUCTION
**Title:** Fix QA Queue (PR16) list + detail — blank Type/Qty, raw-UUID Stroke & Created-By (field-name mismatch + R-01)
**Scope:** backend list/detail resolution + one frontend file. **No migration. No status-machine change.**
**Dependency:** none (independent — can run anytime)
**Reference doc:** feasibility §83.4 (PR16 QA Approval Queue); `PACE_ERP_MASTER_CONSTITUTION.md` Part 1B Rule 1 (no raw UUID) & Rule 3 (list endpoint carries display data); memory: user identity shown as `P0004 — Name`.

---

## Why this brief exists (root cause — already diagnosed)

`QAQueuePage.jsx` renders the queue but shows blanks, zeros, and raw UUIDs because the frontend reads field names the backend list endpoint does not return, and the list endpoint doesn't resolve Stroke or Created-By:

Backend `listProcessOrdersHandler` (`process_order.handlers.ts`) returns rows with `po_type`, `planned_qty`, `material_id` (+ resolved `material`), and **does not embed stroke** and **does not resolve `created_by`**.

Frontend `QAQueuePage.jsx` reads (all wrong / raw):
- `o.prod_type` → backend has `po_type` → **Type column blank**
- `o.planned_qty_kg` → backend has `planned_qty` → **Qty shows 0**
- `o.prodshade_material_id?.slice(0,8)` fallback → raw-UUID (R-01)
- `o.stroke?.stroke_number ?? o.stroke_master_id?.slice(0,8)` → list has no stroke embed → **raw-UUID Stroke** (R-01)
- `o.created_by` → **raw auth-user UUID** (R-01)
- Detail drawer repeats `detail.prod_type`, `detail.planned_qty_kg`, and raw-UUID fallbacks.

---

## Change 1 — Backend `listProcessOrdersHandler` (`process_order.handlers.ts`)

The list already resolves `material`. Add two more resolutions, **batched** (CLAUDE.md §8B — one `.in()` each, no per-row loop):

1. **Stroke number:** collect `stroke_master_id` from the page rows, one `.schema("erp_production").from("stroke_master").select("id, stroke_number").in("id", ids)`, build a map, attach `stroke_number` onto each row (the raw value, e.g. `"042"`; `null` if none).
2. **Created-by display:** resolve `created_by` (auth user id) to the `P0004 — Full Name` string using the **existing** user-display resolver already used by the Procurement PO list (`supabase/functions/api/_shared/resolveUserDisplayNames.ts` / the `*_by_display` pattern). Attach `created_by_display` on each row. Do not invent a new resolver — reuse the existing one.

Keep the response shape otherwise unchanged (other consumers like OrderListPage rely on it; these additions are additive).

## Change 2 — Backend detail: dosage note
Do **not** add a dosage-per-line resolution here (the expandable component grid with Dosage% is part of the separate PR16 full rebuild, task 27.11). The drawer will show `—` for dosage in the interim (see Change 3). No change to `fetchOrderLines` / `getProcessOrderHandler` in this task.

## Change 3 — Frontend `QAQueuePage.jsx`

Fix every field read to match the backend, and remove all raw-UUID fallbacks (R-01 — show `—` when a resolved value is absent, never a sliced UUID):

**List row:**
- Type: `o.po_type` (was `o.prod_type`)
- Prodshade: `o.material?.pace_code ?? "—"` (drop the `o.prodshade_material_id?.slice(0,8)` fallback)
- Stroke #: `o.stroke_number ?? "—"` (drop the raw-UUID fallback)
- Planned Qty: `Number(o.planned_qty ?? 0)` (was `o.planned_qty_kg`)
- Created By: `o.created_by_display ?? "—"` (was raw `o.created_by`)

**Detail drawer:** same corrections — `detail.po_type`, `detail.planned_qty`, `detail.material?.pace_code ?? "—"`, `detail.stroke?.stroke_number ?? "—"` (getProcessOrder DOES embed stroke, so the drawer stroke can stay `detail.stroke?.stroke_number`), and for the RM lines table set the Dosage% cell to `—` (since dosage isn't resolved this task) instead of `Number(l.dosage_pct ?? 0)`.

Keep the `useQuery` structure, the 30s `refetchInterval`, and the approve/reject handlers unchanged.

---

## Hard rules
1. **No status-machine change.** The queue still filters `status: "STANDARD"` — do NOT add a QA_PENDING submit step here (that's the separate state-machine task 27.7). This task is display-correctness only.
2. **No raw UUID anywhere** in the rendered output — resolved value or `—`.
3. Backend additions are **batched** `.in()` reads; no per-row DB loop (§8B).
4. Reuse the existing user-display resolver; don't write a new one.
5. Only two files: `process_order.handlers.ts` (list handler only) + `QAQueuePage.jsx`. Do not touch `fetchOrderLines`, `getProcessOrderHandler`, routes, ACL, or any migration.
6. Keep file headers intact (Constitution §9). **Watch encoding** — do not let `—`/`…` characters get mangled into mojibake; if your editor can't preserve them, use ASCII in any NEW strings you add (don't rewrite existing unicode).

## Verification (Codex: before the log entry)
1. `deno check` the handler file — ignore the known pre-existing shared typing errors; only your file-anchored errors matter.
2. Grep `QAQueuePage.jsx` for `.slice(0, 8)` / `prod_type` / `planned_qty_kg` — should be gone.
3. Confirm the list handler attaches `stroke_number` + `created_by_display` via batched `.in()` reads.

## Log + commit
- Append one `docs/Codex-Log.md` entry (existing template, dated today): list-endpoint stroke_number + created_by_display resolution, and the QAQueuePage field/R-01 fixes; files touched.
- **Do NOT run git commands.** Claude reviews + commits on return.
