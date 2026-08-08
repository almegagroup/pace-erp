# CODEX Plan Feed Cancel/Reactivate Task Brief

## Source of truth

- Base design: `docs/Operation Management/PACE_ERP_Operation_Management_SAP_Style_Discovery_and_Feasibility.md`
- Locked Plan Feed redesign section: `§83.18-REVISED`

## Baseline already implemented before this task

- Plan Feed (`FO`) is a standalone production planning document.
- FO to Packing PO mapping is many-to-many through `erp_production.plan_feed_packing_order_allocation`.
- Cancelling an FO must not cancel Packing POs themselves.
- Packing PO allocations are the lock boundary for FO SKU/description edits.

## New business additions for this task

### 1. Total tab must show mapped batch numbers

For every FO row in Plan Feed `Total Table`, show which production batch number(s) are currently mapped through the allocated Packing PO set.

Rules:

- If no mapped batch exists, show blank.
- If one batch exists, show that batch.
- If multiple batches exist, show all mapped batches.
- UI may render them comma-separated or line-by-line.

Data derivation:

- `plan_feed`
- `plan_feed_packing_order_allocation`
- `packing_order.process_order_id`
- `process_order.batch_number`

### 2. FO cancel behavior

When user cancels an FO:

- FO status becomes `CANCELLED`
- all mapped Packing PO allocation rows are removed
- Packing POs themselves remain unchanged
- mapped SO lines linked to that FO must be unlinked

### 3. DO dependency before FO cancel

If any SO line linked to the FO is already used by a Delivery Order that is not cancelled, FO cancel must be blocked.

Business message:

- user must cancel the Delivery Order first
- only then FO cancel can proceed

### 4. Reactivate behavior

After FO cancel, action becomes `Reactivate`.

When user reactivates:

- FO returns to `ACTIVE`
- FO becomes serviceable again
- previously released Packing POs stay released
- SO links are not auto-restored
- user must remap Packing PO manually again

### 5. Access control

Only users with full Plan Feed edit access may cancel or reactivate.

Implementation rule:

- backend authority remains `PROD_PLAN_FEED | EDIT`
- frontend should only expose the action where edit behavior is allowed
- backend remains the final enforcement boundary

## Schema impact

To support FO to SO unlinking cleanly and future-safely, `erp_procurement.sales_order_line` needs a nullable `plan_feed_id` reference to `erp_production.plan_feed(id)`.

Reason:

- FO cancel must clear a formal SO link
- DO-block check needs a reliable FO -> SO line -> DO chain
- this avoids fragile text-based joins on document numbers

## Implementation notes

- Existing Plan Feed cancel endpoint stays the main action endpoint.
- New endpoint added for reactivation.
- Summary API must return derived `mapped_batch_numbers`.
- Cancel response may include how many SO lines were unlinked.
- If blocking DO exists, cancel returns a user-safe validation error instead of partially cancelling.

## Non-goals

- Do not auto-remap Packing POs on FO reactivate.
- Do not auto-cancel Packing POs during FO cancel.
- Do not auto-cancel Delivery Orders.
- Do not redesign Sales Order UI in this task.
