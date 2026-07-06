BEGIN;

-- Step 1a: conflicting rows NULL করো
UPDATE erp_menu.menu_master
SET tx_code = NULL
WHERE menu_code IN (
  'SA_WORK_CONTEXT_MASTER',
  'SA_CAPABILITY_GOVERNANCE',
  'SA_ROLE_PERMISSIONS',
  'SA_APPROVAL_RULES',
  'SA_APPROVAL_POLICY',
  'SA_REPORT_VISIBILITY',
  'SA_COMPANY_MODULE_MAP',
  'SA_ACL_VERSION_CENTER',
  'SA_OPENING_STOCK_LIST'
);

-- Step 1b: নতুন SC prefix দাও
UPDATE erp_menu.menu_master SET tx_code = 'SC01' WHERE menu_code = 'SA_WORK_CONTEXT_MASTER';
UPDATE erp_menu.menu_master SET tx_code = 'SC02' WHERE menu_code = 'SA_CAPABILITY_GOVERNANCE';
UPDATE erp_menu.menu_master SET tx_code = 'SC03' WHERE menu_code = 'SA_ROLE_PERMISSIONS';
UPDATE erp_menu.menu_master SET tx_code = 'SC04' WHERE menu_code = 'SA_APPROVAL_RULES';
UPDATE erp_menu.menu_master SET tx_code = 'SC05' WHERE menu_code = 'SA_APPROVAL_POLICY';
UPDATE erp_menu.menu_master SET tx_code = 'SC06' WHERE menu_code = 'SA_REPORT_VISIBILITY';
UPDATE erp_menu.menu_master SET tx_code = 'SC07' WHERE menu_code = 'SA_COMPANY_MODULE_MAP';
UPDATE erp_menu.menu_master SET tx_code = 'SC08' WHERE menu_code = 'SA_ACL_VERSION_CENTER';
UPDATE erp_menu.menu_master SET tx_code = 'OS01' WHERE menu_code = 'SA_OPENING_STOCK_LIST';

-- Group 1: OM Masters
UPDATE erp_menu.menu_master SET tx_code = 'MM01' WHERE menu_code = 'OM_MATERIAL_LIST';
UPDATE erp_menu.menu_master SET tx_code = 'MM02' WHERE menu_code = 'OM_VENDOR_LIST';
UPDATE erp_menu.menu_master SET tx_code = 'MM03' WHERE menu_code = 'OM_ASL_LIST';
UPDATE erp_menu.menu_master SET tx_code = 'MM04' WHERE menu_code = 'OM_CUSTOMER_LIST';

-- Group 2: Procurement Masters
UPDATE erp_menu.menu_master SET tx_code = 'PM01' WHERE menu_code = 'PROC_PAYMENT_TERMS_MASTER';
UPDATE erp_menu.menu_master SET tx_code = 'PM02' WHERE menu_code = 'PROC_PORT_MASTER';
UPDATE erp_menu.menu_master SET tx_code = 'PM03' WHERE menu_code = 'PROC_PORT_TRANSIT_MASTER';
UPDATE erp_menu.menu_master SET tx_code = 'PM04' WHERE menu_code = 'PROC_MATERIAL_CATEGORY_MASTER';
UPDATE erp_menu.menu_master SET tx_code = 'PM05' WHERE menu_code = 'PROC_IMPORT_LEAD_TIME_MASTER';
UPDATE erp_menu.menu_master SET tx_code = 'PM06' WHERE menu_code = 'PROC_DOMESTIC_LEAD_TIME_MASTER';
UPDATE erp_menu.menu_master SET tx_code = 'PM07' WHERE menu_code = 'PROC_TRANSPORTER_MASTER';
UPDATE erp_menu.menu_master SET tx_code = 'PM08' WHERE menu_code = 'PROC_CHA_MASTER';

-- Group 3: Procurement
UPDATE erp_menu.menu_master SET tx_code = 'PO01' WHERE menu_code = 'PROC_PO_LIST';
UPDATE erp_menu.menu_master SET tx_code = 'PO02' WHERE menu_code = 'PROC_CSN_TRACKER';
UPDATE erp_menu.menu_master SET tx_code = 'PO03' WHERE menu_code = 'PROC_CSN_ALERTS';
UPDATE erp_menu.menu_master SET tx_code = 'PO04' WHERE menu_code = 'PROC_GATE_ENTRY_LIST';
UPDATE erp_menu.menu_master SET tx_code = 'PO05' WHERE menu_code = 'PROC_GRN_LIST';
UPDATE erp_menu.menu_master SET tx_code = 'PO06' WHERE menu_code = 'PROC_QA_QUEUE';
UPDATE erp_menu.menu_master SET tx_code = 'PO07' WHERE menu_code = 'PROC_STO_LIST';
UPDATE erp_menu.menu_master SET tx_code = 'PO08' WHERE menu_code = 'PROC_RTV_LIST';
UPDATE erp_menu.menu_master SET tx_code = 'PO09' WHERE menu_code = 'PROC_DEBIT_NOTE_LIST';
UPDATE erp_menu.menu_master SET tx_code = 'PO10' WHERE menu_code = 'PROC_EXCHANGE_REF_LIST';
UPDATE erp_menu.menu_master SET tx_code = 'PO11' WHERE menu_code = 'PROC_PLANNING_VIEW';
UPDATE erp_menu.menu_master SET tx_code = 'PO12' WHERE menu_code = 'PROC_PLANT_TRANSFER_LIST';

