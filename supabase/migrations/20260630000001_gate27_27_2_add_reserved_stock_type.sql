-- Gate-27: Add RESERVED stock type
-- RESERVED: RM/PM qty committed to a Process PO at Standard phase
-- Released at Verify (P261 → consumed) or PO cancel (→ back to UNRESTRICTED)

INSERT INTO erp_inventory.stock_type_master (id, code, name, available_for_issue, available_for_dispatch, requires_approval_to_move, is_system_type, active)
VALUES (gen_random_uuid(), 'RESERVED', 'Reserved', false, false, false, true, true)
ON CONFLICT (code) DO NOTHING;
