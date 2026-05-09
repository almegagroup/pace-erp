/*
 * File-ID: 11.4
 * File-Path: supabase/migrations/20260509103000_gate11_11_4_seed_movement_types.sql
 * Gate: 11
 * Phase: 11
 * Domain: INVENTORY
 * Purpose: Seed the complete Phase-1 movement type master list.
 * Authority: Backend
 */

BEGIN;

INSERT INTO erp_inventory.movement_type_master
  (code, name, direction, source_stock_type, target_stock_type,
   reference_document_required, reference_document_type,
   reversal_of, reversed_by, role_restricted, approval_required, is_custom, active)
VALUES

-- GRN / PROCUREMENT
('P101', 'GRN Receipt (PO)',                'IN',       NULL,                  'QUALITY_INSPECTION',  true,  'PO',                    NULL,   'P102', false, false, false, true),
('P102', 'P101 Reversal',                   'OUT',      'QUALITY_INSPECTION',  NULL,                  true,  'PO',                    'P101', NULL,   false, true,  false, true),
('P103', 'GRN to Blocked Stock',            'IN',       NULL,                  'BLOCKED',             true,  'PO',                    NULL,   'P104', false, false, false, true),
('P104', 'P103 Reversal',                   'OUT',      'BLOCKED',             NULL,                  true,  'PO',                    'P103', NULL,   false, true,  false, true),
('P122', 'Return to Vendor (Unrestricted)', 'OUT',      'UNRESTRICTED',        NULL,                  true,  'PO',                    NULL,   'P123', false, true,  false, true),
('P123', 'P122 Reversal',                   'IN',       NULL,                  'UNRESTRICTED',        true,  'PO',                    'P122', NULL,   false, true,  false, true),
('P124', 'Return to Vendor (Blocked)',      'OUT',      'BLOCKED',             NULL,                  true,  'PO',                    NULL,   'P125', false, true,  false, true),
('P125', 'P124 Reversal',                   'IN',       NULL,                  'BLOCKED',             true,  'PO',                    'P124', NULL,   false, true,  false, true),

-- STOCK TYPE TRANSFERS
('P321', 'QA → Unrestricted',               'TRANSFER', 'QUALITY_INSPECTION',  'UNRESTRICTED',        false, NULL,                    NULL,   'P322', false, false, false, true),
('P322', 'Unrestricted → QA',               'TRANSFER', 'UNRESTRICTED',        'QUALITY_INSPECTION',  false, NULL,                    NULL,   'P321', false, false, false, true),
('P323', 'QA → Blocked',                    'TRANSFER', 'QUALITY_INSPECTION',  'BLOCKED',             false, NULL,                    NULL,   'P324', false, true,  false, true),
('P324', 'P323 Reversal',                   'TRANSFER', 'BLOCKED',             'QUALITY_INSPECTION',  false, NULL,                    'P323', NULL,   false, true,  false, true),
('P343', 'Blocked → Unrestricted',          'TRANSFER', 'BLOCKED',             'UNRESTRICTED',        false, NULL,                    NULL,   'P344', true,  true,  false, true),
('P344', 'Unrestricted → Blocked',          'TRANSFER', 'UNRESTRICTED',        'BLOCKED',             false, NULL,                    NULL,   'P343', false, false, false, true),
('P349', 'Blocked → QA',                    'TRANSFER', 'BLOCKED',             'QUALITY_INSPECTION',  false, NULL,                    NULL,   'P350', false, false, false, true),
('P350', 'QA → Blocked',                    'TRANSFER', 'QUALITY_INSPECTION',  'BLOCKED',             false, NULL,                    NULL,   'P349', false, false, false, true),

-- LOCATION TRANSFERS
('P311', 'Storage Location Transfer',       'TRANSFER', 'UNRESTRICTED',        'UNRESTRICTED',        false, NULL,                    NULL,   'P312', false, false, false, true),
('P312', 'P311 Reversal',                   'TRANSFER', 'UNRESTRICTED',        'UNRESTRICTED',        false, NULL,                    'P311', NULL,   false, true,  false, true),

-- PLANT TRANSFER
('P303', 'Plant Transfer Issue (Two-step)',   'OUT',      'UNRESTRICTED',        'IN_TRANSIT',          true,  'PLANT_TRANSFER_ORDER',  NULL,   'P304', false, true,  false, true),
('P304', 'P303 Reversal',                   'TRANSFER', 'IN_TRANSIT',          'UNRESTRICTED',        true,  'PLANT_TRANSFER_ORDER',  'P303', NULL,   false, true,  false, true),
('P305', 'Plant Transfer Receipt (Two-step)', 'IN',       'IN_TRANSIT',          'UNRESTRICTED',        true,  'PLANT_TRANSFER_ORDER',  NULL,   'P306', false, false, false, true),
('P306', 'P305 Reversal',                   'OUT',      'UNRESTRICTED',        'IN_TRANSIT',          true,  'PLANT_TRANSFER_ORDER',  'P305', NULL,   false, true,  false, true),

-- PRODUCTION
('P261', 'GI to Process/Packing Order',    'OUT',      'UNRESTRICTED',        NULL,                  true,  'PROCESS_ORDER',         NULL,   'P262', false, false, false, true),
('P262', 'P261 Reversal',                   'IN',       NULL,                  'UNRESTRICTED',        true,  'PROCESS_ORDER',         'P261', NULL,   false, true,  false, true),

