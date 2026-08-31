-- AC06 prices material inputs. FG and SFG can live in the same SLOC as RM/PM/INT,
-- but they must not be part of AC06 rate entry, verification, or carry-forward.
-- Closed months are immutable archives and intentionally remain untouched.

DELETE FROM erp_production.ac06_month_group_config config
USING erp_production.ac06_month month_row,
      erp_master.material_master material
WHERE config.month_id = month_row.id
  AND config.material_id = material.id
  AND month_row.status = 'OPEN'
  AND material.material_type IN ('FG', 'SFG');

DELETE FROM erp_production.ac06_month_line line
USING erp_production.ac06_month month_row,
      erp_master.material_master material
WHERE line.month_id = month_row.id
  AND line.material_id = material.id
  AND month_row.status = 'OPEN'
  AND material.material_type IN ('FG', 'SFG');
