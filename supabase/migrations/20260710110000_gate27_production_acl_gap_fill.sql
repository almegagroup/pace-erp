/*
 * Migration: 20260710110000_gate27_production_acl_gap_fill
 * Gate: 27.1
 * Purpose: Backfill production route resource registrations that were referenced
 *          by route-acl-registry.ts but missing from acl.menu_master / erp_menu.menu_master,
 *          and add the prodshade_pack_config dedupe safety index required by
 *          Gate-27.1 Pack Code Master.
 */

BEGIN;

-- ── Safety index for prodshade_pack_config dedupe ────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS prodshade_pack_config_dedup_idx
  ON erp_production.prodshade_pack_config (
    material_id,
    pack_code_id,
    COALESCE(variant, ''),
    COALESCE(fill_qty, -1)
  );

-- ── erp_menu.menu_master already has rows for all 20 resources below (verified ──
-- against dev before applying this migration — tx_codes OM08/OM09/OM10/PR00-PR17
-- are already assigned there). erp_menu.menu_master also has no UNIQUE constraint
-- on menu_code, only on tx_code, so an ON CONFLICT (menu_code) upsert here is both
-- unnecessary and unsafe (would error, and if it didn't, would collide on tx_code
-- with the pre-existing rows). Only acl.menu_master needs the backfill.

-- ── Mirror resources into ACL menu master ────────────────────────────────────
INSERT INTO acl.menu_master (menu_code, display_name)
VALUES
  ('SA_OM_PACK_CODE_MASTER', 'Pack Code Master'),
  ('SA_PROD_BATCH_SERIES', 'Production Batch Series'),
  ('SA_PROD_SEGMENT_LOCATIONS', 'Segment Location Config'),
  ('PROD_STROKE_MASTER', 'Stroke Master'),
  ('PROD_STROKE_APPROVAL', 'Stroke Approval'),
  ('PROD_PLAN_FEED', 'Plan Feed'),
  ('PROD_PO_CREATE', 'Production PO Create'),
  ('PROD_PO_EDIT', 'Production PO Edit'),
  ('PROD_QA_QUEUE', 'Production QA Queue'),
  ('PROD_BATCH_RELEASE', 'Batch Release'),
  ('PROD_PO_FINAL', 'Production PO Final'),
  ('PROD_PO_VERIFY', 'Production PO Verify'),
  ('PROD_REVERSAL', 'Production Reversal'),
  ('PROD_ORDER_LIST', 'Production Order List'),
  ('PROD_CHANGE_BOM_ITEM', 'Change BOM Item'),
  ('PROD_CHANGE_BOM_ITEM_APPROVAL', 'Change BOM Item Approval'),
  ('PROD_PACK_BOM_CREATE', 'Pack BOM Create'),
  ('PROD_PACK_BOM_APPROVAL', 'Pack BOM Approval'),
  ('PROD_CHANGE_PACK_BOM', 'Change Pack BOM'),
  ('PROD_CHANGE_PACK_BOM_APPROVAL', 'Change Pack BOM Approval')
ON CONFLICT (menu_code) DO NOTHING;