-- DISPATCH
('P601', 'GI for Dispatch (Delivery)',      'OUT',      'UNRESTRICTED',        NULL,                  true,  'DISPATCH_INSTRUCTION',  NULL,   'P602', false, false, false, true),
('P602', 'P601 Reversal',                   'IN',       NULL,                  'UNRESTRICTED',        true,  'DISPATCH_INSTRUCTION',  'P601', NULL,   false, true,  false, true),

-- CUSTOMER RETURNS
('P651', 'Customer Return Receipt',         'IN',       NULL,                  'BLOCKED',             true,  'DISPATCH_INSTRUCTION',  NULL,   'P652', false, false, false, true),
('P652', 'P651 Reversal',                   'OUT',      'BLOCKED',             NULL,                  true,  'DISPATCH_INSTRUCTION',  'P651', NULL,   false, true,  false, true),
('P653', 'Return → Unrestricted',           'TRANSFER', 'BLOCKED',             'UNRESTRICTED',        false, NULL,                    NULL,   'P654', false, true,  false, true),
('P654', 'P653 Reversal',                   'TRANSFER', 'UNRESTRICTED',        'BLOCKED',             false, NULL,                    'P653', NULL,   false, true,  false, true),
('P655', 'Return → QA',                     'TRANSFER', 'BLOCKED',             'QUALITY_INSPECTION',  false, NULL,                    NULL,   'P656', false, false, false, true),
('P656', 'P655 Reversal',                   'TRANSFER', 'QUALITY_INSPECTION',  'BLOCKED',             false, NULL,                    'P655', NULL,   false, true,  false, true),
('P657', 'Return → Blocked (Confirm)',      'TRANSFER', 'BLOCKED',             'BLOCKED',             false, NULL,                    NULL,   'P658', false, false, false, true),
('P658', 'P657 Reversal',                   'TRANSFER', 'BLOCKED',             'BLOCKED',             false, NULL,                    'P657', NULL,   false, true,  false, true),

-- PHYSICAL INVENTORY
('P561', 'Opening Stock Posting',           'IN',       NULL,                  'UNRESTRICTED',        false, 'OPENING_STOCK',         NULL,   'P562', false, true,  false, true),
('P562', 'P561 Reversal',                   'OUT',      'UNRESTRICTED',        NULL,                  false, 'OPENING_STOCK',         'P561', NULL,   false, true,  false, true),
('P701', 'PID Surplus (Count > Book)',      'IN',       NULL,                  'UNRESTRICTED',        true,  'PID_DOCUMENT',          NULL,   NULL,   false, true,  false, true),
('P702', 'PID Deficit (Count < Book)',      'OUT',      'UNRESTRICTED',        NULL,                  true,  'PID_DOCUMENT',          NULL,   NULL,   false, true,  false, true),

-- SCRAP
('P551', 'Scrap from Unrestricted',         'OUT',      'UNRESTRICTED',        NULL,                  false, NULL,                    NULL,   'P552', false, true,  false, true),
('P552', 'P551 Reversal',                   'IN',       NULL,                  'UNRESTRICTED',        false, NULL,                    'P551', NULL,   false, true,  false, true),
('P553', 'Scrap from QA',                   'OUT',      'QUALITY_INSPECTION',  NULL,                  false, NULL,                    NULL,   'P554', false, true,  false, true),
('P554', 'P553 Reversal',                   'IN',       NULL,                  'QUALITY_INSPECTION',  false, NULL,                    'P553', NULL,   false, true,  false, true),
('P555', 'Scrap from Blocked',              'OUT',      'BLOCKED',             NULL,                  false, NULL,                    NULL,   'P556', false, true,  false, true),
('P556', 'P555 Reversal',                   'IN',       NULL,                  'BLOCKED',             false, NULL,                    'P555', NULL,   false, true,  false, true),

-- FOR_REPROCESS (role-restricted)
('P901', 'Unrestricted → FOR_REPROCESS',    'TRANSFER', 'UNRESTRICTED',        'FOR_REPROCESS',       false, NULL,                    NULL,   'P902', true,  false, true,  true),
('P902', 'P901 Reversal',                   'TRANSFER', 'FOR_REPROCESS',       'UNRESTRICTED',        false, NULL,                    'P901', NULL,   true,  false, true,  true),
('P903', 'Blocked → FOR_REPROCESS',         'TRANSFER', 'BLOCKED',             'FOR_REPROCESS',       false, NULL,                    NULL,   'P904', true,  false, true,  true),
('P904', 'P903 Reversal',                   'TRANSFER', 'FOR_REPROCESS',       'BLOCKED',             false, NULL,                    'P903', NULL,   true,  false, true,  true),
('P905', 'QA → FOR_REPROCESS',              'TRANSFER', 'QUALITY_INSPECTION',  'FOR_REPROCESS',       false, NULL,                    NULL,   'P906', true,  false, true,  true),
('P906', 'P905 Reversal',                   'TRANSFER', 'FOR_REPROCESS',       'QUALITY_INSPECTION',  false, NULL,                    'P905', NULL,   true,  false, true,  true)

ON CONFLICT (code) DO NOTHING;

COMMIT;