-- Group 4: Accounts
UPDATE erp_menu.menu_master SET tx_code = 'AC01' WHERE menu_code = 'PROC_IV_LIST';
UPDATE erp_menu.menu_master SET tx_code = 'AC02' WHERE menu_code = 'PROC_BLOCKED_IV_LIST';
UPDATE erp_menu.menu_master SET tx_code = 'AC03' WHERE menu_code = 'PROC_LC_LIST';

-- Group 5: Inventory
UPDATE erp_menu.menu_master SET tx_code = 'IN01' WHERE menu_code = 'PROC_PI_LIST';
UPDATE erp_menu.menu_master SET tx_code = 'IN02' WHERE menu_code = 'PROC_STOCK_LEDGER';
UPDATE erp_menu.menu_master SET tx_code = 'IN03' WHERE menu_code = 'PROC_CURRENT_STOCK';
UPDATE erp_menu.menu_master SET tx_code = 'IN04' WHERE menu_code = 'PROC_STOCK_VALUATION';

-- Group 6: Sales
UPDATE erp_menu.menu_master SET tx_code = 'SO01' WHERE menu_code = 'PROC_SO_LIST';
UPDATE erp_menu.menu_master SET tx_code = 'SO02' WHERE menu_code = 'PROC_INV_LIST';

-- Group 7: Leave
UPDATE erp_menu.menu_master SET tx_code = 'LV01' WHERE menu_code = 'HR_LEAVE_APPLY';
UPDATE erp_menu.menu_master SET tx_code = 'LV02' WHERE menu_code = 'HR_LEAVE_MY_REQUESTS';
UPDATE erp_menu.menu_master SET tx_code = 'LV03' WHERE menu_code = 'HR_LEAVE_APPROVAL_INBOX';
UPDATE erp_menu.menu_master SET tx_code = 'LV04' WHERE menu_code = 'HR_LEAVE_APPROVAL_SCOPE_HISTORY';
UPDATE erp_menu.menu_master SET tx_code = 'LV05' WHERE menu_code = 'HR_LEAVE_TYPE_MANAGE';
UPDATE erp_menu.menu_master SET tx_code = 'LV06' WHERE menu_code = 'HR_LEAVE_REGISTER';

-- Group 8: Out Work
UPDATE erp_menu.menu_master SET tx_code = 'OW01' WHERE menu_code = 'HR_OUT_WORK_APPLY';
UPDATE erp_menu.menu_master SET tx_code = 'OW02' WHERE menu_code = 'HR_OUT_WORK_MY_REQUESTS';
UPDATE erp_menu.menu_master SET tx_code = 'OW03' WHERE menu_code = 'HR_OUT_WORK_APPROVAL_INBOX';
UPDATE erp_menu.menu_master SET tx_code = 'OW04' WHERE menu_code = 'HR_OUT_WORK_APPROVAL_SCOPE_HISTORY';
UPDATE erp_menu.menu_master SET tx_code = 'OW05' WHERE menu_code = 'HR_OUT_WORK_REGISTER';

-- Group 9: Attendance
UPDATE erp_menu.menu_master SET tx_code = 'AT01' WHERE menu_code = 'HR_CALENDAR_MANAGE';
UPDATE erp_menu.menu_master SET tx_code = 'AT02' WHERE menu_code = 'HR_ATTENDANCE_CORRECTION';
UPDATE erp_menu.menu_master SET tx_code = 'AT03' WHERE menu_code = 'HR_ATTENDANCE_MONTHLY_SUMMARY';
UPDATE erp_menu.menu_master SET tx_code = 'AT04' WHERE menu_code = 'HR_ATTENDANCE_DAILY_REGISTER';
UPDATE erp_menu.menu_master SET tx_code = 'AT05' WHERE menu_code = 'HR_ATTENDANCE_YEARLY_LEAVE_SUMMARY';
UPDATE erp_menu.menu_master SET tx_code = 'AT06' WHERE menu_code = 'HR_ATTENDANCE_DEPARTMENT_REPORT';
UPDATE erp_menu.menu_master SET tx_code = 'AT07' WHERE menu_code = 'HR_ATTENDANCE_LEAVE_USAGE';
UPDATE erp_menu.menu_master SET tx_code = 'AT08' WHERE menu_code = 'HR_ATTENDANCE_CORRECTION_PENDING_LIST';
UPDATE erp_menu.menu_master SET tx_code = 'AT09' WHERE menu_code = 'HR_ATTENDANCE_CORRECTION_APPROVAL_INBOX';
UPDATE erp_menu.menu_master SET tx_code = 'AT10' WHERE menu_code = 'HR_ATTENDANCE_CORRECTION_APPROVAL_SCOPE_HISTORY';

COMMIT;
