-- PO11 History/Archive table needs to display External Code (per §35 UI lock:
-- Pace Code is never shown, Name is primary, External Code is the adjacent
-- column) exactly like the live workspace tables -- add the missing snapshot
-- column so the frozen archive can carry it too.

alter table erp_procurement.procurement_monthly_plan_archive_line
  add column if not exists material_external_code_snapshot text;

comment on column erp_procurement.procurement_monthly_plan_archive_line.material_external_code_snapshot is
  'Frozen material_master.external_code at archive time -- display-only, mirrors material_code_snapshot/material_name_snapshot (feasibility Section 35 table-column lock, 2026-08-11).';
