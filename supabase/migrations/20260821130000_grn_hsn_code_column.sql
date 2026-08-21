-- Step 7 (Accounts/Returns/Sales redesign) — GRN HSN Code capture.
--
-- The earlier AC01 migration (20260821090000) added `hsn_code` to
-- `erp_procurement.goods_receipt_line` -- but that table has zero rows in
-- practice. The live GRN posting flow (`createAndPostGRNFromLineHandler`,
-- the only handler `GRNPostFlow.jsx` actually calls) writes one flattened
-- row per gate-entry line directly into `goods_receipt` itself (it already
-- carries `material_id`, `storage_location_id`, etc. at that grain) and
-- never touches `goods_receipt_line` -- that table belongs only to the
-- older draft/multi-line `createGRNDraftHandler`/`postGRNHandler` path.
-- HSN Code therefore needs to live on `goods_receipt`, not
-- `goods_receipt_line`, to actually be reachable from the real posting
-- flow. Leaving the earlier (dead-path) column in place -- no data lost,
-- just unused -- rather than dropping it, since goods_receipt_line may be
-- revived by a future multi-line GRN redesign.

ALTER TABLE erp_procurement.goods_receipt
  ADD COLUMN hsn_code text;
