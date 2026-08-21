-- AC01 fix (business-owner caught, 2026-08-21): a cost line's GST toggle was
-- only two states (INCLUSIVE/EXCLUSIVE), silently assuming GST always
-- applies. Some charges (e.g. Last Mile Transport) may carry no GST at all —
-- needs an explicit "Has GST?" gate before Inclusive/Exclusive/Rate are even
-- asked, same pattern as the "Invoice has transporter charge other than
-- basic?" field. Mathematically has_gst=false already behaved like
-- EXCLUSIVE (full amount used, nothing backed out), but leaving that
-- implicit let a real "no GST" line be mislabeled EXCLUSIVE, which is
-- semantically wrong (EXCLUSIVE implies GST exists but is charged
-- separately elsewhere).

ALTER TABLE erp_procurement.landed_cost_line
  ADD COLUMN has_gst boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN erp_procurement.landed_cost_line.has_gst IS
  'Gate for gst_treatment/gst_rate — false means this charge has no GST relevance at all (not the same as EXCLUSIVE, which means GST exists but is charged separately). Only meaningful for ad-hoc/per-UoM charge lines, same scope as entry_mode.';

-- Backfill: any existing row that already had a gst_treatment set clearly
-- meant GST was relevant, so has_gst=true for those (data continuity, not a
-- behavior change — the calculation was already treating them this way).
UPDATE erp_procurement.landed_cost_line SET has_gst = true WHERE gst_treatment IS NOT NULL;
