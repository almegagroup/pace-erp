-- FG-STO-MTS-DISPATCH-DESIGN-DOC.md §6 point 17 — SO02 Bulk Posting must
-- list ONLY the DOs created via the new Bulk DO Upload mechanism (SO03),
-- never the regular DO01CreatePage.jsx manual flow. Purely additive marker
-- column; every existing row/caller defaults to false (unaffected).
alter table erp_procurement.delivery_challan
  add column if not exists is_bulk_uploaded boolean not null default false;

comment on column erp_procurement.delivery_challan.is_bulk_uploaded is
  'Set true only by the additive Bulk DO Upload (SO03) flow (§6 point 14). Drives the SO02 Bulk Posting list filter (§6 point 17). Never set by the regular DO01CreatePage.jsx manual create/edit flow.';
