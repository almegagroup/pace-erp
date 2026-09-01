/*
 * File-Path: supabase/migrations/20260901180000_perf_duplicate_and_fk_indexes.sql
 * Gate: PERF
 * Phase: POST-L2
 * Domain: DB / PERF
 * Purpose:
 *   Fix duplicate_index and unindexed_foreign_keys advisor findings
 *   (INFO, 33 + 220 rows respectively, dev; similar counts prod).
 *
 *   PART 1 -- duplicate_index. Detected via a strict pg_index/pg_am query
 *   (same table, same key columns in the same order, same access method,
 *   same partial predicate) so trigram-vs-btree pairs (e.g. material_master's
 *   pace_code has both a plain btree and a separate GIN trigram index -- NOT
 *   a duplicate, different query patterns) and genuinely partial indexes are
 *   correctly excluded, not flagged as false positives. Every pair below has
 *   one plain btree index that is a byte-for-byte functional duplicate of a
 *   UNIQUE constraint's own backing index on the same table -- the unique
 *   index already serves every read the plain one could, so the plain one is
 *   pure dead weight (extra storage + extra write cost on every insert/
 *   update, zero benefit). The UNIQUE side is always kept -- dropping it
 *   would remove a real data-integrity guarantee, never done here.
 *   Deliberately NOT touching a handful of superficially-similar pairs that
 *   turned out to be genuine business logic on closer read (not naive
 *   name-matching): erp_menu.menu_snapshot's ux_menu_snapshot_acl vs
 *   ux_menu_snapshot_identity (this table's uniqueness shape has broken
 *   before, see CLAUDE.md session history -- needs its own review, not a
 *   blind drop); erp_procurement.consignment_note's idx_csn_vessel_alert
 *   (name suggests a purpose-built index for the vessel-alert query path,
 *   not a plain duplicate); erp_procurement.gate_entry_line's
 *   idx_gel_grn_posted; erp_production.prodshade_pack_config's
 *   uq_prodshade_pack_config_active_identity (likely a partial "one active
 *   row" invariant, matching this codebase's established soft-delete/
 *   versioning pattern -- dropping the wrong one would silently remove that
 *   invariant).
 *
 *   PART 2 -- unindexed_foreign_keys. Every FK constraint in our own schemas
 *   (acl/erp_*) whose column(s) are not the leading prefix of any existing
 *   index on that table, generated directly from pg_constraint/pg_index so
 *   the list is exhaustive and typo-free. Plain additive CREATE INDEX IF NOT
 *   EXISTS -- non-destructive, standard Postgres FK-indexing hygiene (avoids
 *   full-table scans on cascade delete/update and on every join through the
 *   FK). Not using CONCURRENTLY: at this data scale (see CLAUDE.md's own
 *   perf notes -- most tables are still low row counts) a plain CREATE INDEX
 *   inside the normal migration transaction is simpler and consistent with
 *   how every other schema change in this repo has been applied; revisit
 *   with CONCURRENTLY only if a specific table's lock time becomes a real
 *   problem later.
 */

BEGIN;

-- ============================================================
-- PART 1: drop duplicate indexes (33 pairs, keep the UNIQUE side)
-- ============================================================

DROP INDEX IF EXISTS acl.idx_workflow_requests_request_id;
DROP INDEX IF EXISTS erp_cache.idx_gst_profiles_gst;
DROP INDEX IF EXISTS erp_core.idx_erp_users_auth_user_id;
DROP INDEX IF EXISTS erp_hr.idx_holiday_calendar_company_date;
DROP INDEX IF EXISTS erp_hr.idx_day_records_employee_date;
DROP INDEX IF EXISTS erp_master.idx_cha_code;
DROP INDEX IF EXISTS erp_master.idx_cm_customer_code;
DROP INDEX IF EXISTS erp_master.idx_mca_material;
DROP INDEX IF EXISTS erp_master.idx_mcm_code;
DROP INDEX IF EXISTS erp_master.idx_mce_material_company;
DROP INDEX IF EXISTS erp_master.idx_mm_pace_code;
DROP INDEX IF EXISTS erp_master.idx_mpe_material_company;
DROP INDEX IF EXISTS erp_master.idx_ptm_code;
DROP INDEX IF EXISTS erp_master.idx_pm_port_code;
DROP INDEX IF EXISTS erp_master.idx_tm_code;
DROP INDEX IF EXISTS erp_master.idx_vm_vendor_code;
DROP INDEX IF EXISTS erp_master.idx_vmi_vendor_material;
DROP INDEX IF EXISTS erp_procurement.idx_csn_number;
DROP INDEX IF EXISTS erp_procurement.idx_dn_number;
DROP INDEX IF EXISTS erp_procurement.idx_dc_number;
DROP INDEX IF EXISTS erp_procurement.idx_exr_number;
DROP INDEX IF EXISTS erp_procurement.idx_ge_number;
DROP INDEX IF EXISTS erp_procurement.idx_gxi_ge;
DROP INDEX IF EXISTS erp_procurement.idx_grn_number;
DROP INDEX IF EXISTS erp_procurement.idx_iv_number;
DROP INDEX IF EXISTS erp_procurement.idx_qa_number;
DROP INDEX IF EXISTS erp_procurement.idx_lc_number;
DROP INDEX IF EXISTS erp_procurement.idx_rtv_number;
DROP INDEX IF EXISTS erp_procurement.idx_si_number;
DROP INDEX IF EXISTS erp_procurement.idx_so_number;
DROP INDEX IF EXISTS erp_procurement.idx_sto_number;
DROP INDEX IF EXISTS erp_production.idx_ac06_month_company;
DROP INDEX IF EXISTS erp_production.idx_sfg_qa_number;

