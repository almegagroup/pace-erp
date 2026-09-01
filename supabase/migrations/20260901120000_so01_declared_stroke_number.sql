-- §133.21 (business owner, 2026-09-01) -- SO01 MTO/HPS FG lines get a
-- manual "Stroke Number" field, independent of the real production chain
-- (FO -> Batch -> Process PO already carries a real Stroke, but that's only
-- knowable after production exists). Asian Paints sometimes references an
-- Item+Stroke combination that was never created in PACE yet -- this
-- captures exactly what Asian said, for later reconciliation, without
-- blocking SO creation or dispatch. Purely informational at write time;
-- read/validated client-side against stroke_master via a new Sales-owned
-- endpoint (see stroke-check-options handler) so it needs no Production ACL.
ALTER TABLE erp_procurement.sales_order_line
  ADD COLUMN declared_stroke_number text;
