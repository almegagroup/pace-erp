-- Suggested dependency capability helper SQL
-- LOW/MEDIUM only. Review manually before any ACL version workflow.

WITH target_companies (company_id, company_code) AS (
  VALUES
    ('c04f0a8b-ecf0-48ee-becc-174fc377723e'::uuid, 'CMP003'),
    ('88240088-9af7-46f5-86af-c4e635d3c9cd'::uuid, 'CMP006')
),
excluded_work_contexts (work_context_name) AS (
  VALUES
    ('ACL-MASTER'),
    ('DIRECTOR'),
    ('DIRECTOR-REPORTS'),
    ('MANAGEMENT-REPORTS')
),
dependency_map (
  owning_resource_code,
  owning_page,
  dependency_resource_code,
  dependency_action,
  dependency_fn,
  dependency_method,
  dependency_path,
  dependency_is_page,
  risk_flag
) AS (
  VALUES
    ('ACC_CONVERSION_COST', 'frontend/src/pages/dashboard/production/ConversionCostPage.jsx', 'SA_PROD_BATCH_SERIES', 'VIEW', 'listBatchSeries', 'GET', '/api/production/batch-series', TRUE, 'LOW'),
    ('OM_ASL_CREATE', 'frontend/src/pages/dashboard/om/asl/AslCreatePage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('OM_ASL_CREATE', 'frontend/src/pages/dashboard/om/asl/AslCreatePage.jsx', 'OM_VENDOR_CREATE', 'WRITE', 'createVendorMaterialInfo', 'POST', '/api/om/vendor-material-info', FALSE, 'MEDIUM'),
    ('OM_ASL_CREATE', 'frontend/src/pages/dashboard/om/asl/AslCreatePage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listMappedMaterialIdsForVendor', 'GET', '/api/om/vendor-material-info/mapped-materials?${params.toString()}', TRUE, 'LOW'),
    ('OM_ASL_CREATE', 'frontend/src/pages/dashboard/om/asl/AslCreatePage.jsx', 'PROC_PAYMENT_TERMS_MASTER', 'VIEW', 'listPaymentTerms', 'GET', '/api/procurement/payment-terms', TRUE, 'LOW'),
    ('OM_ASL_DETAIL', 'frontend/src/pages/dashboard/om/asl/AslDetailPage.jsx', 'OM_VENDOR_CREATE', 'EDIT', 'updateVendorMaterialInfo', 'PATCH', '/api/om/vendor-material-info', FALSE, 'MEDIUM'),
    ('OM_ASL_DETAIL', 'frontend/src/pages/dashboard/om/asl/AslDetailPage.jsx', 'OM_VENDOR_CREATE', 'WRITE', 'unmapVendorMaterialInfo', 'DELETE', '/api/om/vendor-material-info?${params.toString()}', FALSE, 'MEDIUM'),
    ('OM_ASL_DETAIL', 'frontend/src/pages/dashboard/om/asl/AslDetailPage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'getVendorMaterialInfo', 'GET', '/api/om/vendor-material-info?${params.toString()}', TRUE, 'LOW'),
    ('OM_ASL_DETAIL', 'frontend/src/pages/dashboard/om/asl/AslDetailPage.jsx', 'PROC_PAYMENT_TERMS_MASTER', 'VIEW', 'listPaymentTerms', 'GET', '/api/procurement/payment-terms', TRUE, 'LOW'),
    ('OM_ASL_LIST', 'frontend/src/pages/dashboard/om/asl/AslListPage.jsx', 'OM_VENDOR_CREATE', 'WRITE', 'unmapVendorMaterialInfo', 'DELETE', '/api/om/vendor-material-info?${params.toString()}', FALSE, 'MEDIUM'),
    ('OM_ASL_LIST', 'frontend/src/pages/dashboard/om/asl/AslListPage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listVendorMaterialInfos', 'GET', '/api/om/vendor-material-infos?${params.toString()}', TRUE, 'LOW'),
    ('OM_CUSTOMER_CREATE', 'frontend/src/pages/dashboard/om/customer/CustomerCreatePage.jsx', 'OM_CUSTOMER_LIST', 'VIEW', 'listParentCustomers', 'GET', '/api/om/parent-customers?${query.toString()}', TRUE, 'LOW'),
    ('OM_CUSTOMER_CREATE', 'frontend/src/pages/dashboard/om/customer/CustomerCreatePage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'getVendor', 'GET', '/api/om/vendor?${params.toString()}', TRUE, 'LOW'),
    ('OM_CUSTOMER_DETAIL', 'frontend/src/pages/dashboard/om/customer/CustomerDetailPage.jsx', 'OM_CUSTOMER_CREATE', 'EDIT', 'updateCustomer', 'PATCH', '/api/om/customer', TRUE, 'HIGH'),
    ('OM_CUSTOMER_DETAIL', 'frontend/src/pages/dashboard/om/customer/CustomerDetailPage.jsx', 'OM_CUSTOMER_CREATE', 'WRITE', 'mapCustomerToCompany', 'POST', '/api/om/customer/company-map', TRUE, 'HIGH'),
    ('OM_CUSTOMER_DETAIL', 'frontend/src/pages/dashboard/om/customer/CustomerDetailPage.jsx', 'OM_CUSTOMER_LIST', 'VIEW', 'getCustomer', 'GET', '/api/om/customer?${params.toString()}', TRUE, 'LOW'),
    ('OM_MATERIAL_DETAIL', 'frontend/src/pages/dashboard/om/material/MaterialDetailPage.jsx', 'OM_MATERIAL_CREATE', 'EDIT', 'updateMaterial', 'PATCH', '/api/om/material', FALSE, 'MEDIUM'),
    ('OM_MATERIAL_DETAIL', 'frontend/src/pages/dashboard/om/material/MaterialDetailPage.jsx', 'OM_MATERIAL_CREATE', 'WRITE', 'extendMaterialToCompany', 'POST', '/api/om/material/extend-company', FALSE, 'MEDIUM'),
    ('OM_MATERIAL_DETAIL', 'frontend/src/pages/dashboard/om/material/MaterialDetailPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'getMaterial', 'GET', '/api/om/material?${params.toString()}', TRUE, 'LOW'),
    ('OM_MATERIAL_DETAIL', 'frontend/src/pages/dashboard/om/material/MaterialDetailPage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listVendorMaterialInfos', 'GET', '/api/om/vendor-material-infos?${params.toString()}', TRUE, 'LOW'),
    ('OM_VENDOR_DETAIL', 'frontend/src/pages/dashboard/om/vendor/VendorDetailPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('OM_VENDOR_DETAIL', 'frontend/src/pages/dashboard/om/vendor/VendorDetailPage.jsx', 'OM_VENDOR_CREATE', 'EDIT', 'updateVendor', 'PATCH', '/api/om/vendor', FALSE, 'MEDIUM'),
    ('OM_VENDOR_DETAIL', 'frontend/src/pages/dashboard/om/vendor/VendorDetailPage.jsx', 'OM_VENDOR_CREATE', 'WRITE', 'addVendorPaymentTerms', 'POST', '/api/om/vendor/payment-terms', FALSE, 'MEDIUM'),
    ('OM_VENDOR_DETAIL', 'frontend/src/pages/dashboard/om/vendor/VendorDetailPage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'getVendor', 'GET', '/api/om/vendor?${params.toString()}', TRUE, 'LOW'),
    ('PROC_BLOCKED_IV_LIST', 'frontend/src/pages/dashboard/procurement/accounts/BlockedIVListPage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listVendors', 'GET', '/api/om/vendors?${params.toString()}', TRUE, 'LOW'),
    ('PROC_CHA_MASTER', 'frontend/src/pages/dashboard/procurement/masters/CHAMasterPage.jsx', 'PROC_PORT_MASTER', 'VIEW', 'listPorts', 'GET', '/api/procurement/ports', TRUE, 'LOW'),
    ('PROC_CSN_DETAIL', 'frontend/src/pages/dashboard/procurement/csn/CSNDetailPage.jsx', 'PROC_CSN_TRACKER', 'EDIT', 'updateCSN', 'PUT', '/api/procurement/csns/${encodeURIComponent(id)}', TRUE, 'HIGH'),
    ('PROC_CSN_DETAIL', 'frontend/src/pages/dashboard/procurement/csn/CSNDetailPage.jsx', 'PROC_CSN_TRACKER', 'VIEW', 'listCSNs', 'GET', '/api/procurement/csns', TRUE, 'LOW'),
    ('PROC_CSN_DETAIL', 'frontend/src/pages/dashboard/procurement/csn/CSNDetailPage.jsx', 'PROC_PORT_MASTER', 'VIEW', 'listPorts', 'GET', '/api/procurement/ports', TRUE, 'LOW'),
    ('PROC_CSN_DETAIL', 'frontend/src/pages/dashboard/procurement/csn/CSNDetailPage.jsx', 'PROC_TRANSPORTER_MASTER', 'VIEW', 'listTransporters', 'GET', '/api/procurement/transporters', TRUE, 'LOW'),
    ('PROC_CSN_TRACKER', 'frontend/src/pages/dashboard/procurement/csn/CSNTrackerPage.jsx', 'PROC_CHA_MASTER', 'VIEW', 'listCHAs', 'GET', '/api/procurement/chas', TRUE, 'LOW'),
    ('PROC_CSN_TRACKER', 'frontend/src/pages/dashboard/procurement/csn/CSNTrackerPage.jsx', 'PROC_CSN_ALERTS', 'VIEW', 'getAllAlertCounts', 'GET', '/api/procurement/alerts/counts', TRUE, 'LOW'),
    ('PROC_CSN_TRACKER', 'frontend/src/pages/dashboard/procurement/csn/CSNTrackerPage.jsx', 'PROC_PORT_MASTER', 'VIEW', 'listPorts', 'GET', '/api/procurement/ports', TRUE, 'LOW'),
    ('PROC_CSN_TRACKER', 'frontend/src/pages/dashboard/procurement/csn/CSNTrackerPage.jsx', 'PROC_TRANSPORTER_MASTER', 'VIEW', 'listTransporters', 'GET', '/api/procurement/transporters', TRUE, 'LOW'),
    ('PROC_CURRENT_STOCK', 'frontend/src/pages/dashboard/procurement/reports/CurrentStockPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROC_DEBIT_NOTE_DETAIL', 'frontend/src/pages/dashboard/procurement/rtv/DebitNoteDetailPage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listVendors', 'GET', '/api/om/vendors?${params.toString()}', TRUE, 'LOW'),
    ('PROC_DEBIT_NOTE_DETAIL', 'frontend/src/pages/dashboard/procurement/rtv/DebitNoteDetailPage.jsx', 'PROC_DEBIT_NOTE_LIST', 'APPROVE', 'acknowledgeDebitNote', 'POST', '/api/procurement/debit-notes/${encodeURIComponent(id)}/acknowledge', TRUE, 'HIGH'),
    ('PROC_DEBIT_NOTE_DETAIL', 'frontend/src/pages/dashboard/procurement/rtv/DebitNoteDetailPage.jsx', 'PROC_DEBIT_NOTE_LIST', 'EDIT', 'markDebitNoteSent', 'POST', '/api/procurement/debit-notes/${encodeURIComponent(id)}/mark-sent', TRUE, 'HIGH'),
    ('PROC_DEBIT_NOTE_DETAIL', 'frontend/src/pages/dashboard/procurement/rtv/DebitNoteDetailPage.jsx', 'PROC_DEBIT_NOTE_LIST', 'VIEW', 'getDebitNote', 'GET', '/api/procurement/debit-notes/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_DEBIT_NOTE_LIST', 'frontend/src/pages/dashboard/procurement/rtv/DebitNoteListPage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listVendors', 'GET', '/api/om/vendors?${params.toString()}', TRUE, 'LOW'),
    ('PROC_DO_CREATE', 'frontend/src/pages/dashboard/procurement/sales/DOCreatePage.jsx', 'PROC_TRANSPORTER_MASTER', 'VIEW', 'listTransporters', 'GET', '/api/procurement/transporters', TRUE, 'LOW'),
    ('PROC_DO_DETAIL', 'frontend/src/pages/dashboard/procurement/sales/DODetailPage.jsx', 'PROC_DO_CREATE', 'EDIT', 'cancelDeliveryOrder', 'POST', '/api/procurement/delivery-orders/${encodeURIComponent(id)}/cancel', TRUE, 'HIGH'),
    ('PROC_DO_DETAIL', 'frontend/src/pages/dashboard/procurement/sales/DODetailPage.jsx', 'PROC_DO_LIST', 'VIEW', 'getDeliveryOrder', 'GET', '/api/procurement/delivery-orders/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_EXCHANGE_REF_LIST', 'frontend/src/pages/dashboard/procurement/rtv/ExchangeRefListPage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listVendors', 'GET', '/api/om/vendors?${params.toString()}', TRUE, 'LOW'),
    ('PROC_GATE_ENTRY_DETAIL', 'frontend/src/pages/dashboard/procurement/gate/GateEntryDetailPage.jsx', 'PROC_GATE_ENTRY_CREATE', 'WRITE', 'createGateExitInbound', 'POST', '/api/procurement/gate-exits/inbound', TRUE, 'HIGH'),
    ('PROC_GATE_ENTRY_DETAIL', 'frontend/src/pages/dashboard/procurement/gate/GateEntryDetailPage.jsx', 'PROC_GATE_ENTRY_LIST', 'VIEW', 'getGateEntry', 'GET', '/api/procurement/gate-entries/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_GATE_ENTRY_DETAIL', 'frontend/src/pages/dashboard/procurement/gate/GateEntryDetailPage.jsx', 'PROC_GRN_LIST', 'WRITE', 'pruneGateEntry', 'POST', '/api/procurement/gate-entries/${encodeURIComponent(id)}/prune', TRUE, 'HIGH'),
    ('PROC_GATE_EXIT_INBOUND_DETAIL', 'frontend/src/pages/dashboard/procurement/gate/GateExitInboundDetailPage.jsx', 'PROC_GATE_ENTRY_LIST', 'VIEW', 'getGateExitInbound', 'GET', '/api/procurement/gate-exits/inbound/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_GATE_EXIT', 'frontend/src/pages/dashboard/procurement/gate/GateExitEntryPage.jsx', 'PROC_GATE_ENTRY_CREATE', 'WRITE', 'createGateExitInbound', 'POST', '/api/procurement/gate-exits/inbound', TRUE, 'HIGH'),
    ('PROC_GRN_DETAIL', 'frontend/src/pages/dashboard/procurement/grn/GRNDetailPage.jsx', 'PROC_GRN_LIST', 'DELETE', 'reverseGRN', 'POST', '/api/procurement/grns/${encodeURIComponent(id)}/reverse', TRUE, 'HIGH'),
    ('PROC_GRN_DETAIL', 'frontend/src/pages/dashboard/procurement/grn/GRNDetailPage.jsx', 'PROC_GRN_LIST', 'VIEW', 'getGRN', 'GET', '/api/procurement/grns/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_GRN_DETAIL', 'frontend/src/pages/dashboard/procurement/grn/GRNDetailPage.jsx', 'PROC_PO_LIST', 'VIEW', 'getDocumentFlow', 'GET', '/api/procurement/document-flow', TRUE, 'LOW'),
    ('PROC_GRN_POST_FLOW', 'frontend/src/pages/dashboard/procurement/grn/GRNPostFlow.jsx', 'PROC_GRN_LIST', 'VIEW', 'getGELinesForGRN', 'GET', '/api/procurement/grns/ge-lines', TRUE, 'LOW'),
    ('PROC_GRN_POST_FLOW', 'frontend/src/pages/dashboard/procurement/grn/GRNPostFlow.jsx', 'PROC_GRN_LIST', 'WRITE', 'createAndPostGRNFromLine', 'POST', '/api/procurement/grns/from-line', TRUE, 'HIGH'),
    ('PROC_GRN_POST_FLOW', 'frontend/src/pages/dashboard/procurement/grn/GRNPostFlow.jsx', 'PROC_TRANSPORTER_MASTER', 'VIEW', 'listTransporters', 'GET', '/api/procurement/transporters', TRUE, 'LOW'),
    ('PROC_IMPORT_LEAD_TIME_MASTER', 'frontend/src/pages/dashboard/procurement/masters/ImportLeadTimeMasterPage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listVendors', 'GET', '/api/om/vendors?${params.toString()}', TRUE, 'LOW'),
    ('PROC_IMPORT_LEAD_TIME_MASTER', 'frontend/src/pages/dashboard/procurement/masters/ImportLeadTimeMasterPage.jsx', 'PROC_DOMESTIC_LEAD_TIME_MASTER', 'DELETE', 'deleteDomesticLeadTime', 'DELETE', '/api/procurement/lead-times/domestic/${encodeURIComponent(id)}', FALSE, 'HIGH'),
    ('PROC_IMPORT_LEAD_TIME_MASTER', 'frontend/src/pages/dashboard/procurement/masters/ImportLeadTimeMasterPage.jsx', 'PROC_DOMESTIC_LEAD_TIME_MASTER', 'EDIT', 'updateDomesticLeadTime', 'PATCH', '/api/procurement/lead-times/domestic/${encodeURIComponent(id)}', FALSE, 'MEDIUM'),
    ('PROC_IMPORT_LEAD_TIME_MASTER', 'frontend/src/pages/dashboard/procurement/masters/ImportLeadTimeMasterPage.jsx', 'PROC_DOMESTIC_LEAD_TIME_MASTER', 'VIEW', 'listDomesticLeadTimes', 'GET', '/api/procurement/lead-times/domestic', FALSE, 'LOW'),
    ('PROC_IMPORT_LEAD_TIME_MASTER', 'frontend/src/pages/dashboard/procurement/masters/ImportLeadTimeMasterPage.jsx', 'PROC_DOMESTIC_LEAD_TIME_MASTER', 'WRITE', 'upsertDomesticLeadTime', 'POST', '/api/procurement/lead-times/domestic', FALSE, 'MEDIUM'),
    ('PROC_IMPORT_LEAD_TIME_MASTER', 'frontend/src/pages/dashboard/procurement/masters/ImportLeadTimeMasterPage.jsx', 'PROC_PORT_MASTER', 'VIEW', 'listPorts', 'GET', '/api/procurement/ports', TRUE, 'LOW'),
    ('PROC_INV_DETAIL', 'frontend/src/pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx', 'OM_CUSTOMER_LIST', 'VIEW', 'listCustomers', 'GET', '/api/om/customers?${params.toString()}', TRUE, 'LOW'),
    ('PROC_INV_DETAIL', 'frontend/src/pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROC_INV_DETAIL', 'frontend/src/pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx', 'PROC_INV_LIST', 'APPROVE', 'postSalesInvoice', 'POST', '/api/procurement/sales-invoices/${encodeURIComponent(id)}/post', TRUE, 'HIGH'),
    ('PROC_INV_DETAIL', 'frontend/src/pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx', 'PROC_INV_LIST', 'EDIT', 'reverseSalesInvoice', 'POST', '/api/procurement/sales-invoices/${encodeURIComponent(id)}/reverse', TRUE, 'HIGH'),
    ('PROC_INV_DETAIL', 'frontend/src/pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx', 'PROC_INV_LIST', 'VIEW', 'getSalesInvoice', 'GET', '/api/procurement/sales-invoices/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_INV_DETAIL', 'frontend/src/pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx', 'PROC_INV_LIST', 'WRITE', 'createSalesInvoice', 'POST', '/api/procurement/sales-invoices', TRUE, 'HIGH'),
    ('PROC_INV_DETAIL', 'frontend/src/pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx', 'PROC_PO_LIST', 'VIEW', 'getDocumentFlow', 'GET', '/api/procurement/document-flow', TRUE, 'LOW'),
    ('PROC_INV_DETAIL', 'frontend/src/pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx', 'PROC_SO_LIST', 'VIEW', 'getSalesOrder', 'GET', '/api/procurement/sales-orders/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_INV_LIST', 'frontend/src/pages/dashboard/procurement/sales/SalesInvoiceListPage.jsx', 'PROC_DO_LIST', 'VIEW', 'listDeliveryOrders', 'GET', '/api/procurement/delivery-orders', TRUE, 'LOW'),
    ('PROC_INV_PGI_CREATE', 'frontend/src/pages/dashboard/procurement/sales/PgiInvoiceCreatePage.jsx', 'PROC_DO_LIST', 'VIEW', 'getDeliveryOrder', 'GET', '/api/procurement/delivery-orders/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_INV_PGI_CREATE', 'frontend/src/pages/dashboard/procurement/sales/PgiInvoiceCreatePage.jsx', 'PROC_INV_LIST', 'WRITE', 'createPgiInvoice', 'POST', '/api/procurement/sales-invoices/pgi', TRUE, 'HIGH'),
    ('PROC_IV_CREATE', 'frontend/src/pages/dashboard/procurement/accounts/IVCreatePage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROC_IV_CREATE', 'frontend/src/pages/dashboard/procurement/accounts/IVCreatePage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listVendors', 'GET', '/api/om/vendors?${params.toString()}', TRUE, 'LOW'),
    ('PROC_IV_CREATE', 'frontend/src/pages/dashboard/procurement/accounts/IVCreatePage.jsx', 'PROC_GRN_LIST', 'VIEW', 'listGRNs', 'GET', '/api/procurement/grns', TRUE, 'LOW'),
    ('PROC_IV_DETAIL', 'frontend/src/pages/dashboard/procurement/accounts/IVDetailPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROC_IV_DETAIL', 'frontend/src/pages/dashboard/procurement/accounts/IVDetailPage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listVendors', 'GET', '/api/om/vendors?${params.toString()}', TRUE, 'LOW'),
    ('PROC_IV_DETAIL', 'frontend/src/pages/dashboard/procurement/accounts/IVDetailPage.jsx', 'PROC_IV_CREATE', 'APPROVE', 'postIV', 'POST', '/api/procurement/invoice-verifications/${encodeURIComponent(id)}/post', TRUE, 'HIGH'),
    ('PROC_IV_DETAIL', 'frontend/src/pages/dashboard/procurement/accounts/IVDetailPage.jsx', 'PROC_IV_CREATE', 'DELETE', 'removeIVLine', 'DELETE', '/api/procurement/invoice-verifications/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}', TRUE, 'HIGH'),
    ('PROC_IV_DETAIL', 'frontend/src/pages/dashboard/procurement/accounts/IVDetailPage.jsx', 'PROC_IV_CREATE', 'WRITE', 'addIVLine', 'POST', '/api/procurement/invoice-verifications/${encodeURIComponent(id)}/lines', TRUE, 'HIGH'),
    ('PROC_IV_DETAIL', 'frontend/src/pages/dashboard/procurement/accounts/IVDetailPage.jsx', 'PROC_IV_LIST', 'VIEW', 'getIV', 'GET', '/api/procurement/invoice-verifications/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_IV_DETAIL', 'frontend/src/pages/dashboard/procurement/accounts/IVDetailPage.jsx', 'PROC_PO_LIST', 'VIEW', 'getDocumentFlow', 'GET', '/api/procurement/document-flow', TRUE, 'LOW'),
    ('PROC_IV_LIST', 'frontend/src/pages/dashboard/procurement/accounts/IVListPage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listVendors', 'GET', '/api/om/vendors?${params.toString()}', TRUE, 'LOW'),
    ('PROC_IV_LIST', 'frontend/src/pages/dashboard/procurement/accounts/IVListPage.jsx', 'PROC_BLOCKED_IV_LIST', 'VIEW', 'listBlockedIVs', 'GET', '/api/procurement/invoice-verifications/blocked', TRUE, 'LOW'),
    ('PROC_LC_DETAIL', 'frontend/src/pages/dashboard/procurement/accounts/LandedCostDetailPage.jsx', 'PROC_CHA_MASTER', 'VIEW', 'listCHAs', 'GET', '/api/procurement/chas', TRUE, 'LOW'),
    ('PROC_LC_DETAIL', 'frontend/src/pages/dashboard/procurement/accounts/LandedCostDetailPage.jsx', 'PROC_LC_LIST', 'APPROVE', 'postLandedCost', 'POST', '/api/procurement/landed-costs/${encodeURIComponent(id)}/post', TRUE, 'HIGH'),
    ('PROC_LC_DETAIL', 'frontend/src/pages/dashboard/procurement/accounts/LandedCostDetailPage.jsx', 'PROC_LC_LIST', 'DELETE', 'deleteLCLine', 'DELETE', '/api/procurement/landed-costs/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}', TRUE, 'HIGH'),
    ('PROC_LC_DETAIL', 'frontend/src/pages/dashboard/procurement/accounts/LandedCostDetailPage.jsx', 'PROC_LC_LIST', 'EDIT', 'updateLCLine', 'PUT', '/api/procurement/landed-costs/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}', TRUE, 'HIGH'),
    ('PROC_LC_DETAIL', 'frontend/src/pages/dashboard/procurement/accounts/LandedCostDetailPage.jsx', 'PROC_LC_LIST', 'VIEW', 'getLandedCost', 'GET', '/api/procurement/landed-costs/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_LC_DETAIL', 'frontend/src/pages/dashboard/procurement/accounts/LandedCostDetailPage.jsx', 'PROC_LC_LIST', 'WRITE', 'createLandedCost', 'POST', '/api/procurement/landed-costs', TRUE, 'HIGH'),
    ('PROC_LC_DETAIL', 'frontend/src/pages/dashboard/procurement/accounts/LandedCostDetailPage.jsx', 'PROC_PO_LIST', 'VIEW', 'getDocumentFlow', 'GET', '/api/procurement/document-flow', TRUE, 'LOW'),
    ('PROC_LC_LIST', 'frontend/src/pages/dashboard/procurement/accounts/LandedCostListPage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listVendors', 'GET', '/api/om/vendors?${params.toString()}', TRUE, 'LOW'),
    ('PROC_LC_LIST', 'frontend/src/pages/dashboard/procurement/accounts/LandedCostListPage.jsx', 'PROC_GRN_LIST', 'VIEW', 'getGRN', 'GET', '/api/procurement/grns/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_MATERIAL_CATEGORY_MASTER', 'frontend/src/pages/dashboard/procurement/masters/MaterialCategoryMasterPage.jsx', 'OM_MATERIAL_CREATE', 'WRITE', 'createMaterialCategoryGroup', 'POST', '/api/om/material/category-group', FALSE, 'MEDIUM'),
    ('PROC_MATERIAL_CATEGORY_MASTER', 'frontend/src/pages/dashboard/procurement/masters/MaterialCategoryMasterPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterialCategoryGroups', 'GET', '/api/om/material/category-groups?${params.toString()}', TRUE, 'LOW'),
    ('PROC_OPENING_STOCK_APPROVAL', 'frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockApprovalPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROC_OPENING_STOCK_APPROVAL', 'frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockApprovalPage.jsx', 'PROC_PO_LIST', 'VIEW', 'listMaterialUomConversionsForProcurement', 'GET', '/api/procurement/materials/uom-conversion', TRUE, 'LOW'),
    ('PROC_OPENING_STOCK_APPROVAL', 'frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockApprovalPage.jsx', 'PROD_OLD_PACKING_PO', 'VIEW', 'listOldProcessPoBatches', 'GET', '/api/production/old-process-po/batches', TRUE, 'LOW'),
    ('PROC_OPENING_STOCK_DETAIL', 'frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockDetailPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROC_OPENING_STOCK_DETAIL', 'frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockDetailPage.jsx', 'PROC_OPENING_STOCK_APPROVAL', 'APPROVE', 'recalculateValuation', 'POST', '/api/procurement/opening-stock/recalculate-valuation', TRUE, 'HIGH'),
    ('PROC_OPENING_STOCK_DETAIL', 'frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockDetailPage.jsx', 'PROC_OPENING_STOCK_LIST', 'DELETE', 'removeOpeningStockLine', 'DELETE', '/api/procurement/opening-stock/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}', TRUE, 'HIGH'),
    ('PROC_OPENING_STOCK_DETAIL', 'frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockDetailPage.jsx', 'PROC_OPENING_STOCK_LIST', 'EDIT', 'updateOpeningStockLine', 'PUT', '/api/procurement/opening-stock/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}', TRUE, 'HIGH'),
    ('PROC_OPENING_STOCK_DETAIL', 'frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockDetailPage.jsx', 'PROC_OPENING_STOCK_LIST', 'VIEW', 'getOpeningStockDocument', 'GET', '/api/procurement/opening-stock/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_OPENING_STOCK_DETAIL', 'frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockDetailPage.jsx', 'PROC_OPENING_STOCK_LIST', 'WRITE', 'addOpeningStockLine', 'POST', '/api/procurement/opening-stock/${encodeURIComponent(id)}/lines', TRUE, 'HIGH'),
    ('PROC_OPENING_STOCK_DETAIL', 'frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockDetailPage.jsx', 'PROC_PO_LIST', 'VIEW', 'listMaterialUomConversionsForProcurement', 'GET', '/api/procurement/materials/uom-conversion', TRUE, 'LOW'),
    ('PROC_OPENING_STOCK_DETAIL', 'frontend/src/pages/dashboard/procurement/opening-stock/OpeningStockDetailPage.jsx', 'PROD_OLD_PACKING_PO', 'VIEW', 'listOldProcessPoBatches', 'GET', '/api/production/old-process-po/batches', TRUE, 'LOW'),
    ('PROC_PI_DETAIL', 'frontend/src/pages/dashboard/procurement/inventory/PIDocumentDetailPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROC_PI_DETAIL', 'frontend/src/pages/dashboard/procurement/inventory/PIDocumentDetailPage.jsx', 'PROC_PI_LIST', 'VIEW', 'getPIDocument', 'GET', '/api/procurement/physical-inventory/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_PI_DETAIL', 'frontend/src/pages/dashboard/procurement/inventory/PIDocumentDetailPage.jsx', 'PROC_PI_LIST', 'WRITE', 'addPIItem', 'POST', '/api/procurement/physical-inventory/${encodeURIComponent(id)}/items', TRUE, 'HIGH'),
    ('PROC_PI_DETAIL', 'frontend/src/pages/dashboard/procurement/inventory/PIDocumentDetailPage.jsx', 'PROC_PO_LIST', 'VIEW', 'getDocumentFlow', 'GET', '/api/procurement/document-flow', TRUE, 'LOW'),
    ('PROC_PLANT_TRANSFER_DETAIL', 'frontend/src/pages/dashboard/procurement/transfer/PlantTransferDetailPage.jsx', 'PROC_PLANT_TRANSFER_LIST', 'APPROVE', 'approvePTO', 'POST', '/api/procurement/ptos/${encodeURIComponent(id)}/approve', TRUE, 'HIGH'),
    ('PROC_PLANT_TRANSFER_DETAIL', 'frontend/src/pages/dashboard/procurement/transfer/PlantTransferDetailPage.jsx', 'PROC_PLANT_TRANSFER_LIST', 'EDIT', 'cancelPTO', 'POST', '/api/procurement/ptos/${encodeURIComponent(id)}/cancel', TRUE, 'HIGH'),
    ('PROC_PLANT_TRANSFER_DETAIL', 'frontend/src/pages/dashboard/procurement/transfer/PlantTransferDetailPage.jsx', 'PROC_PLANT_TRANSFER_LIST', 'VIEW', 'getPTO', 'GET', '/api/procurement/ptos/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_PLANT_TRANSFER_DETAIL', 'frontend/src/pages/dashboard/procurement/transfer/PlantTransferDetailPage.jsx', 'PROC_PLANT_TRANSFER_LIST', 'WRITE', 'oneStepTransfer', 'POST', '/api/procurement/ptos/${encodeURIComponent(id)}/one-step', TRUE, 'HIGH'),
    ('PROC_PLANT_TRANSFER_LIST', 'frontend/src/pages/dashboard/procurement/transfer/PlantTransferListPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROC_PO_CREATE_OPENING', 'frontend/src/pages/dashboard/procurement/po/POCreateOpeningPage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'getVendorMaterialInfo', 'GET', '/api/om/vendor-material-info?${params.toString()}', TRUE, 'LOW'),
    ('PROC_PO_CREATE_OPENING', 'frontend/src/pages/dashboard/procurement/po/POCreateOpeningPage.jsx', 'PROC_PAYMENT_TERMS_MASTER', 'VIEW', 'listPaymentTerms', 'GET', '/api/procurement/payment-terms', TRUE, 'LOW'),
    ('PROC_PO_CREATE_OPENING', 'frontend/src/pages/dashboard/procurement/po/POCreateOpeningPage.jsx', 'PROC_PO_CREATE', 'EDIT', 'confirmPurchaseOrder', 'POST', '/api/procurement/purchase-orders/${encodeURIComponent(id)}/confirm', TRUE, 'HIGH'),
    ('PROC_PO_CREATE_OPENING', 'frontend/src/pages/dashboard/procurement/po/POCreateOpeningPage.jsx', 'PROC_PO_CREATE', 'WRITE', 'createPurchaseOrder', 'POST', '/api/procurement/purchase-orders', TRUE, 'HIGH'),
    ('PROC_PO_CREATE_OPENING', 'frontend/src/pages/dashboard/procurement/po/POCreateOpeningPage.jsx', 'PROC_PO_LIST', 'VIEW', 'getPoFilterOptions', 'GET', '/api/procurement/po-filter-options', TRUE, 'LOW'),
    ('PROC_PO_CREATE', 'frontend/src/pages/dashboard/procurement/po/POCreatePage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'getVendorMaterialInfo', 'GET', '/api/om/vendor-material-info?${params.toString()}', TRUE, 'LOW'),
    ('PROC_PO_CREATE', 'frontend/src/pages/dashboard/procurement/po/POCreatePage.jsx', 'PROC_PAYMENT_TERMS_MASTER', 'VIEW', 'listPaymentTerms', 'GET', '/api/procurement/payment-terms', TRUE, 'LOW'),
    ('PROC_PO_CREATE', 'frontend/src/pages/dashboard/procurement/po/POCreatePage.jsx', 'PROC_PO_LIST', 'VIEW', 'getPoFilterOptions', 'GET', '/api/procurement/po-filter-options', TRUE, 'LOW'),
    ('PROC_PO_CREATE', 'frontend/src/pages/dashboard/procurement/po/POCreatePage.jsx', 'PROC_PORT_MASTER', 'VIEW', 'listPorts', 'GET', '/api/procurement/ports', TRUE, 'LOW'),
    ('PROC_PO_DETAIL', 'frontend/src/pages/dashboard/procurement/po/PODetailPage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listVendors', 'GET', '/api/om/vendors?${params.toString()}', TRUE, 'LOW'),
    ('PROC_PO_DETAIL', 'frontend/src/pages/dashboard/procurement/po/PODetailPage.jsx', 'PROC_PAYMENT_TERMS_MASTER', 'VIEW', 'listPaymentTerms', 'GET', '/api/procurement/payment-terms', TRUE, 'LOW'),
    ('PROC_PO_DETAIL', 'frontend/src/pages/dashboard/procurement/po/PODetailPage.jsx', 'PROC_PO_CREATE', 'EDIT', 'updatePurchaseOrder', 'PUT', '/api/procurement/purchase-orders/${encodeURIComponent(id)}', TRUE, 'HIGH'),
    ('PROC_PO_DETAIL', 'frontend/src/pages/dashboard/procurement/po/PODetailPage.jsx', 'PROC_PO_LIST', 'VIEW', 'getPurchaseOrder', 'GET', '/api/procurement/purchase-orders/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_PO_LIST', 'frontend/src/pages/dashboard/procurement/po/POListPage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listVendors', 'GET', '/api/om/vendors?${params.toString()}', TRUE, 'LOW'),
    ('PROC_PO_ORDER_APPROVALS', 'frontend/src/pages/dashboard/procurement/po/POOrderGroupListPage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listVendors', 'GET', '/api/om/vendors?${params.toString()}', TRUE, 'LOW'),
    ('PROC_PO_ORDER_DETAIL', 'frontend/src/pages/dashboard/procurement/po/POOrderGroupDetailPage.jsx', 'PROC_PO_ORDER_APPROVALS', 'APPROVE', 'approvePOOrderGroup', 'POST', '/api/procurement/po-order-groups/${encodeURIComponent(id)}/approve', TRUE, 'HIGH'),
    ('PROC_PO_ORDER_DETAIL', 'frontend/src/pages/dashboard/procurement/po/POOrderGroupDetailPage.jsx', 'PROC_PO_ORDER_APPROVALS', 'EDIT', 'confirmPOOrderGroup', 'POST', '/api/procurement/po-order-groups/${encodeURIComponent(id)}/confirm', TRUE, 'HIGH'),
    ('PROC_PO_ORDER_DETAIL', 'frontend/src/pages/dashboard/procurement/po/POOrderGroupDetailPage.jsx', 'PROC_PO_ORDER_APPROVALS', 'VIEW', 'getPOOrderGroup', 'GET', '/api/procurement/po-order-groups/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_PO_STO_PRINT_DETAIL', 'frontend/src/pages/dashboard/procurement/print/PrintGroupDetailPage.jsx', 'PROC_PO_STO_PRINT', 'VIEW', 'lookupPrintGroup', 'GET', '/api/procurement/print-groups', TRUE, 'LOW'),
    ('PROC_PO_STO_PRINT_PREVIEW', 'frontend/src/pages/dashboard/procurement/print/PrintPreviewPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROC_PO_STO_PRINT_PREVIEW', 'frontend/src/pages/dashboard/procurement/print/PrintPreviewPage.jsx', 'PROC_PO_STO_PRINT', 'WRITE', 'createPrintLog', 'POST', '/api/procurement/print-groups/log', TRUE, 'HIGH'),
    ('PROC_PO_STO_PRINT_PREVIEW', 'frontend/src/pages/dashboard/procurement/print/PrintPreviewPage.jsx', 'PROC_PORT_MASTER', 'VIEW', 'listPorts', 'GET', '/api/procurement/ports', TRUE, 'LOW'),
    ('PROC_PORT_TRANSIT_MASTER', 'frontend/src/pages/dashboard/procurement/masters/PortTransitMasterPage.jsx', 'PROC_PORT_MASTER', 'VIEW', 'listPorts', 'GET', '/api/procurement/ports', TRUE, 'LOW'),
    ('PROC_QA_QUEUE', 'frontend/src/pages/dashboard/procurement/qa/QAQueuePage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROC_QA_QUEUE', 'frontend/src/pages/dashboard/procurement/qa/QAQueuePage.jsx', 'PROC_GRN_LIST', 'VIEW', 'listGRNs', 'GET', '/api/procurement/grns', TRUE, 'LOW'),
    ('PROC_QA_QUEUE', 'frontend/src/pages/dashboard/procurement/qa/QAQueuePage.jsx', 'PROC_PO_LIST', 'VIEW', 'getDocumentFlow', 'GET', '/api/procurement/document-flow', TRUE, 'LOW'),
    ('PROC_RTV_CREATE', 'frontend/src/pages/dashboard/procurement/rtv/RTVCreatePage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROC_RTV_CREATE', 'frontend/src/pages/dashboard/procurement/rtv/RTVCreatePage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listVendors', 'GET', '/api/om/vendors?${params.toString()}', TRUE, 'LOW'),
    ('PROC_RTV_CREATE', 'frontend/src/pages/dashboard/procurement/rtv/RTVCreatePage.jsx', 'PROC_GRN_LIST', 'VIEW', 'listGRNs', 'GET', '/api/procurement/grns', TRUE, 'LOW'),
    ('PROC_RTV_DETAIL', 'frontend/src/pages/dashboard/procurement/rtv/RTVDetailPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROC_RTV_DETAIL', 'frontend/src/pages/dashboard/procurement/rtv/RTVDetailPage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listVendors', 'GET', '/api/om/vendors?${params.toString()}', TRUE, 'LOW'),
    ('PROC_RTV_DETAIL', 'frontend/src/pages/dashboard/procurement/rtv/RTVDetailPage.jsx', 'PROC_DEBIT_NOTE_LIST', 'APPROVE', 'acknowledgeDebitNote', 'POST', '/api/procurement/debit-notes/${encodeURIComponent(id)}/acknowledge', TRUE, 'HIGH'),
    ('PROC_RTV_DETAIL', 'frontend/src/pages/dashboard/procurement/rtv/RTVDetailPage.jsx', 'PROC_DEBIT_NOTE_LIST', 'EDIT', 'markDebitNoteSent', 'POST', '/api/procurement/debit-notes/${encodeURIComponent(id)}/mark-sent', TRUE, 'HIGH'),
    ('PROC_RTV_DETAIL', 'frontend/src/pages/dashboard/procurement/rtv/RTVDetailPage.jsx', 'PROC_DEBIT_NOTE_LIST', 'WRITE', 'createDebitNote', 'POST', '/api/procurement/debit-notes', TRUE, 'HIGH'),
    ('PROC_RTV_DETAIL', 'frontend/src/pages/dashboard/procurement/rtv/RTVDetailPage.jsx', 'PROC_EXCHANGE_REF_LIST', 'WRITE', 'createExchangeRef', 'POST', '/api/procurement/exchange-refs', TRUE, 'HIGH'),
    ('PROC_RTV_DETAIL', 'frontend/src/pages/dashboard/procurement/rtv/RTVDetailPage.jsx', 'PROC_GRN_LIST', 'VIEW', 'getGRN', 'GET', '/api/procurement/grns/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_RTV_DETAIL', 'frontend/src/pages/dashboard/procurement/rtv/RTVDetailPage.jsx', 'PROC_PO_LIST', 'VIEW', 'getDocumentFlow', 'GET', '/api/procurement/document-flow', TRUE, 'LOW'),
    ('PROC_RTV_DETAIL', 'frontend/src/pages/dashboard/procurement/rtv/RTVDetailPage.jsx', 'PROC_RTV_CREATE', 'APPROVE', 'postRTV', 'POST', '/api/procurement/rtvs/${encodeURIComponent(id)}/post', TRUE, 'HIGH'),
    ('PROC_RTV_DETAIL', 'frontend/src/pages/dashboard/procurement/rtv/RTVDetailPage.jsx', 'PROC_RTV_LIST', 'VIEW', 'getRTV', 'GET', '/api/procurement/rtvs/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_RTV_LIST', 'frontend/src/pages/dashboard/procurement/rtv/RTVListPage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listVendors', 'GET', '/api/om/vendors?${params.toString()}', TRUE, 'LOW'),
    ('PROC_RTV_LIST', 'frontend/src/pages/dashboard/procurement/rtv/RTVListPage.jsx', 'PROC_GRN_LIST', 'VIEW', 'getGRN', 'GET', '/api/procurement/grns/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_SO_CREATE', 'frontend/src/pages/dashboard/procurement/sales/SOCreatePage.jsx', 'OM_CUSTOMER_CREATE', 'VIEW', 'lookupCustomerGstProfile', 'GET', '/api/om/customer/gst-profile?${params.toString()}', TRUE, 'LOW'),
    ('PROC_SO_CREATE', 'frontend/src/pages/dashboard/procurement/sales/SOCreatePage.jsx', 'OM_CUSTOMER_CREATE', 'WRITE', 'createCustomer', 'POST', '/api/om/customer', TRUE, 'HIGH'),
    ('PROC_SO_CREATE', 'frontend/src/pages/dashboard/procurement/sales/SOCreatePage.jsx', 'OM_CUSTOMER_LIST', 'VIEW', 'listParentCustomers', 'GET', '/api/om/parent-customers?${query.toString()}', TRUE, 'LOW'),
    ('PROC_SO_CREATE', 'frontend/src/pages/dashboard/procurement/sales/SOCreatePage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROC_SO_CREATE', 'frontend/src/pages/dashboard/procurement/sales/SOCreatePage.jsx', 'OM_VENDOR_LIST', 'VIEW', 'getVendor', 'GET', '/api/om/vendor?${params.toString()}', TRUE, 'LOW'),
    ('PROC_SO_CREATE', 'frontend/src/pages/dashboard/procurement/sales/SOCreatePage.jsx', 'PROC_PAYMENT_TERMS_MASTER', 'VIEW', 'listPaymentTerms', 'GET', '/api/procurement/payment-terms', TRUE, 'LOW'),
    ('PROC_SO_CREATE', 'frontend/src/pages/dashboard/procurement/sales/SOCreatePage.jsx', 'PROC_PO_LIST', 'VIEW', 'listMaterialUomConversionsForProcurement', 'GET', '/api/procurement/materials/uom-conversion', TRUE, 'LOW'),
    ('PROC_SO_DETAIL', 'frontend/src/pages/dashboard/procurement/sales/SODetailPage.jsx', 'OM_CUSTOMER_LIST', 'VIEW', 'listCustomers', 'GET', '/api/om/customers?${params.toString()}', TRUE, 'LOW'),
    ('PROC_SO_DETAIL', 'frontend/src/pages/dashboard/procurement/sales/SODetailPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROC_SO_DETAIL', 'frontend/src/pages/dashboard/procurement/sales/SODetailPage.jsx', 'PROC_INV_LIST', 'VIEW', 'listSalesInvoices', 'GET', '/api/procurement/sales-invoices', TRUE, 'LOW'),
    ('PROC_SO_DETAIL', 'frontend/src/pages/dashboard/procurement/sales/SODetailPage.jsx', 'PROC_PO_LIST', 'VIEW', 'getDocumentFlow', 'GET', '/api/procurement/document-flow', TRUE, 'LOW'),
    ('PROC_SO_DETAIL', 'frontend/src/pages/dashboard/procurement/sales/SODetailPage.jsx', 'PROC_SO_CREATE', 'EDIT', 'cancelSalesOrder', 'POST', '/api/procurement/sales-orders/${encodeURIComponent(id)}/cancel', TRUE, 'HIGH'),
    ('PROC_SO_DETAIL', 'frontend/src/pages/dashboard/procurement/sales/SODetailPage.jsx', 'PROC_SO_CREATE', 'WRITE', 'issueSOStock', 'POST', '/api/procurement/sales-orders/${encodeURIComponent(id)}/issue', TRUE, 'HIGH'),
    ('PROC_SO_DETAIL', 'frontend/src/pages/dashboard/procurement/sales/SODetailPage.jsx', 'PROC_SO_LIST', 'VIEW', 'getSalesOrder', 'GET', '/api/procurement/sales-orders/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_STO_CREATE_OPENING', 'frontend/src/pages/dashboard/procurement/sto/STOCreateOpeningPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROC_STO_CREATE_OPENING', 'frontend/src/pages/dashboard/procurement/sto/STOCreateOpeningPage.jsx', 'PROC_CSN_TRACKER', 'VIEW', 'listAvailableSubCsnsForSto', 'GET', '/api/procurement/csns/available-for-sto', TRUE, 'LOW'),
    ('PROC_STO_CREATE_OPENING', 'frontend/src/pages/dashboard/procurement/sto/STOCreateOpeningPage.jsx', 'PROC_PAYMENT_TERMS_MASTER', 'VIEW', 'listPaymentTerms', 'GET', '/api/procurement/payment-terms', TRUE, 'LOW'),
    ('PROC_STO_CREATE_OPENING', 'frontend/src/pages/dashboard/procurement/sto/STOCreateOpeningPage.jsx', 'PROC_STO_CREATE', 'VIEW', 'getLastStoPaymentTerm', 'GET', '/api/procurement/stos/last-payment-term', TRUE, 'LOW'),
    ('PROC_STO_CREATE_OPENING', 'frontend/src/pages/dashboard/procurement/sto/STOCreateOpeningPage.jsx', 'PROC_STO_CREATE', 'WRITE', 'createSTO', 'POST', '/api/procurement/stos', TRUE, 'HIGH'),
    ('PROC_STO_CREATE', 'frontend/src/pages/dashboard/procurement/sto/STOCreatePage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROC_STO_CREATE', 'frontend/src/pages/dashboard/procurement/sto/STOCreatePage.jsx', 'PROC_CSN_TRACKER', 'VIEW', 'listAvailableSubCsnsForSto', 'GET', '/api/procurement/csns/available-for-sto', TRUE, 'LOW'),
    ('PROC_STO_CREATE', 'frontend/src/pages/dashboard/procurement/sto/STOCreatePage.jsx', 'PROC_PAYMENT_TERMS_MASTER', 'VIEW', 'listPaymentTerms', 'GET', '/api/procurement/payment-terms', TRUE, 'LOW'),
    ('PROC_STO_DETAIL', 'frontend/src/pages/dashboard/procurement/sto/STODetailPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROC_STO_DETAIL', 'frontend/src/pages/dashboard/procurement/sto/STODetailPage.jsx', 'PROC_CSN_TRACKER', 'VIEW', 'listCSNs', 'GET', '/api/procurement/csns', TRUE, 'LOW'),
    ('PROC_STO_DETAIL', 'frontend/src/pages/dashboard/procurement/sto/STODetailPage.jsx', 'PROC_PAYMENT_TERMS_MASTER', 'VIEW', 'listPaymentTerms', 'GET', '/api/procurement/payment-terms', TRUE, 'LOW'),
    ('PROC_STO_DETAIL', 'frontend/src/pages/dashboard/procurement/sto/STODetailPage.jsx', 'PROC_PO_LIST', 'VIEW', 'getDocumentFlow', 'GET', '/api/procurement/document-flow', TRUE, 'LOW'),
    ('PROC_STO_DETAIL', 'frontend/src/pages/dashboard/procurement/sto/STODetailPage.jsx', 'PROC_STO_CREATE', 'APPROVE', 'approveSTO', 'POST', '/api/procurement/stos/${encodeURIComponent(id)}/approve', TRUE, 'HIGH'),
    ('PROC_STO_DETAIL', 'frontend/src/pages/dashboard/procurement/sto/STODetailPage.jsx', 'PROC_STO_CREATE', 'EDIT', 'updateSTO', 'PUT', '/api/procurement/stos/${encodeURIComponent(id)}', TRUE, 'HIGH'),
    ('PROC_STO_DETAIL', 'frontend/src/pages/dashboard/procurement/sto/STODetailPage.jsx', 'PROC_STO_CREATE', 'WRITE', 'confirmSTO', 'POST', '/api/procurement/stos/${encodeURIComponent(id)}/confirm', TRUE, 'HIGH'),
    ('PROC_STO_DETAIL', 'frontend/src/pages/dashboard/procurement/sto/STODetailPage.jsx', 'PROC_STO_LIST', 'VIEW', 'getSTO', 'GET', '/api/procurement/stos/${encodeURIComponent(id)}', TRUE, 'LOW'),
    ('PROC_STOCK_LEDGER', 'frontend/src/pages/dashboard/procurement/reports/StockLedgerReportPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROD_BATCH_VARIANCE', 'frontend/src/pages/dashboard/production/BatchVariancePage.jsx', 'PROD_ORDER_LIST', 'VIEW', 'listProcessOrders', 'GET', '/api/production/process-orders', TRUE, 'LOW'),
    ('PROD_CHANGE_BOM_ITEM_APPROVAL', 'frontend/src/pages/dashboard/production/ChangeBomItemApprovalPage.jsx', 'OM_MATERIAL_CREATE', 'WRITE', 'createMaterialCategoryGroup', 'POST', '/api/om/material/category-group', FALSE, 'MEDIUM'),
    ('PROD_CHANGE_BOM_ITEM_APPROVAL', 'frontend/src/pages/dashboard/production/ChangeBomItemApprovalPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROD_CHANGE_BOM_ITEM', 'frontend/src/pages/dashboard/production/ChangeBomItemPage.jsx', 'OM_MATERIAL_CREATE', 'WRITE', 'createMaterialCategoryGroup', 'POST', '/api/om/material/category-group', FALSE, 'MEDIUM'),
    ('PROD_CHANGE_BOM_ITEM', 'frontend/src/pages/dashboard/production/ChangeBomItemPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROD_CHANGE_BOM_ITEM', 'frontend/src/pages/dashboard/production/ChangeBomItemPage.jsx', 'PROD_STROKE_MASTER', 'VIEW', 'listStrokeMasters', 'GET', '/api/production/stroke-masters', TRUE, 'LOW'),
    ('PROD_CHANGE_PACK_BOM_APPROVAL', 'frontend/src/pages/dashboard/production/ChangePackBomApprovalPage.jsx', 'OM_MATERIAL_CREATE', 'EDIT', 'updateMaterial', 'PATCH', '/api/om/material', FALSE, 'MEDIUM'),
    ('PROD_CHANGE_PACK_BOM_APPROVAL', 'frontend/src/pages/dashboard/production/ChangePackBomApprovalPage.jsx', 'OM_MATERIAL_CREATE', 'WRITE', 'createMaterialCategoryGroup', 'POST', '/api/om/material/category-group', FALSE, 'MEDIUM'),
    ('PROD_CHANGE_PACK_BOM_APPROVAL', 'frontend/src/pages/dashboard/production/ChangePackBomApprovalPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROD_CHANGE_PACK_BOM', 'frontend/src/pages/dashboard/production/ChangePackBomPage.jsx', 'OM_MATERIAL_CREATE', 'EDIT', 'updateMaterial', 'PATCH', '/api/om/material', FALSE, 'MEDIUM'),
    ('PROD_CHANGE_PACK_BOM', 'frontend/src/pages/dashboard/production/ChangePackBomPage.jsx', 'OM_MATERIAL_CREATE', 'WRITE', 'createMaterialCategoryGroup', 'POST', '/api/om/material/category-group', FALSE, 'MEDIUM'),
    ('PROD_CHANGE_PACK_BOM', 'frontend/src/pages/dashboard/production/ChangePackBomPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROD_CHANGE_PACK_BOM', 'frontend/src/pages/dashboard/production/ChangePackBomPage.jsx', 'PROD_PACK_BOM_CREATE', 'VIEW', 'listPackBoms', 'GET', '/api/production/pack-boms', TRUE, 'LOW'),
    ('PROD_FG_STOCK_BREAKDOWN', 'frontend/src/pages/dashboard/production/FgStockBreakdownPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROD_OLD_PACKING_PO', 'frontend/src/pages/dashboard/production/OldPackingPoPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROD_OLD_PACKING_PO', 'frontend/src/pages/dashboard/production/OldPackingPoPage.jsx', 'PROD_PACK_BOM_CREATE', 'VIEW', 'listPackBoms', 'GET', '/api/production/pack-boms', TRUE, 'LOW'),
    ('PROD_OLD_PACKING_PO', 'frontend/src/pages/dashboard/production/OldPackingPoPage.jsx', 'PROD_PO_CREATE', 'VIEW', 'listPackCodes', 'GET', '/api/production/pack-codes', TRUE, 'LOW'),
    ('PROD_OLD_PROCESS_PO', 'frontend/src/pages/dashboard/production/OldProcessPoPage.jsx', 'PROD_STROKE_MASTER', 'VIEW', 'listStrokeMasters', 'GET', '/api/production/stroke-masters', TRUE, 'LOW'),
    ('PROD_ORDER_LIST', 'frontend/src/pages/dashboard/production/OrderListPage.jsx', 'PROD_PO_VERIFY', 'APPROVE', 'completeIntProcessOrder', 'POST', '/api/production/process-orders/${id}/complete-int', TRUE, 'HIGH'),
    ('PROD_PACK_BOM_APPROVAL', 'frontend/src/pages/dashboard/production/PackBomApprovalPage.jsx', 'OM_MATERIAL_CREATE', 'EDIT', 'updateMaterial', 'PATCH', '/api/om/material', FALSE, 'MEDIUM'),
    ('PROD_PACK_BOM_APPROVAL', 'frontend/src/pages/dashboard/production/PackBomApprovalPage.jsx', 'OM_MATERIAL_CREATE', 'WRITE', 'createMaterialCategoryGroup', 'POST', '/api/om/material/category-group', FALSE, 'MEDIUM'),
    ('PROD_PACK_BOM_APPROVAL', 'frontend/src/pages/dashboard/production/PackBomApprovalPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROD_PACK_BOM_APPROVAL', 'frontend/src/pages/dashboard/production/PackBomApprovalPage.jsx', 'PROD_PACK_BOM_CREATE', 'VIEW', 'listPackBoms', 'GET', '/api/production/pack-boms', TRUE, 'LOW'),
    ('PROD_PACK_BOM_CREATE', 'frontend/src/pages/dashboard/production/PackBomCreatePage.jsx', 'OM_MATERIAL_CREATE', 'EDIT', 'updateMaterial', 'PATCH', '/api/om/material', FALSE, 'MEDIUM'),
    ('PROD_PACK_BOM_CREATE', 'frontend/src/pages/dashboard/production/PackBomCreatePage.jsx', 'OM_MATERIAL_CREATE', 'WRITE', 'createMaterialCategoryGroup', 'POST', '/api/om/material/category-group', FALSE, 'MEDIUM'),
    ('PROD_PACK_BOM_CREATE', 'frontend/src/pages/dashboard/production/PackBomCreatePage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROD_PLAN_FEED', 'frontend/src/pages/dashboard/production/PlanFeedPage.jsx', 'OM_CUSTOMER_CREATE', 'EDIT', 'updateCustomer', 'PATCH', '/api/om/customer', TRUE, 'HIGH'),
    ('PROD_PLAN_FEED', 'frontend/src/pages/dashboard/production/PlanFeedPage.jsx', 'OM_CUSTOMER_CREATE', 'WRITE', 'createCustomer', 'POST', '/api/om/customer', TRUE, 'HIGH'),
    ('PROD_PLAN_FEED', 'frontend/src/pages/dashboard/production/PlanFeedPage.jsx', 'OM_CUSTOMER_LIST', 'VIEW', 'listCustomers', 'GET', '/api/om/customers?${params.toString()}', TRUE, 'LOW'),
    ('PROD_PLAN_FEED', 'frontend/src/pages/dashboard/production/PlanFeedPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROD_PLAN_FEED', 'frontend/src/pages/dashboard/production/PlanFeedPage.jsx', 'PROD_ORDER_LIST', 'VIEW', 'listPackingOrders', 'GET', '/api/production/packing-orders', TRUE, 'LOW'),
    ('PROD_PO_CREATE', 'frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx', 'OM_MATERIAL_CREATE', 'WRITE', 'createMaterialCategoryGroup', 'POST', '/api/om/material/category-group', FALSE, 'MEDIUM'),
    ('PROD_PO_CREATE', 'frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROD_PO_CREATE', 'frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx', 'PROD_ORDER_LIST', 'VIEW', 'availabilityPreviewProcessOrder', 'GET', '/api/production/process-orders/availability-preview', TRUE, 'LOW'),
    ('PROD_PO_CREATE', 'frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx', 'PROD_PACK_BOM_CREATE', 'VIEW', 'listPackBoms', 'GET', '/api/production/pack-boms', TRUE, 'LOW'),
    ('PROD_PO_CREATE', 'frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx', 'PROD_STROKE_MASTER', 'VIEW', 'listStrokeMasters', 'GET', '/api/production/stroke-masters', TRUE, 'LOW'),
    ('PROD_PO_CREATE', 'frontend/src/pages/dashboard/production/ProductionPOCreatePage.jsx', 'SA_PROD_SEGMENT_LOCATIONS', 'VIEW', 'listSegmentLocations', 'GET', '/api/production/segment-locations', TRUE, 'LOW'),
    ('PROD_PO_EDIT', 'frontend/src/pages/dashboard/production/ProductionPOEditPage.jsx', 'PROD_ORDER_LIST', 'VIEW', 'listProcessOrders', 'GET', '/api/production/process-orders', TRUE, 'LOW'),
    ('PROD_PO_FINAL', 'frontend/src/pages/dashboard/production/ProductionPOFinalPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROD_PO_FINAL', 'frontend/src/pages/dashboard/production/ProductionPOFinalPage.jsx', 'PROD_ORDER_LIST', 'VIEW', 'listProcessOrders', 'GET', '/api/production/process-orders', TRUE, 'LOW'),
    ('PROD_PO_FINAL', 'frontend/src/pages/dashboard/production/ProductionPOFinalPage.jsx', 'PROD_PACKING_PO_FINAL', 'WRITE', 'correctPackingOrder', 'POST', '/api/production/packing-orders/${id}/correct', FALSE, 'MEDIUM'),
    ('PROD_PO_VERIFY', 'frontend/src/pages/dashboard/production/ProductionPOVerifyPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROD_PO_VERIFY', 'frontend/src/pages/dashboard/production/ProductionPOVerifyPage.jsx', 'PROD_ORDER_LIST', 'VIEW', 'listProcessOrders', 'GET', '/api/production/process-orders', TRUE, 'LOW'),
    ('PROD_QA_QUEUE', 'frontend/src/pages/dashboard/production/QAQueuePage.jsx', 'PROD_BATCH_RELEASE', 'VIEW', 'listBatchNumbers', 'GET', '/api/production/batch-numbers', TRUE, 'LOW'),
    ('PROD_QA_QUEUE', 'frontend/src/pages/dashboard/production/QAQueuePage.jsx', 'PROD_ORDER_LIST', 'VIEW', 'listProcessOrders', 'GET', '/api/production/process-orders', TRUE, 'LOW'),
    ('PROD_QA_QUEUE', 'frontend/src/pages/dashboard/production/QAQueuePage.jsx', 'PROD_START_BATCH', 'WRITE', 'startBatch', 'POST', '/api/production/process-orders/${id}/start-batch', FALSE, 'MEDIUM'),
    ('PROD_REVERSAL', 'frontend/src/pages/dashboard/production/ReversalPage.jsx', 'PROD_ORDER_LIST', 'VIEW', 'listProcessOrders', 'GET', '/api/production/process-orders', TRUE, 'LOW'),
    ('PROD_SFG_RESULT_RECORDING', 'frontend/src/pages/dashboard/production/SfgResultRecordingPage.jsx', 'PROC_QA_QUEUE', 'DELETE', 'deleteQaCategoryTestConfig', 'DELETE', '/api/procurement/qa-category-test-config/${encodeURIComponent(id)}', TRUE, 'HIGH'),
    ('PROD_SFG_RESULT_RECORDING', 'frontend/src/pages/dashboard/production/SfgResultRecordingPage.jsx', 'PROC_QA_QUEUE', 'EDIT', 'updateQaCategoryTestConfig', 'PATCH', '/api/procurement/qa-category-test-config/${encodeURIComponent(id)}', TRUE, 'HIGH'),
    ('PROD_SFG_RESULT_RECORDING', 'frontend/src/pages/dashboard/production/SfgResultRecordingPage.jsx', 'PROC_QA_QUEUE', 'VIEW', 'listQaTestMethods', 'GET', '/api/procurement/qa-test-methods', TRUE, 'LOW'),
    ('PROD_SFG_RESULT_RECORDING', 'frontend/src/pages/dashboard/production/SfgResultRecordingPage.jsx', 'PROC_QA_QUEUE', 'WRITE', 'createQaTestMethod', 'POST', '/api/procurement/qa-test-methods', TRUE, 'HIGH'),
    ('PROD_STROKE_APPROVAL', 'frontend/src/pages/dashboard/production/StrokeApprovalPage.jsx', 'OM_MATERIAL_CREATE', 'WRITE', 'createMaterialCategoryGroup', 'POST', '/api/om/material/category-group', FALSE, 'MEDIUM'),
    ('PROD_STROKE_APPROVAL', 'frontend/src/pages/dashboard/production/StrokeApprovalPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROD_STROKE_APPROVAL', 'frontend/src/pages/dashboard/production/StrokeApprovalPage.jsx', 'PROD_STROKE_MASTER', 'EDIT', 'updateStrokeMaster', 'PATCH', '/api/production/stroke-masters/${id}', TRUE, 'HIGH'),
    ('PROD_STROKE_APPROVAL', 'frontend/src/pages/dashboard/production/StrokeApprovalPage.jsx', 'PROD_STROKE_MASTER', 'VIEW', 'listStrokeMasters', 'GET', '/api/production/stroke-masters', TRUE, 'LOW'),
    ('PROD_STROKE_MASTER', 'frontend/src/pages/dashboard/production/StrokeMasterPage.jsx', 'OM_MATERIAL_CREATE', 'WRITE', 'createMaterialCategoryGroup', 'POST', '/api/om/material/category-group', FALSE, 'MEDIUM'),
    ('PROD_STROKE_MASTER', 'frontend/src/pages/dashboard/production/StrokeMasterPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('PROD_STROKE_MASTER', 'frontend/src/pages/dashboard/production/StrokeMasterPage.jsx', 'PROD_STROKE_APPROVAL', 'APPROVE', 'approveStrokeMaster', 'POST', '/api/production/stroke-masters/${id}/approve', TRUE, 'HIGH'),
    ('SA_MATERIAL_MASTER', 'frontend/src/admin/sa/screens/SAMaterialMaster.jsx', 'OM_MATERIAL_CREATE', 'EDIT', 'changeMaterialStatus', 'POST', '/api/om/material/status', FALSE, 'MEDIUM'),
    ('SA_MATERIAL_MASTER', 'frontend/src/admin/sa/screens/SAMaterialMaster.jsx', 'OM_MATERIAL_CREATE', 'VIEW', 'listCompanyMapping', 'GET', '/api/om/material/company-mapping?${params.toString()}', FALSE, 'LOW'),
    ('SA_MATERIAL_MASTER', 'frontend/src/admin/sa/screens/SAMaterialMaster.jsx', 'OM_MATERIAL_CREATE', 'WRITE', 'bulkSaveMaterials', 'POST', '/api/om/materials/bulk-save', FALSE, 'MEDIUM'),
    ('SA_MATERIAL_MASTER', 'frontend/src/admin/sa/screens/SAMaterialMaster.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('SA_OM_PACK_CODE_MASTER', 'frontend/src/admin/sa/screens/SAPackCodeMasterPage.jsx', 'PROD_PO_CREATE', 'VIEW', 'listPackCodes', 'GET', '/api/production/pack-codes', TRUE, 'LOW'),
    ('SA_PROD_BATCH_SERIES', 'frontend/src/admin/sa/screens/SAProductionBatchSeriesPage.jsx', 'OM_MATERIAL_LIST', 'VIEW', 'listMaterials', 'GET', '/api/om/materials?${params.toString()}', TRUE, 'LOW'),
    ('SA_VENDOR_MASTER', 'frontend/src/admin/sa/screens/SAVendorMaster.jsx', 'OM_VENDOR_CREATE', 'EDIT', 'updateVendor', 'PATCH', '/api/om/vendor', FALSE, 'MEDIUM'),
    ('SA_VENDOR_MASTER', 'frontend/src/admin/sa/screens/SAVendorMaster.jsx', 'OM_VENDOR_CREATE', 'WRITE', 'createVendor', 'POST', '/api/om/vendor', FALSE, 'MEDIUM'),
    ('SA_VENDOR_MASTER', 'frontend/src/admin/sa/screens/SAVendorMaster.jsx', 'OM_VENDOR_LIST', 'VIEW', 'listVendors', 'GET', '/api/om/vendors?${params.toString()}', TRUE, 'LOW')
),
active_versions AS (
  SELECT av.acl_version_id, av.company_id
  FROM acl.acl_versions av
  JOIN target_companies tc ON tc.company_id = av.company_id
  WHERE av.is_active = TRUE
),
active_acl AS (
  SELECT
    pav.acl_version_id,
    pav.company_id,
    tc.company_code,
    pav.work_context_id,
    wc.work_context_name,
    pav.resource_code,
    pav.action_code,
    pav.decision,
    pav.menu_visible
  FROM acl.precomputed_acl_view pav
  JOIN active_versions av
    ON av.acl_version_id = pav.acl_version_id
   AND av.company_id = pav.company_id
  JOIN target_companies tc
    ON tc.company_id = pav.company_id
  JOIN erp_acl.work_contexts wc
    ON wc.work_context_id = pav.work_context_id
),
owning_allow AS (
  SELECT DISTINCT
    aa.acl_version_id,
    aa.company_id,
    aa.company_code,
    aa.work_context_id,
    aa.work_context_name,
    dm.owning_resource_code,
    dm.owning_page
  FROM active_acl aa
  JOIN dependency_map dm
    ON dm.owning_resource_code = aa.resource_code
  LEFT JOIN excluded_work_contexts ewc
    ON ewc.work_context_name = aa.work_context_name
  WHERE aa.action_code = 'VIEW'
    AND aa.decision = 'ALLOW'
    AND aa.menu_visible = TRUE
    AND ewc.work_context_name IS NULL
),
gaps AS (
  SELECT
    oa.acl_version_id,
    oa.company_id,
    oa.company_code,
    oa.work_context_id,
    oa.work_context_name,
    dm.owning_resource_code,
    dm.owning_page,
    dm.dependency_resource_code,
    dm.dependency_action,
    dm.dependency_fn,
    dm.risk_flag
  FROM owning_allow oa
  JOIN dependency_map dm
    ON dm.owning_resource_code = oa.owning_resource_code
  WHERE NOT EXISTS (
    SELECT 1
    FROM active_acl dep
    WHERE dep.company_id = oa.company_id
      AND dep.work_context_id = oa.work_context_id
      AND dep.resource_code = dm.dependency_resource_code
      AND dep.action_code = dm.dependency_action
      AND dep.decision = 'ALLOW'
  )
),
low_medium_gaps AS (
  SELECT *
  FROM gaps
  WHERE risk_flag IN ('LOW', 'MEDIUM')
),
acl_menu_resource_map AS (
  SELECT
    amm.id AS menu_id,
    COALESCE(emr.resource_code, emc.resource_code, amm.menu_code) AS resource_code
  FROM acl.menu_master amm
  LEFT JOIN erp_menu.menu_master emr
    ON emr.resource_code = amm.menu_code
  LEFT JOIN erp_menu.menu_master emc
    ON emc.menu_code = amm.menu_code
),
source_capabilities AS (
  SELECT DISTINCT
    lmg.acl_version_id,
    lmg.company_id,
    lmg.company_code,
    lmg.work_context_id,
    lmg.work_context_name,
    lmg.owning_resource_code,
    vwcc.capability_code
  FROM low_medium_gaps lmg
  JOIN acl.version_work_context_capabilities vwcc
    ON vwcc.acl_version_id = lmg.acl_version_id
   AND vwcc.work_context_id = lmg.work_context_id
  JOIN acl.version_capability_menu_actions vcma
    ON vcma.acl_version_id = lmg.acl_version_id
   AND vcma.capability_code = vwcc.capability_code
   AND vcma.allowed = TRUE
   AND vcma.menu_visible = TRUE
   AND vcma.action = 'VIEW'
  JOIN acl_menu_resource_map arm
    ON arm.menu_id = vcma.menu_id
   AND arm.resource_code = lmg.owning_resource_code
),
source_capability_choice AS (
  SELECT
    sc.*,
    COUNT(*) OVER (
      PARTITION BY sc.company_id, sc.work_context_id, sc.owning_resource_code
    ) AS source_capability_count,
    ROW_NUMBER() OVER (
      PARTITION BY sc.company_id, sc.work_context_id, sc.owning_resource_code
      ORDER BY sc.capability_code
    ) AS rn
  FROM source_capabilities sc
),
source_roles AS (
  SELECT
    scc.acl_version_id,
    scc.company_id,
    scc.company_code,
    scc.work_context_id,
    scc.work_context_name,
    scc.owning_resource_code,
    scc.capability_code AS source_capability_code,
    scc.source_capability_count,
    ARRAY_AGG(DISTINCT vrc.role_code ORDER BY vrc.role_code) AS role_codes
  FROM source_capability_choice scc
  JOIN acl.version_role_capabilities vrc
    ON vrc.acl_version_id = scc.acl_version_id
   AND vrc.capability_code = scc.capability_code
  WHERE scc.rn = 1
  GROUP BY
    scc.acl_version_id,
    scc.company_id,
    scc.company_code,
    scc.work_context_id,
    scc.work_context_name,
    scc.owning_resource_code,
    scc.capability_code,
    scc.source_capability_count
),
grouped_suggestions AS (
  SELECT
    lmg.acl_version_id,
    lmg.company_id,
    lmg.company_code,
    lmg.work_context_id,
    lmg.work_context_name,
    lmg.owning_resource_code,
    sr.source_capability_code,
    sr.source_capability_count,
    sr.role_codes,
    ARRAY_AGG(
      DISTINCT (lmg.dependency_resource_code || ':' || lmg.dependency_action)
      ORDER BY (lmg.dependency_resource_code || ':' || lmg.dependency_action)
    ) AS dependency_pairs
  FROM low_medium_gaps lmg
  LEFT JOIN source_roles sr
    ON sr.acl_version_id = lmg.acl_version_id
   AND sr.company_id = lmg.company_id
   AND sr.work_context_id = lmg.work_context_id
   AND sr.owning_resource_code = lmg.owning_resource_code
  GROUP BY
    lmg.acl_version_id,
    lmg.company_id,
    lmg.company_code,
    lmg.work_context_id,
    lmg.work_context_name,
    lmg.owning_resource_code,
    sr.source_capability_code,
    sr.source_capability_count,
    sr.role_codes
)
SELECT
  company_code,
  work_context_name,
  owning_resource_code,
  source_capability_code,
  dependency_pairs,
  CASE
    WHEN source_capability_code IS NULL THEN
      '-- MANUAL: could not identify a visible owning capability for '
      || work_context_name || ' / ' || owning_resource_code
      || '. Pick the source capability manually, then clone its role list.'
    WHEN source_capability_count <> 1 THEN
      '-- MANUAL: ambiguous source capability for '
      || work_context_name || ' / ' || owning_resource_code
      || ' (found ' || source_capability_count || '). Review before generating dependency capability.'
    ELSE
      '-- Suggested dependency capability for ' || company_code || ' / ' || work_context_name || E'\n'
      || '-- Source capability: ' || source_capability_code || E'\n'
      || '-- Suggested capability code: ' || source_capability_code || '_DEPENDENCY' || E'\n'
      || '-- Role list copied from source capability: '
      || array_to_string(role_codes, ', ') || E'\n'
      || '-- Review before running; this is a printed helper, not auto-apply.' || E'\n'
      || 'BEGIN;' || E'\n'
      || 'INSERT INTO acl.capabilities (capability_code, capability_name, description, is_system) VALUES (' || E'\n'
      || '  ' || quote_literal(source_capability_code || '_DEPENDENCY') || ',' || E'\n'
      || '  ' || quote_literal(source_capability_code || ' Dependency') || ',' || E'\n'
      || '  ' || quote_literal('Suggested hidden dependency companion for ' || work_context_name || ' on ' || owning_resource_code) || ',' || E'\n'
      || '  FALSE' || E'\n'
      || ') ON CONFLICT (capability_code) DO NOTHING;' || E'\n'
      || E'\n'
      || 'INSERT INTO acl.role_capabilities (role_code, capability_code)' || E'\n'
      || 'SELECT rc.role_code, ' || quote_literal(source_capability_code || '_DEPENDENCY') || E'\n'
      || 'FROM acl.role_capabilities rc' || E'\n'
      || 'WHERE rc.capability_code = ' || quote_literal(source_capability_code) || E'\n'
      || 'ON CONFLICT DO NOTHING;' || E'\n'
      || E'\n'
      || 'INSERT INTO acl.work_context_capabilities (work_context_id, capability_code) VALUES (' || E'\n'
      || '  ' || quote_literal(work_context_id::text) || '::uuid,' || E'\n'
      || '  ' || quote_literal(source_capability_code || '_DEPENDENCY') || E'\n'
      || ') ON CONFLICT DO NOTHING;' || E'\n'
      || E'\n'
      || 'INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed, menu_visible)' || E'\n'
      || 'SELECT ' || quote_literal(source_capability_code || '_DEPENDENCY') || ', mm.id, dep.action_code, TRUE, FALSE' || E'\n'
      || 'FROM (VALUES' || E'\n'
      || (
        SELECT string_agg(
          '  (' || quote_literal(split_part(dep_pair, ':', 1)) || ', ' || quote_literal(split_part(dep_pair, ':', 2)) || ')',
          ',' || E'\n'
          ORDER BY dep_pair
        )
        FROM unnest(dependency_pairs) AS dep_pair
      ) || E'\n'
      || ') AS dep(resource_code, action_code)' || E'\n'
      || 'JOIN acl.menu_master mm ON mm.menu_code = dep.resource_code' || E'\n'
      || 'ON CONFLICT DO NOTHING;' || E'\n'
      || E'\n'
      || 'INSERT INTO acl.version_role_capabilities (acl_version_id, role_code, capability_code)' || E'\n'
      || 'SELECT ' || quote_literal(acl_version_id::text) || '::uuid, rc.role_code, ' || quote_literal(source_capability_code || '_DEPENDENCY') || E'\n'
      || 'FROM acl.role_capabilities rc' || E'\n'
      || 'WHERE rc.capability_code = ' || quote_literal(source_capability_code) || E'\n'
      || 'ON CONFLICT DO NOTHING;' || E'\n'
      || E'\n'
      || 'INSERT INTO acl.version_work_context_capabilities (acl_version_id, work_context_id, capability_code) VALUES (' || E'\n'
      || '  ' || quote_literal(acl_version_id::text) || '::uuid,' || E'\n'
      || '  ' || quote_literal(work_context_id::text) || '::uuid,' || E'\n'
      || '  ' || quote_literal(source_capability_code || '_DEPENDENCY') || E'\n'
      || ') ON CONFLICT DO NOTHING;' || E'\n'
      || E'\n'
      || 'INSERT INTO acl.version_capability_menu_actions (acl_version_id, capability_code, menu_id, action, allowed, menu_visible)' || E'\n'
      || 'SELECT ' || quote_literal(acl_version_id::text) || '::uuid, ' || quote_literal(source_capability_code || '_DEPENDENCY') || ', mm.id, dep.action_code, TRUE, FALSE' || E'\n'
      || 'FROM (VALUES' || E'\n'
      || (
        SELECT string_agg(
          '  (' || quote_literal(split_part(dep_pair, ':', 1)) || ', ' || quote_literal(split_part(dep_pair, ':', 2)) || ')',
          ',' || E'\n'
          ORDER BY dep_pair
        )
        FROM unnest(dependency_pairs) AS dep_pair
      ) || E'\n'
      || ') AS dep(resource_code, action_code)' || E'\n'
      || 'JOIN acl.menu_master mm ON mm.menu_code = dep.resource_code' || E'\n'
      || 'ON CONFLICT DO NOTHING;' || E'\n'
      || 'COMMIT;'
  END AS suggested_sql
FROM grouped_suggestions
ORDER BY company_code, work_context_name, owning_resource_code;
