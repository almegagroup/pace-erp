-- Invoice/PGI preview always showed Rate/Per converted to the per-base-UOM
-- (e.g. per-KG) value used for stock/value math, even when the source SO
-- line was entered as Pack UoM or Fixed rate (§133.13 sample-invoice-format
-- design implies Rate/Per should mirror what the user actually chose at SO
-- creation). unit_value/quantity (both base-UOM, used for every downstream
-- calculation) are untouched -- these are presentation-only snapshots taken
-- at DO-line time, alongside the already-existing commercial snapshot
-- fields from 20260731100000.
ALTER TABLE erp_procurement.delivery_challan_line
  ADD COLUMN display_rate_basis text,
  ADD COLUMN display_rate numeric,
  ADD COLUMN display_uom_code text;

NOTIFY pgrst, 'reload schema';