-- ── Capability grants for production resources ───────────────────────────────
INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
SELECT v.capability_code, mm.id, v.action, true
FROM (VALUES
  ('CAP_PROD_OPERATOR', 'SA_PROD_BATCH_SERIES', 'VIEW'),
  ('CAP_PROD_OPERATOR', 'SA_PROD_BATCH_SERIES', 'WRITE'),
  ('CAP_PROD_OPERATOR', 'SA_PROD_BATCH_SERIES', 'EDIT'),
  ('CAP_PROD_OPERATOR', 'SA_PROD_SEGMENT_LOCATIONS', 'VIEW'),
  ('CAP_PROD_OPERATOR', 'SA_PROD_SEGMENT_LOCATIONS', 'WRITE'),
  ('CAP_PROD_OPERATOR', 'SA_PROD_SEGMENT_LOCATIONS', 'EDIT'),

  ('CAP_PROD_OPERATOR', 'PROD_STROKE_MASTER', 'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_STROKE_MASTER', 'WRITE'),
  ('CAP_PROD_OPERATOR', 'PROD_STROKE_MASTER', 'EDIT'),
  ('CAP_PROD_OPERATOR', 'PROD_STROKE_APPROVAL', 'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_STROKE_APPROVAL', 'APPROVE'),

  ('CAP_PROD_OPERATOR', 'PROD_PLAN_FEED', 'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_PLAN_FEED', 'WRITE'),
  ('CAP_PROD_OPERATOR', 'PROD_PLAN_FEED', 'EDIT'),
  ('CAP_PROD_PLANNER', 'PROD_PLAN_FEED', 'VIEW'),
  ('CAP_PROD_PLANNER', 'PROD_PLAN_FEED', 'WRITE'),
  ('CAP_PROD_PLANNER', 'PROD_PLAN_FEED', 'EDIT'),

  ('CAP_PROD_OPERATOR', 'PROD_PO_CREATE', 'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_PO_CREATE', 'WRITE'),
  ('CAP_PROD_OPERATOR', 'PROD_PO_EDIT', 'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_PO_EDIT', 'EDIT'),
  ('CAP_PROD_OPERATOR', 'PROD_QA_QUEUE', 'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_QA_QUEUE', 'APPROVE'),
  ('CAP_PROD_OPERATOR', 'PROD_BATCH_RELEASE', 'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_BATCH_RELEASE', 'WRITE'),
  ('CAP_PROD_OPERATOR', 'PROD_PO_FINAL', 'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_PO_FINAL', 'WRITE'),
  ('CAP_PROD_OPERATOR', 'PROD_PO_VERIFY', 'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_PO_VERIFY', 'APPROVE'),
  ('CAP_PROD_OPERATOR', 'PROD_REVERSAL', 'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_REVERSAL', 'APPROVE'),
  ('CAP_PROD_OPERATOR', 'PROD_ORDER_LIST', 'VIEW'),

  ('CAP_PROD_OPERATOR', 'PROD_CHANGE_BOM_ITEM', 'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_CHANGE_BOM_ITEM', 'WRITE'),
  ('CAP_PROD_OPERATOR', 'PROD_CHANGE_BOM_ITEM_APPROVAL', 'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_CHANGE_BOM_ITEM_APPROVAL', 'APPROVE'),

  ('CAP_PROD_OPERATOR', 'PROD_PACK_BOM_CREATE', 'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_PACK_BOM_CREATE', 'WRITE'),
  ('CAP_PROD_OPERATOR', 'PROD_PACK_BOM_APPROVAL', 'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_PACK_BOM_APPROVAL', 'APPROVE'),
  ('CAP_PROD_OPERATOR', 'PROD_CHANGE_PACK_BOM', 'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_CHANGE_PACK_BOM', 'WRITE'),
  ('CAP_PROD_OPERATOR', 'PROD_CHANGE_PACK_BOM_APPROVAL', 'VIEW'),
  ('CAP_PROD_OPERATOR', 'PROD_CHANGE_PACK_BOM_APPROVAL', 'APPROVE')
) AS v(capability_code, menu_code, action)
JOIN acl.menu_master mm ON mm.menu_code = v.menu_code
ON CONFLICT DO NOTHING;

-- ── ACL version backfill for all existing versions ───────────────────────────
INSERT INTO acl.version_role_capabilities (acl_version_id, role_code, capability_code)
SELECT av.acl_version_id, rc.role_code, rc.capability_code
FROM acl.acl_versions av
JOIN acl.role_capabilities rc
  ON rc.capability_code IN ('CAP_PROD_OPERATOR', 'CAP_PROD_PLANNER')
ON CONFLICT DO NOTHING;

INSERT INTO acl.version_work_context_capabilities (acl_version_id, work_context_id, capability_code)
SELECT av.acl_version_id, wcc.work_context_id, wcc.capability_code
FROM acl.acl_versions av
JOIN acl.work_context_capabilities wcc
  ON wcc.capability_code IN ('CAP_PROD_OPERATOR', 'CAP_PROD_PLANNER')
ON CONFLICT DO NOTHING;

INSERT INTO acl.version_capability_menu_actions (acl_version_id, capability_code, menu_id, action, allowed)
SELECT av.acl_version_id, cma.capability_code, cma.menu_id, cma.action, cma.allowed
FROM acl.acl_versions av
JOIN acl.capability_menu_actions cma
  ON cma.capability_code IN ('CAP_PROD_OPERATOR', 'CAP_PROD_PLANNER')
JOIN acl.menu_master mm
  ON mm.id = cma.menu_id
 AND mm.menu_code IN (
   'SA_PROD_BATCH_SERIES',
   'SA_PROD_SEGMENT_LOCATIONS',
   'PROD_STROKE_MASTER',
   'PROD_STROKE_APPROVAL',
   'PROD_PLAN_FEED',
   'PROD_PO_CREATE',
   'PROD_PO_EDIT',
   'PROD_QA_QUEUE',
   'PROD_BATCH_RELEASE',
   'PROD_PO_FINAL',
   'PROD_PO_VERIFY',
   'PROD_REVERSAL',
   'PROD_ORDER_LIST',
   'PROD_CHANGE_BOM_ITEM',
   'PROD_CHANGE_BOM_ITEM_APPROVAL',
   'PROD_PACK_BOM_CREATE',
   'PROD_PACK_BOM_APPROVAL',
   'PROD_CHANGE_PACK_BOM',
   'PROD_CHANGE_PACK_BOM_APPROVAL'
 )
ON CONFLICT DO NOTHING;

COMMIT;