-- ============================================================
-- PART 2: add covering indexes for foreign keys (220 constraints
-- across acl/erp_* schemas, generated from pg_constraint)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_fk_acl_versions_source_captured_by ON acl.acl_versions (source_captured_by);
CREATE INDEX IF NOT EXISTS idx_fk_approver_map_approver_user_id ON acl.approver_map (approver_user_id);
CREATE INDEX IF NOT EXISTS idx_fk_approver_map_approver_work_context_id ON acl.approver_map (approver_work_context_id);
CREATE INDEX IF NOT EXISTS idx_fk_approver_map_created_by ON acl.approver_map (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_approver_map_resource_code ON acl.approver_map (resource_code);
CREATE INDEX IF NOT EXISTS idx_fk_approver_map_subject_user_id ON acl.approver_map (subject_user_id);
CREATE INDEX IF NOT EXISTS idx_fk_approver_map_subject_work_context_id ON acl.approver_map (subject_work_context_id);
CREATE INDEX IF NOT EXISTS idx_fk_capability_menu_actions_menu_id ON acl.capability_menu_actions (menu_id);
CREATE INDEX IF NOT EXISTS idx_fk_menu_tree_child_menu_id ON acl.menu_tree (child_menu_id);
CREATE INDEX IF NOT EXISTS idx_fk_module_registry_project_id ON acl.module_registry (project_id);
CREATE INDEX IF NOT EXISTS idx_fk_precomputed_acl_view_work_context_id ON acl.precomputed_acl_view (work_context_id);
CREATE INDEX IF NOT EXISTS idx_fk_report_viewer_map_subject_user_id ON acl.report_viewer_map (subject_user_id);
CREATE INDEX IF NOT EXISTS idx_fk_report_viewer_map_created_by ON acl.report_viewer_map (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_report_viewer_map_module_code ON acl.report_viewer_map (module_code);
CREATE INDEX IF NOT EXISTS idx_fk_report_viewer_map_resource_code ON acl.report_viewer_map (resource_code);
CREATE INDEX IF NOT EXISTS idx_fk_report_viewer_map_subject_work_context_id ON acl.report_viewer_map (subject_work_context_id);
CREATE INDEX IF NOT EXISTS idx_fk_report_viewer_map_viewer_user_id ON acl.report_viewer_map (viewer_user_id);
CREATE INDEX IF NOT EXISTS idx_fk_role_capabilities_capability_code ON acl.role_capabilities (capability_code);
CREATE INDEX IF NOT EXISTS idx_fk_role_menu_permissions_menu_id ON acl.role_menu_permissions (menu_id);
CREATE INDEX IF NOT EXISTS idx_fk_user_override_audit_override_id ON acl.user_override_audit (override_id);
CREATE INDEX IF NOT EXISTS idx_fk_user_override_audit_performed_by ON acl.user_override_audit (performed_by);
CREATE INDEX IF NOT EXISTS idx_fk_user_overrides_company_id ON acl.user_overrides (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_user_overrides_created_by ON acl.user_overrides (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_user_overrides_revoked_by ON acl.user_overrides (revoked_by);
CREATE INDEX IF NOT EXISTS idx_fk_version_capability_menu_actions_capability_code ON acl.version_capability_menu_actions (capability_code);
CREATE INDEX IF NOT EXISTS idx_fk_version_capability_menu_actions_menu_id ON acl.version_capability_menu_actions (menu_id);
CREATE INDEX IF NOT EXISTS idx_fk_version_company_module_map_company_id ON acl.version_company_module_map (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_version_role_capabilities_capability_code ON acl.version_role_capabilities (capability_code);
CREATE INDEX IF NOT EXISTS idx_fk_version_role_menu_permissions_menu_id ON acl.version_role_menu_permissions (menu_id);
CREATE INDEX IF NOT EXISTS idx_fk_version_user_overrides_company_id ON acl.version_user_overrides (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_version_work_context_capabilities_capability_code ON acl.version_work_context_capabilities (capability_code);
CREATE INDEX IF NOT EXISTS idx_fk_version_work_context_capabilities_work_context_id ON acl.version_work_context_capabilities (work_context_id);
CREATE INDEX IF NOT EXISTS idx_fk_work_context_capabilities_capability_code ON acl.work_context_capabilities (capability_code);
CREATE INDEX IF NOT EXISTS idx_fk_workflow_decisions_approver_auth_user_id ON acl.workflow_decisions (approver_auth_user_id);
CREATE INDEX IF NOT EXISTS idx_fk_workflow_decisions_overridden_by ON acl.workflow_decisions (overridden_by);
CREATE INDEX IF NOT EXISTS idx_fk_workflow_requests_requester_work_context_id ON acl.workflow_requests (requester_work_context_id);
CREATE INDEX IF NOT EXISTS idx_fk_workflow_requests_resource_code ON acl.workflow_requests (resource_code);
CREATE INDEX IF NOT EXISTS idx_fk_workflow_requests_acl_version_id ON acl.workflow_requests (acl_version_id);
CREATE INDEX IF NOT EXISTS idx_fk_workflow_requests_created_by ON acl.workflow_requests (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_workflow_requests_module_code ON acl.workflow_requests (module_code);
CREATE INDEX IF NOT EXISTS idx_fk_workflow_requests_project_id ON acl.workflow_requests (project_id);
CREATE INDEX IF NOT EXISTS idx_fk_user_work_contexts_company_id ON erp_acl.user_work_contexts (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_user_work_contexts_work_context_id ON erp_acl.user_work_contexts (work_context_id);
CREATE INDEX IF NOT EXISTS idx_fk_work_contexts_department_id ON erp_acl.work_contexts (department_id);
CREATE INDEX IF NOT EXISTS idx_fk_session_menu_snapshot_work_context_id ON erp_cache.session_menu_snapshot (work_context_id);
CREATE INDEX IF NOT EXISTS idx_fk_session_cluster_join_tickets_consumed_by_window_id ON erp_core.session_cluster_join_tickets (consumed_by_window_id);
CREATE INDEX IF NOT EXISTS idx_fk_session_cluster_join_tickets_issued_by_window_id ON erp_core.session_cluster_join_tickets (issued_by_window_id);
CREATE INDEX IF NOT EXISTS idx_fk_session_clusters_replaced_by_cluster_id ON erp_core.session_clusters (replaced_by_cluster_id);
CREATE INDEX IF NOT EXISTS idx_fk_session_clusters_root_session_id ON erp_core.session_clusters (root_session_id);
CREATE INDEX IF NOT EXISTS idx_fk_sessions_revoked_by ON erp_core.sessions (revoked_by);
CREATE INDEX IF NOT EXISTS idx_fk_attendance_correction_requests_cancelled_by ON erp_hr.attendance_correction_requests (cancelled_by);
CREATE INDEX IF NOT EXISTS idx_fk_attendance_correction_requests_created_by ON erp_hr.attendance_correction_requests (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_company_holiday_calendar_created_by ON erp_hr.company_holiday_calendar (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_company_week_off_config_updated_by ON erp_hr.company_week_off_config (updated_by);
CREATE INDEX IF NOT EXISTS idx_fk_employee_day_records_corrected_by ON erp_hr.employee_day_records (corrected_by);
CREATE INDEX IF NOT EXISTS idx_fk_employee_day_records_employee_auth_user_id ON erp_hr.employee_day_records (employee_auth_user_id);
CREATE INDEX IF NOT EXISTS idx_fk_employee_day_records_leave_request_id ON erp_hr.employee_day_records (leave_request_id);
CREATE INDEX IF NOT EXISTS idx_fk_employee_day_records_leave_type_id ON erp_hr.employee_day_records (leave_type_id);
CREATE INDEX IF NOT EXISTS idx_fk_employee_day_records_out_work_request_id ON erp_hr.employee_day_records (out_work_request_id);
CREATE INDEX IF NOT EXISTS idx_fk_leave_requests_requester_work_context_id ON erp_hr.leave_requests (requester_work_context_id);
CREATE INDEX IF NOT EXISTS idx_fk_leave_requests_applied_by_auth_user_id ON erp_hr.leave_requests (applied_by_auth_user_id);
CREATE INDEX IF NOT EXISTS idx_fk_leave_requests_cancelled_by ON erp_hr.leave_requests (cancelled_by);
CREATE INDEX IF NOT EXISTS idx_fk_leave_requests_created_by ON erp_hr.leave_requests (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_leave_requests_leave_type_id ON erp_hr.leave_requests (leave_type_id);
CREATE INDEX IF NOT EXISTS idx_fk_leave_types_created_by ON erp_hr.leave_types (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_out_work_requests_requester_work_context_id ON erp_hr.out_work_requests (requester_work_context_id);
CREATE INDEX IF NOT EXISTS idx_fk_out_work_requests_applied_by_auth_user_id ON erp_hr.out_work_requests (applied_by_auth_user_id);
CREATE INDEX IF NOT EXISTS idx_fk_out_work_requests_cancelled_by ON erp_hr.out_work_requests (cancelled_by);
CREATE INDEX IF NOT EXISTS idx_fk_out_work_requests_created_by ON erp_hr.out_work_requests (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_out_work_requests_destination_id ON erp_hr.out_work_requests (destination_id);
CREATE INDEX IF NOT EXISTS idx_fk_location_transfer_posting_request_id ON erp_inventory.location_transfer_posting (request_id);
CREATE INDEX IF NOT EXISTS idx_fk_location_transfer_rule_dest_location_id ON erp_inventory.location_transfer_rule (dest_location_id);
CREATE INDEX IF NOT EXISTS idx_fk_movement_type_master_reversal_of ON erp_inventory.movement_type_master (reversal_of);
CREATE INDEX IF NOT EXISTS idx_fk_stock_document_reversal_document_id ON erp_inventory.stock_document (reversal_document_id);
CREATE INDEX IF NOT EXISTS idx_fk_stock_document_source_location_id ON erp_inventory.stock_document (source_location_id);
CREATE INDEX IF NOT EXISTS idx_fk_stock_document_target_location_id ON erp_inventory.stock_document (target_location_id);
CREATE INDEX IF NOT EXISTS idx_fk_stock_snapshot_last_ledger_id ON erp_inventory.stock_snapshot (last_ledger_id);
CREATE INDEX IF NOT EXISTS idx_fk_stock_status_change_posting_reversal_of_posting_id ON erp_inventory.stock_status_change_posting (reversal_of_posting_id);
CREATE INDEX IF NOT EXISTS idx_fk_stock_status_change_posting_stock_document_id_in ON erp_inventory.stock_status_change_posting (stock_document_id_in);
CREATE INDEX IF NOT EXISTS idx_fk_stock_status_change_posting_stock_document_id_out ON erp_inventory.stock_status_change_posting (stock_document_id_out);
CREATE INDEX IF NOT EXISTS idx_fk_stock_status_change_posting_storage_location_id ON erp_inventory.stock_status_change_posting (storage_location_id);
CREATE INDEX IF NOT EXISTS idx_fk_company_group_group_id ON erp_map.company_group (group_id);
CREATE INDEX IF NOT EXISTS idx_fk_company_projects_project_id ON erp_map.company_projects (project_id);
CREATE INDEX IF NOT EXISTS idx_fk_user_companies_company_id ON erp_map.user_companies (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_user_departments_department_id ON erp_map.user_departments (department_id);
CREATE INDEX IF NOT EXISTS idx_fk_user_parent_companies_company_id ON erp_map.user_parent_companies (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_user_projects_project_id ON erp_map.user_projects (project_id);
CREATE INDEX IF NOT EXISTS idx_fk_work_context_projects_created_by ON erp_map.work_context_projects (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_cha_company_map_company_id ON erp_master.cha_company_map (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_customer_company_map_company_id ON erp_master.customer_company_map (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_customer_master_origin_company_id ON erp_master.customer_master (origin_company_id);
CREATE INDEX IF NOT EXISTS idx_fk_customer_master_parent_customer_id ON erp_master.customer_master (parent_customer_id);
CREATE INDEX IF NOT EXISTS idx_fk_customer_master_vendor_id ON erp_master.customer_master (vendor_id);
CREATE INDEX IF NOT EXISTS idx_fk_departments_company_id ON erp_master.departments (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_lead_time_master_domestic_company_id ON erp_master.lead_time_master_domestic (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_lead_time_master_import_vendor_id ON erp_master.lead_time_master_import (vendor_id);
CREATE INDEX IF NOT EXISTS idx_fk_machine_master_cost_center_id ON erp_master.machine_master (cost_center_id);
CREATE INDEX IF NOT EXISTS idx_fk_material_category_group_member_material_id ON erp_master.material_category_group_member (material_id);
CREATE INDEX IF NOT EXISTS idx_fk_material_company_ext_company_id ON erp_master.material_company_ext (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_material_master_base_uom_code ON erp_master.material_master (base_uom_code);
CREATE INDEX IF NOT EXISTS idx_fk_material_master_issue_uom_code ON erp_master.material_master (issue_uom_code);
CREATE INDEX IF NOT EXISTS idx_fk_material_master_purchase_uom_code ON erp_master.material_master (purchase_uom_code);
CREATE INDEX IF NOT EXISTS idx_fk_material_plant_ext_company_id ON erp_master.material_plant_ext (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_material_uom_conversion_from_uom_code ON erp_master.material_uom_conversion (from_uom_code);
CREATE INDEX IF NOT EXISTS idx_fk_material_uom_conversion_to_uom_code ON erp_master.material_uom_conversion (to_uom_code);
CREATE INDEX IF NOT EXISTS idx_fk_payment_terms_master_reference_date_type_id ON erp_master.payment_terms_master (reference_date_type_id);
CREATE INDEX IF NOT EXISTS idx_fk_transporter_company_map_company_id ON erp_master.transporter_company_map (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_vendor_company_map_company_id ON erp_master.vendor_company_map (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_vendor_material_payment_term_payment_term_id ON erp_master.vendor_material_payment_term (payment_term_id);
CREATE INDEX IF NOT EXISTS idx_fk_vendor_material_uom_uom_code ON erp_master.vendor_material_uom (uom_code);
CREATE INDEX IF NOT EXISTS idx_fk_vendor_payment_terms_log_company_id ON erp_master.vendor_payment_terms_log (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_menu_snapshot_work_context_id ON erp_menu.menu_snapshot (work_context_id);
CREATE INDEX IF NOT EXISTS idx_fk_consignment_note_consignee_company_id ON erp_procurement.consignment_note (consignee_company_id);
CREATE INDEX IF NOT EXISTS idx_fk_consignment_note_last_mile_transporter_id ON erp_procurement.consignment_note (last_mile_transporter_id);
CREATE INDEX IF NOT EXISTS idx_fk_consignment_note_port_of_loading_id ON erp_procurement.consignment_note (port_of_loading_id);
CREATE INDEX IF NOT EXISTS idx_fk_delivery_challan_line_packing_order_id ON erp_procurement.delivery_challan_line (packing_order_id);
CREATE INDEX IF NOT EXISTS idx_fk_delivery_challan_line_so_map_allocation_id ON erp_procurement.delivery_challan_line (so_map_allocation_id);
CREATE INDEX IF NOT EXISTS idx_fk_delivery_challan_line_sto_line_id ON erp_procurement.delivery_challan_line (sto_line_id);
CREATE INDEX IF NOT EXISTS idx_fk_delivery_challan_line_storage_location_id ON erp_procurement.delivery_challan_line (storage_location_id);
CREATE INDEX IF NOT EXISTS idx_fk_gate_entry_line_po_line_id ON erp_procurement.gate_entry_line (po_line_id);
CREATE INDEX IF NOT EXISTS idx_fk_gate_exit_outbound_dc_id ON erp_procurement.gate_exit_outbound (dc_id);
CREATE INDEX IF NOT EXISTS idx_fk_goods_receipt_last_mile_transporter_id ON erp_procurement.goods_receipt (last_mile_transporter_id);
CREATE INDEX IF NOT EXISTS idx_fk_goods_receipt_po_line_id ON erp_procurement.goods_receipt (po_line_id);
CREATE INDEX IF NOT EXISTS idx_fk_goods_receipt_reversal_grn_id ON erp_procurement.goods_receipt (reversal_grn_id);
CREATE INDEX IF NOT EXISTS idx_fk_inward_qa_document_grn_line_id ON erp_procurement.inward_qa_document (grn_line_id);
CREATE INDEX IF NOT EXISTS idx_fk_inward_qa_document_po_id ON erp_procurement.inward_qa_document (po_id);
CREATE INDEX IF NOT EXISTS idx_fk_landed_cost_po_id ON erp_procurement.landed_cost (po_id);
CREATE INDEX IF NOT EXISTS idx_fk_landed_cost_deduction_line_deduction_type_id ON erp_procurement.landed_cost_deduction_line (deduction_type_id);
CREATE INDEX IF NOT EXISTS idx_fk_physical_inventory_document_company_id ON erp_procurement.physical_inventory_document (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_physical_inventory_item_packing_order_id ON erp_procurement.physical_inventory_item (packing_order_id);
CREATE INDEX IF NOT EXISTS idx_fk_return_to_vendor_po_id ON erp_procurement.return_to_vendor (po_id);
CREATE INDEX IF NOT EXISTS idx_fk_return_to_vendor_line_grn_line_id ON erp_procurement.return_to_vendor_line (grn_line_id);
CREATE INDEX IF NOT EXISTS idx_fk_sales_invoice_sto_id ON erp_procurement.sales_invoice (sto_id);
CREATE INDEX IF NOT EXISTS idx_fk_sales_invoice_additional_cost_line_category_id ON erp_procurement.sales_invoice_additional_cost_line (category_id);
CREATE INDEX IF NOT EXISTS idx_fk_sales_order_bill_to_depot_code_id ON erp_procurement.sales_order (bill_to_depot_code_id);
CREATE INDEX IF NOT EXISTS idx_fk_sales_order_bill_to_parent_company_id ON erp_procurement.sales_order (bill_to_parent_company_id);
CREATE INDEX IF NOT EXISTS idx_fk_sales_order_bill_to_vdc_id ON erp_procurement.sales_order (bill_to_vdc_id);
CREATE INDEX IF NOT EXISTS idx_fk_sales_order_map_allocation_customer_address_id ON erp_procurement.sales_order_map_allocation (customer_address_id);
CREATE INDEX IF NOT EXISTS idx_fk_sales_order_map_group_customer_address_id ON erp_procurement.sales_order_map_group (customer_address_id);
CREATE INDEX IF NOT EXISTS idx_fk_sales_order_map_group_depot_code_id ON erp_procurement.sales_order_map_group (depot_code_id);
CREATE INDEX IF NOT EXISTS idx_fk_sales_order_map_group_fo_id ON erp_procurement.sales_order_map_group (fo_id);
CREATE INDEX IF NOT EXISTS idx_fk_sto_amendment_log_sto_id ON erp_procurement.sto_amendment_log (sto_id);
CREATE INDEX IF NOT EXISTS idx_fk_sto_amendment_log_sto_line_id ON erp_procurement.sto_amendment_log (sto_line_id);
CREATE INDEX IF NOT EXISTS idx_fk_sto_approval_log_sto_id ON erp_procurement.sto_approval_log (sto_id);
CREATE INDEX IF NOT EXISTS idx_fk_ac06_costing_group_company_id ON erp_production.ac06_costing_group (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_ac06_month_carry_forward_from_month_id ON erp_production.ac06_month (carry_forward_from_month_id);
CREATE INDEX IF NOT EXISTS idx_fk_ac06_month_archive_company_id ON erp_production.ac06_month_archive (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_ac06_month_archive_group_config_material_id ON erp_production.ac06_month_archive_group_config (material_id);
CREATE INDEX IF NOT EXISTS idx_fk_ac06_month_archive_line_material_id ON erp_production.ac06_month_archive_line (material_id);
CREATE INDEX IF NOT EXISTS idx_fk_ac06_month_group_config_company_id ON erp_production.ac06_month_group_config (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_ac06_month_group_config_costing_group_id ON erp_production.ac06_month_group_config (costing_group_id);
CREATE INDEX IF NOT EXISTS idx_fk_ac06_month_group_config_material_id ON erp_production.ac06_month_group_config (material_id);
CREATE INDEX IF NOT EXISTS idx_fk_ac06_month_group_config_source_sloc_group_id ON erp_production.ac06_month_group_config (source_sloc_group_id);
CREATE INDEX IF NOT EXISTS idx_fk_ac06_month_line_company_id ON erp_production.ac06_month_line (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_ac06_month_line_costing_group_id ON erp_production.ac06_month_line (costing_group_id);
CREATE INDEX IF NOT EXISTS idx_fk_ac06_month_line_material_id ON erp_production.ac06_month_line (material_id);
CREATE INDEX IF NOT EXISTS idx_fk_ac06_month_line_source_sloc_group_id ON erp_production.ac06_month_line (source_sloc_group_id);
CREATE INDEX IF NOT EXISTS idx_fk_ac06_sloc_group_member_storage_location_id ON erp_production.ac06_sloc_group_member (storage_location_id);
CREATE INDEX IF NOT EXISTS idx_fk_batch_number_instance_prodshade_material_id ON erp_production.batch_number_instance (prodshade_material_id);
CREATE INDEX IF NOT EXISTS idx_fk_batch_number_series_prodshade_material_id ON erp_production.batch_number_series (prodshade_material_id);
CREATE INDEX IF NOT EXISTS idx_fk_conversion_cost_config_prodshade_material_id ON erp_production.conversion_cost_config (prodshade_material_id);
CREATE INDEX IF NOT EXISTS idx_fk_pack_bom_sku_material_id ON erp_production.pack_bom (sku_material_id);
CREATE INDEX IF NOT EXISTS idx_fk_pack_bom_change_request_pack_bom_id ON erp_production.pack_bom_change_request (pack_bom_id);
CREATE INDEX IF NOT EXISTS idx_fk_pack_bom_change_request_line_bom_line_id ON erp_production.pack_bom_change_request_line (bom_line_id);
CREATE INDEX IF NOT EXISTS idx_fk_pack_bom_change_request_line_change_request_id ON erp_production.pack_bom_change_request_line (change_request_id);
CREATE INDEX IF NOT EXISTS idx_fk_pack_bom_line_material_id ON erp_production.pack_bom_line (material_id);
CREATE INDEX IF NOT EXISTS idx_fk_pack_bom_line_pack_bom_id ON erp_production.pack_bom_line (pack_bom_id);
CREATE INDEX IF NOT EXISTS idx_fk_pack_bom_line_storage_location_id ON erp_production.pack_bom_line (storage_location_id);
CREATE INDEX IF NOT EXISTS idx_fk_pack_code_master_outer_uom_code ON erp_production.pack_code_master (outer_uom_code);
CREATE INDEX IF NOT EXISTS idx_fk_packing_order_machine_id ON erp_production.packing_order (machine_id);
CREATE INDEX IF NOT EXISTS idx_fk_packing_order_material_id ON erp_production.packing_order (material_id);
CREATE INDEX IF NOT EXISTS idx_fk_packing_order_pack_code_id ON erp_production.packing_order (pack_code_id);
CREATE INDEX IF NOT EXISTS idx_fk_packing_order_line_actual_material_id ON erp_production.packing_order_line (actual_material_id);
CREATE INDEX IF NOT EXISTS idx_fk_packing_order_line_issue_sloc_id ON erp_production.packing_order_line (issue_sloc_id);
CREATE INDEX IF NOT EXISTS idx_fk_packing_order_line_material_group_id ON erp_production.packing_order_line (material_group_id);
CREATE INDEX IF NOT EXISTS idx_fk_packing_order_line_material_id ON erp_production.packing_order_line (material_id);
CREATE INDEX IF NOT EXISTS idx_fk_packing_order_line_packing_order_id ON erp_production.packing_order_line (packing_order_id);
CREATE INDEX IF NOT EXISTS idx_fk_packing_order_line_stock_ledger_id ON erp_production.packing_order_line (stock_ledger_id);
CREATE INDEX IF NOT EXISTS idx_fk_partial_batch_reversal_prodshade_material_id ON erp_production.partial_batch_reversal (prodshade_material_id);
CREATE INDEX IF NOT EXISTS idx_fk_partial_batch_reversal_salvage_process_order_id ON erp_production.partial_batch_reversal (salvage_process_order_id);
CREATE INDEX IF NOT EXISTS idx_fk_partial_batch_reversal_selected_material_id ON erp_production.partial_batch_reversal (selected_material_id);
CREATE INDEX IF NOT EXISTS idx_fk_partial_batch_reversal_selected_storage_location_id ON erp_production.partial_batch_reversal (selected_storage_location_id);
CREATE INDEX IF NOT EXISTS idx_fk_partial_batch_reversal_line_formulation_material_id ON erp_production.partial_batch_reversal_line (formulation_material_id);
CREATE INDEX IF NOT EXISTS idx_fk_partial_batch_reversal_line_material_id ON erp_production.partial_batch_reversal_line (material_id);
CREATE INDEX IF NOT EXISTS idx_fk_partial_batch_reversal_line_storage_location_id ON erp_production.partial_batch_reversal_line (storage_location_id);
CREATE INDEX IF NOT EXISTS idx_fk_plan_feed_party_id ON erp_production.plan_feed (party_id);
CREATE INDEX IF NOT EXISTS idx_fk_plan_feed_item_material_id ON erp_production.plan_feed_item (material_id);
CREATE INDEX IF NOT EXISTS idx_fk_process_order_issue_sloc_override_id ON erp_production.process_order (issue_sloc_override_id);
CREATE INDEX IF NOT EXISTS idx_fk_process_order_machine_id ON erp_production.process_order (machine_id);
CREATE INDEX IF NOT EXISTS idx_fk_process_order_line_actual_material_id ON erp_production.process_order_line (actual_material_id);
CREATE INDEX IF NOT EXISTS idx_fk_process_order_line_issue_sloc_id ON erp_production.process_order_line (issue_sloc_id);
CREATE INDEX IF NOT EXISTS idx_fk_process_order_line_material_id ON erp_production.process_order_line (material_id);
CREATE INDEX IF NOT EXISTS idx_fk_process_order_line_process_order_id ON erp_production.process_order_line (process_order_id);
CREATE INDEX IF NOT EXISTS idx_fk_process_order_line_reco_actual_material_id ON erp_production.process_order_line_reco (actual_material_id);
CREATE INDEX IF NOT EXISTS idx_fk_process_order_line_reco_machine_id ON erp_production.process_order_line_reco (machine_id);
CREATE INDEX IF NOT EXISTS idx_fk_process_order_line_reco_material_id ON erp_production.process_order_line_reco (material_id);
CREATE INDEX IF NOT EXISTS idx_fk_process_order_line_reco_process_order_line_id ON erp_production.process_order_line_reco (process_order_line_id);
CREATE INDEX IF NOT EXISTS idx_fk_process_order_line_reco_prodshade_material_id ON erp_production.process_order_line_reco (prodshade_material_id);
CREATE INDEX IF NOT EXISTS idx_fk_process_order_line_reco_storage_location_id ON erp_production.process_order_line_reco (storage_location_id);
CREATE INDEX IF NOT EXISTS idx_fk_prodshade_pack_config_pack_code_id ON erp_production.prodshade_pack_config (pack_code_id);
CREATE INDEX IF NOT EXISTS idx_fk_production_segment_location_config_fg_sloc_id ON erp_production.production_segment_location_config (fg_sloc_id);
CREATE INDEX IF NOT EXISTS idx_fk_production_segment_location_config_pm_sloc_id ON erp_production.production_segment_location_config (pm_sloc_id);
CREATE INDEX IF NOT EXISTS idx_fk_production_segment_location_config_rm_sloc_id ON erp_production.production_segment_location_config (rm_sloc_id);
CREATE INDEX IF NOT EXISTS idx_fk_production_segment_location_config_shopfloor_sloc_id ON erp_production.production_segment_location_config (shopfloor_sloc_id);
CREATE INDEX IF NOT EXISTS idx_fk_reservation_document_company_id ON erp_production.reservation_document (company_id);
CREATE INDEX IF NOT EXISTS idx_fk_reservation_document_storage_location_id ON erp_production.reservation_document (storage_location_id);
CREATE INDEX IF NOT EXISTS idx_fk_stroke_change_request_stroke_master_id ON erp_production.stroke_change_request (stroke_master_id);
CREATE INDEX IF NOT EXISTS idx_fk_stroke_change_request_line_change_request_id ON erp_production.stroke_change_request_line (change_request_id);
CREATE INDEX IF NOT EXISTS idx_fk_stroke_change_request_line_new_group_id ON erp_production.stroke_change_request_line (new_group_id);
CREATE INDEX IF NOT EXISTS idx_fk_stroke_change_request_line_old_group_id ON erp_production.stroke_change_request_line (old_group_id);
CREATE INDEX IF NOT EXISTS idx_fk_stroke_change_request_line_stroke_line_id ON erp_production.stroke_change_request_line (stroke_line_id);
CREATE INDEX IF NOT EXISTS idx_fk_stroke_line_alternate_material_id ON erp_production.stroke_line (alternate_material_id);
CREATE INDEX IF NOT EXISTS idx_fk_stroke_line_default_storage_location_id ON erp_production.stroke_line (default_storage_location_id);
CREATE INDEX IF NOT EXISTS idx_fk_stroke_line_material_group_id ON erp_production.stroke_line (material_group_id);
CREATE INDEX IF NOT EXISTS idx_fk_stroke_line_material_id ON erp_production.stroke_line (material_id);
CREATE INDEX IF NOT EXISTS idx_fk_stroke_master_default_storage_location_id ON erp_production.stroke_master (default_storage_location_id);
CREATE INDEX IF NOT EXISTS idx_fk_stroke_master_source_stroke_master_id ON erp_production.stroke_master (source_stroke_master_id);
CREATE INDEX IF NOT EXISTS idx_fk_stroke_po_type_applicability_default_storage_location_id ON erp_production.stroke_po_type_applicability (default_storage_location_id);
CREATE INDEX IF NOT EXISTS idx_fk_stroke_share_event_source_stroke_master_id ON erp_production.stroke_share_event (source_stroke_master_id);
CREATE INDEX IF NOT EXISTS idx_fk_stroke_share_event_target_stroke_master_id ON erp_production.stroke_share_event (target_stroke_master_id);

COMMIT;
