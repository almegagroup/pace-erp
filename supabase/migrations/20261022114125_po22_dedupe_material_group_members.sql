/*
 * PO22: a material must occur only once in a material group.
 * Duplicate rows caused the family planner to multiply demand/candidates, which in turn created
 * inflated requirement and purchase suggestions. Keep the oldest active/primary relationship.
 */
BEGIN;

WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY group_id, material_id
      ORDER BY active DESC, is_primary DESC, created_at ASC, id ASC
    ) AS row_rank
  FROM erp_master.material_category_group_member
)
DELETE FROM erp_master.material_category_group_member member
USING ranked
WHERE member.id = ranked.id
  AND ranked.row_rank > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'erp_master.material_category_group_member'::regclass
      AND conname = 'material_category_group_member_group_id_material_id_key'
  ) THEN
    ALTER TABLE erp_master.material_category_group_member
      ADD CONSTRAINT material_category_group_member_group_id_material_id_key
      UNIQUE (group_id, material_id);
  END IF;
END;
$$;

COMMIT;
