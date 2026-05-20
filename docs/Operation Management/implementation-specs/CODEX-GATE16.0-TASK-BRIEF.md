# CODEX TASK BRIEF — Gate-16.0 Stock Posting Engine

**Gate:** 16.0
**Spec File:** OM-GATE-16.0-StockPostingEngine-Spec.md
**Type:** DB Migration only (no TypeScript)
**Dependency:** Gate-13.9 VERIFIED ✅

---

## Read First
Read `OM-GATE-16.0-StockPostingEngine-Spec.md` before writing any code.

## File to Create

`supabase/migrations/20260512000000_gate16_0_16_0_1_create_stock_posting_engine.sql`

## What to Build

A single PostgreSQL function `erp_inventory.post_stock_movement(...)` that atomically:
1. INSERTs into `erp_inventory.stock_document`
2. INSERTs into `erp_inventory.stock_ledger`
3. UPSERTs `erp_inventory.stock_snapshot` (increment/decrement qty + recompute weighted average)

Returns: `TABLE(stock_document_id uuid, stock_ledger_id uuid)`

## Non-Negotiable Rules

1. `SECURITY DEFINER` on the function
2. All 3 steps inside ONE function body (atomic)
3. For `direction = 'IN'`: weighted_average_rate = (old_qty × old_rate + new_qty × new_rate) / (old_qty + new_qty)
4. For `direction = 'OUT'`: rate unchanged. Qty decrements. Guard: if result qty < 0 → `RAISE EXCEPTION 'INSUFFICIENT_STOCK'`
5. `source_storage_location_id` set when direction='OUT'. `target_storage_location_id` set when direction='IN'.
6. `GRANT EXECUTE ON FUNCTION erp_inventory.post_stock_movement(...) TO service_role`
7. File wrapped in `BEGIN;` … `COMMIT;`

## After Implementation — Update Log

In `OM-IMPLEMENTATION-LOG.md`: set Gate-16.0 items to DONE, add filename.

---
*Brief frozen: 2026-05-12*
