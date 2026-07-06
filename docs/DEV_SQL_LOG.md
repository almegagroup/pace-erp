# PACE ERP — Dev SQL Operations Log

> এই file এ dev-এ MCP দিয়ে যা SQL চালানো হয়েছে সব track করা আছে।
> Prod এ same operations apply করতে হবে।
> Migration file নয় — এগুলো data operations।

---

## Format
```
### [Date] — কাজের নাম
Status: ✅ Done / 🔴 Pending
SQL: (exact SQL)
Note: (কোনো বিশেষ কথা)
```

---

## Operations

### 2026-05-26 — erp_menu.menu_master title fix (user-friendly naming)
**Status:** ✅ Done in Dev

```sql
-- Abbreviations → Full names
UPDATE erp_menu.menu_master SET title = 'Goods Receipt Notes'           WHERE resource_code = 'ACL_PR_GRN_LIST';
UPDATE erp_menu.menu_master SET title = 'Stock Transfer Orders'         WHERE resource_code = 'ACL_PR_STO_LIST';
UPDATE erp_menu.menu_master SET title = 'New Stock Transfer Order'      WHERE resource_code = 'ACL_PR_STO_CREATE';
UPDATE erp_menu.menu_master SET title = 'Return to Vendor'              WHERE resource_code = 'ACL_PR_RTV_LIST';
UPDATE erp_menu.menu_master SET title = 'New Return to Vendor'          WHERE resource_code = 'ACL_PR_RTV_CREATE';
UPDATE erp_menu.menu_master SET title = 'Blocked Invoice Verifications' WHERE resource_code = 'ACL_AC_BLOCKED_IVS';
UPDATE erp_menu.menu_master SET title = 'New Vendor-Material Link'      WHERE resource_code = 'ACL_OM_ASL_CREATE';
UPDATE erp_menu.menu_master SET title = 'Customs House Agents'          WHERE resource_code = 'ACL_PM_CHA';
UPDATE erp_menu.menu_master SET title = 'Units of Measure'              WHERE resource_code = 'SA_OM_UOM_MASTER';

-- Ambiguous titles → Contextual names
UPDATE erp_menu.menu_master SET title = 'Leave Approval History'        WHERE resource_code = 'ACL_LV_HISTORY';
UPDATE erp_menu.menu_master SET title = 'Out Work Approval History'     WHERE resource_code = 'ACL_OW_HISTORY';

-- Add context
UPDATE erp_menu.menu_master SET title = 'Quality Inspection Queue'      WHERE resource_code = 'ACL_PR_QA_QUEUE';
UPDATE erp_menu.menu_master SET title = 'Procurement Planning'          WHERE resource_code = 'ACL_PR_PLANNING';
UPDATE erp_menu.menu_master SET title = 'Monthly Attendance Summary'    WHERE resource_code = 'ACL_AT_MONTHLY';
UPDATE erp_menu.menu_master SET title = 'Annual Leave Summary'          WHERE resource_code = 'ACL_AT_YEARLY';
UPDATE erp_menu.menu_master SET title = 'Department Attendance Report'  WHERE resource_code = 'ACL_AT_DEPT_REPORT';
UPDATE erp_menu.menu_master SET title = 'Attendance Correction History' WHERE resource_code = 'ACL_AT_CORR_HISTORY';
UPDATE erp_menu.menu_master SET title = 'Operation Masters'             WHERE resource_code = 'ACL_OM_MASTERS';
UPDATE erp_menu.menu_master SET title = 'Operation Masters'             WHERE resource_code = 'GRP_SA_OM';
```

**Note:** CSN Tracker / CSN Alerts — CSN এর full form confirm হয়নি, পরে update হবে।

---

### 2026-05-26 — acl.menu_master fix (wrong entries replace)
**Status:** ✅ Done in Dev

```sql
-- পুরনো 10টা wrong entry delete (HR_LEAVE_APPLY style)
DELETE FROM acl.menu_master;

-- erp_menu থেকে সঠিক 124টা entry insert
-- Rule: acl.menu_master.menu_code = erp_menu.menu_master.resource_code
INSERT INTO acl.menu_master (menu_code, display_name, description, is_system)
SELECT resource_code, title, description, is_system
FROM erp_menu.menu_master;
```

**Result:** 124 rows inserted (64 ACL pages + 9 ACL groups + 51 SA items)

---

---

### 2026-05-26 — Projects, Modules, Module-Resource Map insert
**Status:** ✅ Done in Dev

```sql
-- Projects
INSERT INTO erp_master.projects (project_name) VALUES
  ('Supply Chain'),
  ('Human Resources');

-- Modules
WITH sc AS (SELECT id FROM erp_master.projects WHERE project_name = 'Supply Chain'),
     hr AS (SELECT id FROM erp_master.projects WHERE project_name = 'Human Resources')
INSERT INTO acl.module_registry (module_code, module_name, project_id, approval_required)
VALUES
  ('MOD_MASTER_DATA', 'Master Data',       (SELECT id FROM sc), FALSE),
  ('MOD_PURCHASE',    'Purchase',          (SELECT id FROM sc), FALSE),
  ('MOD_RECEIVING',   'Receiving',         (SELECT id FROM sc), FALSE),
  ('MOD_QA',          'Quality Assurance', (SELECT id FROM sc), FALSE),
  ('MOD_LOGISTICS',   'Logistics',         (SELECT id FROM sc), FALSE),
  ('MOD_RETURNS',     'Returns & Claims',  (SELECT id FROM sc), FALSE),
  ('MOD_PROC_SETUP',  'Procurement Setup', (SELECT id FROM sc), FALSE),
  ('MOD_INVENTORY',   'Inventory',         (SELECT id FROM sc), FALSE),
  ('MOD_SALES',       'Sales',             (SELECT id FROM sc), FALSE),
  ('MOD_ACCOUNTS',    'Accounts',          (SELECT id FROM sc), FALSE),
  ('MOD_LEAVE',       'Leave Management',  (SELECT id FROM hr), FALSE),
  ('MOD_OUT_WORK',    'Out-Work',          (SELECT id FROM hr), FALSE),
  ('MOD_ATTENDANCE',  'Attendance',        (SELECT id FROM hr), FALSE),
  ('MOD_PAYROLL',     'Payroll',           (SELECT id FROM hr), FALSE);

-- Module → Resource Map
INSERT INTO acl.module_resource_map (module_code, resource_code) VALUES
  ('MOD_MASTER_DATA', 'ACL_OM_MATERIAL_LIST'),
  ('MOD_MASTER_DATA', 'ACL_OM_MATERIAL_CREATE'),
  ('MOD_MASTER_DATA', 'ACL_OM_VENDOR_LIST'),
  ('MOD_MASTER_DATA', 'ACL_OM_VENDOR_CREATE'),
  ('MOD_MASTER_DATA', 'ACL_OM_CUSTOMER_LIST'),
  ('MOD_MASTER_DATA', 'ACL_OM_CUSTOMER_CREATE'),
  ('MOD_MASTER_DATA', 'ACL_OM_ASL_LIST'),
  ('MOD_MASTER_DATA', 'ACL_OM_ASL_CREATE'),
  ('MOD_PURCHASE', 'ACL_PR_PO_LIST'),
  ('MOD_PURCHASE', 'ACL_PR_PO_CREATE'),
  ('MOD_PURCHASE', 'ACL_PR_PLANNING'),
  ('MOD_PURCHASE', 'ACL_PR_CSN_TRACKER'),
  ('MOD_PURCHASE', 'ACL_PR_CSN_ALERTS'),
  ('MOD_RECEIVING', 'ACL_PR_GATE_LIST'),
  ('MOD_RECEIVING', 'ACL_PR_GATE_CREATE'),
  ('MOD_RECEIVING', 'ACL_PR_GRN_LIST'),
  ('MOD_QA', 'ACL_PR_QA_QUEUE'),
  ('MOD_LOGISTICS', 'ACL_PR_STO_LIST'),
  ('MOD_LOGISTICS', 'ACL_PR_STO_CREATE'),
  ('MOD_LOGISTICS', 'ACL_PR_TRANSFER'),
  ('MOD_RETURNS', 'ACL_PR_RTV_LIST'),
  ('MOD_RETURNS', 'ACL_PR_RTV_CREATE'),
  ('MOD_RETURNS', 'ACL_PR_DEBIT_NOTES'),
  ('MOD_RETURNS', 'ACL_PR_EXCHANGE_REFS'),
  ('MOD_PROC_SETUP', 'ACL_PM_PAYMENT_TERMS'),
  ('MOD_PROC_SETUP', 'ACL_PM_PORTS'),
  ('MOD_PROC_SETUP', 'ACL_PM_PORT_TRANSIT'),
  ('MOD_PROC_SETUP', 'ACL_PM_MAT_CATEGORIES'),
  ('MOD_PROC_SETUP', 'ACL_PM_IMPORT_LEAD_TIMES'),
  ('MOD_PROC_SETUP', 'ACL_PM_DOMESTIC_LEAD'),
  ('MOD_PROC_SETUP', 'ACL_PM_TRANSPORTERS'),
  ('MOD_PROC_SETUP', 'ACL_PM_CHA'),
  ('MOD_INVENTORY', 'ACL_IN_CURR_STOCK'),
  ('MOD_INVENTORY', 'ACL_IN_STOCK_LEDGER'),
  ('MOD_INVENTORY', 'ACL_IN_STOCK_VAL'),
  ('MOD_INVENTORY', 'ACL_IN_PHYS_INV'),
  ('MOD_SALES', 'ACL_SO_LIST'),
  ('MOD_SALES', 'ACL_SO_CREATE'),
  ('MOD_SALES', 'ACL_SO_INV'),
  ('MOD_ACCOUNTS', 'ACL_AC_IV_LIST'),
  ('MOD_ACCOUNTS', 'ACL_AC_IV_CREATE'),
  ('MOD_ACCOUNTS', 'ACL_AC_BLOCKED_IVS'),
  ('MOD_ACCOUNTS', 'ACL_AC_LANDED_COSTS'),
  ('MOD_LEAVE', 'ACL_LV_APPLY'),
  ('MOD_LEAVE', 'ACL_LV_MY_REQ'),
  ('MOD_LEAVE', 'ACL_LV_INBOX'),
  ('MOD_LEAVE', 'ACL_LV_HISTORY'),
  ('MOD_LEAVE', 'ACL_LV_TYPES'),
  ('MOD_LEAVE', 'ACL_LV_REGISTER'),
  ('MOD_LEAVE', 'ACL_LV_CALENDAR'),
  ('MOD_OUT_WORK', 'ACL_OW_APPLY'),
  ('MOD_OUT_WORK', 'ACL_OW_MY_REQ'),
  ('MOD_OUT_WORK', 'ACL_OW_INBOX'),
  ('MOD_OUT_WORK', 'ACL_OW_HISTORY'),
  ('MOD_OUT_WORK', 'ACL_OW_REGISTER'),
  ('MOD_ATTENDANCE', 'ACL_AT_DAILY_REG'),
  ('MOD_ATTENDANCE', 'ACL_AT_MONTHLY'),
  ('MOD_ATTENDANCE', 'ACL_AT_YEARLY'),
  ('MOD_ATTENDANCE', 'ACL_AT_DEPT_REPORT'),
  ('MOD_ATTENDANCE', 'ACL_AT_LEAVE_USAGE'),
  ('MOD_ATTENDANCE', 'ACL_AT_CORRECTION'),
  ('MOD_ATTENDANCE', 'ACL_AT_MY_CORRECTIONS'),
  ('MOD_ATTENDANCE', 'ACL_AT_CORR_INBOX'),
  ('MOD_ATTENDANCE', 'ACL_AT_CORR_HISTORY');
```

**Result:** 2 projects · 14 modules · 63 resource mappings

---

---

### 2026-05-27 — erp_menu ACL universe REBUILD (correct screen_codes)
**Status:** ✅ Done in Dev

**কেন rebuild:** আগের resource_codes (ACL_PR_PO_LIST, ACL_OM_MATERIAL_LIST) frontend screen_codes (PROC_PO_LIST, OM_MATERIAL_LIST) এর সাথে মিলছিল না। ACL chain resource_code দিয়ে match করে, তাই পুরো ACL universe rebuild করতে হয়েছে।

```sql
-- Step 1: Delete old ACL universe
DELETE FROM erp_menu.menu_master WHERE universe = 'ACL';
DELETE FROM acl.menu_master;
DELETE FROM acl.module_resource_map;

-- Step 2: Insert ACL Groups (13) + Dashboard
INSERT INTO erp_menu.menu_master (menu_code, resource_code, title, route_path, menu_type, universe, is_system, display_order) VALUES
('DASHBOARD_HOME',        'DASHBOARD_HOME',        'Dashboard',           '/dashboard', 'PAGE',  'ACL', true,   0),
('GRP_ACL_OM_MASTERS',    'GRP_ACL_OM_MASTERS',    'Operation Masters',   NULL,         'GROUP', 'ACL', true,  10),
('GRP_ACL_PROCUREMENT',   'GRP_ACL_PROCUREMENT',   'Procurement',         NULL,         'GROUP', 'ACL', true,  20),
('GRP_ACL_RECEIVING',     'GRP_ACL_RECEIVING',     'Receiving',           NULL,         'GROUP', 'ACL', true,  30),
('GRP_ACL_QA',            'GRP_ACL_QA',            'Quality Assurance',   NULL,         'GROUP', 'ACL', true,  40),
('GRP_ACL_LOGISTICS',     'GRP_ACL_LOGISTICS',     'Logistics',           NULL,         'GROUP', 'ACL', true,  50),
('GRP_ACL_RETURNS',       'GRP_ACL_RETURNS',       'Returns & Claims',    NULL,         'GROUP', 'ACL', true,  60),
('GRP_ACL_ACCOUNTS',      'GRP_ACL_ACCOUNTS',      'Accounts',            NULL,         'GROUP', 'ACL', true,  70),
('GRP_ACL_SALES',         'GRP_ACL_SALES',         'Sales',               NULL,         'GROUP', 'ACL', true,  80),
('GRP_ACL_INVENTORY',     'GRP_ACL_INVENTORY',     'Inventory',           NULL,         'GROUP', 'ACL', true,  90),
('GRP_ACL_PROC_MASTERS',  'GRP_ACL_PROC_MASTERS',  'Procurement Masters', NULL,         'GROUP', 'ACL', true, 100),
('GRP_ACL_HR_LEAVE',      'GRP_ACL_HR_LEAVE',      'Leave Management',    NULL,         'GROUP', 'ACL', true, 110),
('GRP_ACL_HR_OUT_WORK',   'GRP_ACL_HR_OUT_WORK',   'Out-Work',            NULL,         'GROUP', 'ACL', true, 120),
('GRP_ACL_HR_ATTENDANCE', 'GRP_ACL_HR_ATTENDANCE', 'Attendance',          NULL,         'GROUP', 'ACL', true, 130);

-- Step 3: Insert ACL Pages (65)
-- OM Master Data (8)
INSERT INTO erp_menu.menu_master (menu_code, resource_code, title, route_path, menu_type, universe, is_system, display_order) VALUES
('OM_MATERIAL_LIST','OM_MATERIAL_LIST','Materials','/dashboard/om/materials','PAGE','ACL',true,1),
('OM_MATERIAL_CREATE','OM_MATERIAL_CREATE','New Material','/dashboard/om/material/create','PAGE','ACL',true,2),
('OM_VENDOR_LIST','OM_VENDOR_LIST','Vendors','/dashboard/om/vendors','PAGE','ACL',true,3),
('OM_VENDOR_CREATE','OM_VENDOR_CREATE','New Vendor','/dashboard/om/vendor/create','PAGE','ACL',true,4),
('OM_ASL_LIST','OM_ASL_LIST','Vendor-Material Links','/dashboard/om/vendor-material-infos','PAGE','ACL',true,5),
('OM_ASL_CREATE','OM_ASL_CREATE','New Vendor-Material Link','/dashboard/om/vendor-material-info/create','PAGE','ACL',true,6),
('OM_CUSTOMER_LIST','OM_CUSTOMER_LIST','Customers','/dashboard/om/customers','PAGE','ACL',true,7),
('OM_CUSTOMER_CREATE','OM_CUSTOMER_CREATE','New Customer','/dashboard/om/customer/create','PAGE','ACL',true,8),
-- Procurement (5)
('PROC_PO_LIST','PROC_PO_LIST','Purchase Orders','/dashboard/procurement/purchase-orders','PAGE','ACL',true,1),
('PROC_PO_CREATE','PROC_PO_CREATE','New Purchase Order','/dashboard/procurement/purchase-orders/create','PAGE','ACL',true,2),
('PROC_CSN_TRACKER','PROC_CSN_TRACKER','CSN Tracker','/dashboard/procurement/csn-tracker','PAGE','ACL',true,3),
('PROC_CSN_ALERTS','PROC_CSN_ALERTS','CSN Alerts','/dashboard/procurement/csn-alerts','PAGE','ACL',true,4),
('PROC_PLANNING_VIEW','PROC_PLANNING_VIEW','Procurement Planning','/dashboard/procurement/planning','PAGE','ACL',true,5),
-- Receiving (3)
('PROC_GATE_ENTRY_LIST','PROC_GATE_ENTRY_LIST','Gate Entries','/dashboard/procurement/gate-entries','PAGE','ACL',true,1),
('PROC_GATE_ENTRY_CREATE','PROC_GATE_ENTRY_CREATE','New Gate Entry','/dashboard/procurement/gate-entries/create','PAGE','ACL',true,2),
('PROC_GRN_LIST','PROC_GRN_LIST','Goods Receipts','/dashboard/procurement/grns','PAGE','ACL',true,3),
-- QA (1)
('PROC_QA_QUEUE','PROC_QA_QUEUE','Quality Inspection Queue','/dashboard/procurement/qa-queue','PAGE','ACL',true,1),
-- Logistics (3)
('PROC_STO_LIST','PROC_STO_LIST','Stock Transfer Orders','/dashboard/procurement/stos','PAGE','ACL',true,1),
('PROC_STO_CREATE','PROC_STO_CREATE','New Stock Transfer Order','/dashboard/procurement/stos/create','PAGE','ACL',true,2),
('PROC_PLANT_TRANSFER_LIST','PROC_PLANT_TRANSFER_LIST','Plant Transfers','/dashboard/procurement/transfer','PAGE','ACL',true,3),
-- Returns (4)
('PROC_RTV_LIST','PROC_RTV_LIST','Return to Vendor','/dashboard/procurement/rtvs','PAGE','ACL',true,1),
('PROC_RTV_CREATE','PROC_RTV_CREATE','New Return to Vendor','/dashboard/procurement/rtvs/create','PAGE','ACL',true,2),
('PROC_DEBIT_NOTE_LIST','PROC_DEBIT_NOTE_LIST','Debit Notes','/dashboard/procurement/debit-notes','PAGE','ACL',true,3),
('PROC_EXCHANGE_REF_LIST','PROC_EXCHANGE_REF_LIST','Exchange References','/dashboard/procurement/exchange-refs','PAGE','ACL',true,4),
-- Accounts (4)
('PROC_IV_LIST','PROC_IV_LIST','Invoice Verifications','/dashboard/procurement/accounts/invoice-verifications','PAGE','ACL',true,1),
('PROC_IV_CREATE','PROC_IV_CREATE','New Invoice Verification','/dashboard/procurement/accounts/invoice-verifications/create','PAGE','ACL',true,2),
('PROC_BLOCKED_IV_LIST','PROC_BLOCKED_IV_LIST','Blocked Invoices','/dashboard/procurement/accounts/blocked-ivs','PAGE','ACL',true,3),
('PROC_LC_LIST','PROC_LC_LIST','Landed Costs','/dashboard/procurement/accounts/landed-costs','PAGE','ACL',true,4),
-- Sales (3)
('PROC_SO_LIST','PROC_SO_LIST','Sales Orders','/dashboard/procurement/sales-orders','PAGE','ACL',true,1),
('PROC_SO_CREATE','PROC_SO_CREATE','New Sales Order','/dashboard/procurement/sales-orders/create','PAGE','ACL',true,2),
('PROC_INV_LIST','PROC_INV_LIST','Sales Invoices','/dashboard/procurement/sales-invoices','PAGE','ACL',true,3),
-- Inventory (4)
('PROC_CURRENT_STOCK','PROC_CURRENT_STOCK','Current Stock','/dashboard/procurement/reports/current-stock','PAGE','ACL',true,1),
('PROC_STOCK_LEDGER','PROC_STOCK_LEDGER','Stock Ledger','/dashboard/procurement/reports/stock-ledger','PAGE','ACL',true,2),
('PROC_STOCK_VALUATION','PROC_STOCK_VALUATION','Stock Valuation','/dashboard/procurement/reports/stock-valuation','PAGE','ACL',true,3),
('PROC_PI_LIST','PROC_PI_LIST','Physical Inventory','/dashboard/procurement/physical-inventory','PAGE','ACL',true,4),
-- Procurement Masters (8)
('PROC_PAYMENT_TERMS_MASTER','PROC_PAYMENT_TERMS_MASTER','Payment Terms','/dashboard/procurement/masters/payment-terms','PAGE','ACL',true,1),
('PROC_PORT_MASTER','PROC_PORT_MASTER','Ports','/dashboard/procurement/masters/ports','PAGE','ACL',true,2),
('PROC_PORT_TRANSIT_MASTER','PROC_PORT_TRANSIT_MASTER','Port Transit Times','/dashboard/procurement/masters/port-transit','PAGE','ACL',true,3),
('PROC_MATERIAL_CATEGORY_MASTER','PROC_MATERIAL_CATEGORY_MASTER','Material Categories','/dashboard/procurement/masters/material-categories','PAGE','ACL',true,4),
('PROC_IMPORT_LEAD_TIME_MASTER','PROC_IMPORT_LEAD_TIME_MASTER','Import Lead Times','/dashboard/procurement/masters/import-lead-times','PAGE','ACL',true,5),
('PROC_DOMESTIC_LEAD_TIME_MASTER','PROC_DOMESTIC_LEAD_TIME_MASTER','Domestic Lead Times','/dashboard/procurement/masters/domestic-lead-times','PAGE','ACL',true,6),
('PROC_TRANSPORTER_MASTER','PROC_TRANSPORTER_MASTER','Transporters','/dashboard/procurement/masters/transporters','PAGE','ACL',true,7),
('PROC_CHA_MASTER','PROC_CHA_MASTER','Customs House Agents','/dashboard/procurement/masters/cha','PAGE','ACL',true,8),
-- HR Leave (6)
('HR_LEAVE_APPLY','HR_LEAVE_APPLY','Apply Leave','/dashboard/hr/leave/apply','PAGE','ACL',true,1),
('HR_LEAVE_MY_REQUESTS','HR_LEAVE_MY_REQUESTS','My Leave Requests','/dashboard/hr/leave/my-requests','PAGE','ACL',true,2),
('HR_LEAVE_APPROVAL_INBOX','HR_LEAVE_APPROVAL_INBOX','Leave Approval Inbox','/dashboard/hr/leave/approval-inbox','PAGE','ACL',true,3),
('HR_LEAVE_APPROVAL_SCOPE_HISTORY','HR_LEAVE_APPROVAL_SCOPE_HISTORY','Leave Approval History','/dashboard/hr/leave/approval-history','PAGE','ACL',true,4),
('HR_LEAVE_TYPE_MANAGE','HR_LEAVE_TYPE_MANAGE','Leave Types','/dashboard/hr/leave/types','PAGE','ACL',true,5),
('HR_LEAVE_REGISTER','HR_LEAVE_REGISTER','Leave Register','/dashboard/hr/leave/register','PAGE','ACL',true,6),
-- HR Out-Work (5)
('HR_OUT_WORK_APPLY','HR_OUT_WORK_APPLY','Apply Out-Work','/dashboard/hr/out-work/apply','PAGE','ACL',true,1),
('HR_OUT_WORK_MY_REQUESTS','HR_OUT_WORK_MY_REQUESTS','My Out-Work Requests','/dashboard/hr/out-work/my-requests','PAGE','ACL',true,2),
('HR_OUT_WORK_APPROVAL_INBOX','HR_OUT_WORK_APPROVAL_INBOX','Out-Work Approval Inbox','/dashboard/hr/out-work/approval-inbox','PAGE','ACL',true,3),
('HR_OUT_WORK_APPROVAL_SCOPE_HISTORY','HR_OUT_WORK_APPROVAL_SCOPE_HISTORY','Out-Work Approval History','/dashboard/hr/out-work/approval-history','PAGE','ACL',true,4),
('HR_OUT_WORK_REGISTER','HR_OUT_WORK_REGISTER','Out-Work Register','/dashboard/hr/out-work/register','PAGE','ACL',true,5),
-- HR Attendance (10)
('HR_ATTENDANCE_DAILY_REGISTER','HR_ATTENDANCE_DAILY_REGISTER','Daily Attendance Register','/dashboard/hr/attendance/daily-register','PAGE','ACL',true,1),
('HR_ATTENDANCE_MONTHLY_SUMMARY','HR_ATTENDANCE_MONTHLY_SUMMARY','Monthly Attendance Summary','/dashboard/hr/attendance/monthly-summary','PAGE','ACL',true,2),
('HR_ATTENDANCE_YEARLY_LEAVE_SUMMARY','HR_ATTENDANCE_YEARLY_LEAVE_SUMMARY','Annual Leave Summary','/dashboard/hr/attendance/yearly-leave-summary','PAGE','ACL',true,3),
('HR_ATTENDANCE_DEPARTMENT_REPORT','HR_ATTENDANCE_DEPARTMENT_REPORT','Department Attendance Report','/dashboard/hr/attendance/department-report','PAGE','ACL',true,4),
('HR_ATTENDANCE_LEAVE_USAGE','HR_ATTENDANCE_LEAVE_USAGE','Leave Usage Report','/dashboard/hr/attendance/leave-usage','PAGE','ACL',true,5),
('HR_ATTENDANCE_CORRECTION','HR_ATTENDANCE_CORRECTION','Attendance Correction','/dashboard/hr/attendance/correction','PAGE','ACL',true,6),
('HR_ATTENDANCE_CORRECTION_PENDING_LIST','HR_ATTENDANCE_CORRECTION_PENDING_LIST','My Correction Requests','/dashboard/hr/attendance/correction/my-requests','PAGE','ACL',true,7),
('HR_ATTENDANCE_CORRECTION_APPROVAL_INBOX','HR_ATTENDANCE_CORRECTION_APPROVAL_INBOX','Correction Approval Inbox','/dashboard/hr/attendance/correction/approval-inbox','PAGE','ACL',true,8),
('HR_ATTENDANCE_CORRECTION_APPROVAL_SCOPE_HISTORY','HR_ATTENDANCE_CORRECTION_APPROVAL_SCOPE_HISTORY','Correction Approval History','/dashboard/hr/attendance/correction/approval-history','PAGE','ACL',true,9),
('HR_CALENDAR_MANAGE','HR_CALENDAR_MANAGE','Holiday Calendar','/dashboard/hr/calendar/holidays','PAGE','ACL',true,10);

-- Step 4: menu_tree (parent-child via JOIN)
INSERT INTO erp_menu.menu_tree (parent_menu_id, child_menu_id, display_order)
SELECT p.id, c.id, c.display_order
FROM erp_menu.menu_master p JOIN erp_menu.menu_master c ON true
WHERE p.universe='ACL' AND c.universe='ACL' AND c.menu_type='PAGE'
AND (
  (p.menu_code='GRP_ACL_OM_MASTERS' AND c.menu_code IN ('OM_MATERIAL_LIST','OM_MATERIAL_CREATE','OM_VENDOR_LIST','OM_VENDOR_CREATE','OM_ASL_LIST','OM_ASL_CREATE','OM_CUSTOMER_LIST','OM_CUSTOMER_CREATE'))
  OR (p.menu_code='GRP_ACL_PROCUREMENT' AND c.menu_code IN ('PROC_PO_LIST','PROC_PO_CREATE','PROC_CSN_TRACKER','PROC_CSN_ALERTS','PROC_PLANNING_VIEW'))
  OR (p.menu_code='GRP_ACL_RECEIVING' AND c.menu_code IN ('PROC_GATE_ENTRY_LIST','PROC_GATE_ENTRY_CREATE','PROC_GRN_LIST'))
  OR (p.menu_code='GRP_ACL_QA' AND c.menu_code IN ('PROC_QA_QUEUE'))
  OR (p.menu_code='GRP_ACL_LOGISTICS' AND c.menu_code IN ('PROC_STO_LIST','PROC_STO_CREATE','PROC_PLANT_TRANSFER_LIST'))
  OR (p.menu_code='GRP_ACL_RETURNS' AND c.menu_code IN ('PROC_RTV_LIST','PROC_RTV_CREATE','PROC_DEBIT_NOTE_LIST','PROC_EXCHANGE_REF_LIST'))
  OR (p.menu_code='GRP_ACL_ACCOUNTS' AND c.menu_code IN ('PROC_IV_LIST','PROC_IV_CREATE','PROC_BLOCKED_IV_LIST','PROC_LC_LIST'))
  OR (p.menu_code='GRP_ACL_SALES' AND c.menu_code IN ('PROC_SO_LIST','PROC_SO_CREATE','PROC_INV_LIST'))
  OR (p.menu_code='GRP_ACL_INVENTORY' AND c.menu_code IN ('PROC_CURRENT_STOCK','PROC_STOCK_LEDGER','PROC_STOCK_VALUATION','PROC_PI_LIST'))
  OR (p.menu_code='GRP_ACL_PROC_MASTERS' AND c.menu_code IN ('PROC_PAYMENT_TERMS_MASTER','PROC_PORT_MASTER','PROC_PORT_TRANSIT_MASTER','PROC_MATERIAL_CATEGORY_MASTER','PROC_IMPORT_LEAD_TIME_MASTER','PROC_DOMESTIC_LEAD_TIME_MASTER','PROC_TRANSPORTER_MASTER','PROC_CHA_MASTER'))
  OR (p.menu_code='GRP_ACL_HR_LEAVE' AND c.menu_code IN ('HR_LEAVE_APPLY','HR_LEAVE_MY_REQUESTS','HR_LEAVE_APPROVAL_INBOX','HR_LEAVE_APPROVAL_SCOPE_HISTORY','HR_LEAVE_TYPE_MANAGE','HR_LEAVE_REGISTER'))
  OR (p.menu_code='GRP_ACL_HR_OUT_WORK' AND c.menu_code IN ('HR_OUT_WORK_APPLY','HR_OUT_WORK_MY_REQUESTS','HR_OUT_WORK_APPROVAL_INBOX','HR_OUT_WORK_APPROVAL_SCOPE_HISTORY','HR_OUT_WORK_REGISTER'))
  OR (p.menu_code='GRP_ACL_HR_ATTENDANCE' AND c.menu_code IN ('HR_ATTENDANCE_DAILY_REGISTER','HR_ATTENDANCE_MONTHLY_SUMMARY','HR_ATTENDANCE_YEARLY_LEAVE_SUMMARY','HR_ATTENDANCE_DEPARTMENT_REPORT','HR_ATTENDANCE_LEAVE_USAGE','HR_ATTENDANCE_CORRECTION','HR_ATTENDANCE_CORRECTION_PENDING_LIST','HR_ATTENDANCE_CORRECTION_APPROVAL_INBOX','HR_ATTENDANCE_CORRECTION_APPROVAL_SCOPE_HISTORY','HR_CALENDAR_MANAGE'))
);

-- Step 5: acl.menu_master
INSERT INTO acl.menu_master (menu_code, display_name, description, is_system)
SELECT resource_code, title, description, is_system
FROM erp_menu.menu_master WHERE universe = 'ACL';

-- Step 6: module_resource_map (see full SQL below)
```

**Result:**
- erp_menu ACL pages: 65
- erp_menu ACL groups: 13
- menu_tree ACL entries: 64
- acl.menu_master: 78
- module_resource_map: 64 mappings · 13 modules

**Note:** SA universe (51 items) — intact, not touched.
Companion screens (detail pages, register results) — not in menu, route-only.

---

---

### 2026-05-27 — OM Capability Packs insert (SAP style)
**Status:** ✅ Done in Dev

**Design philosophy:** SAP Single Role style — প্রতিটা pack এ নিজের কাজের screen + reference screen (যেগুলো না দেখলে কাজ হয় না)। Backend action guard করবে, frontend শুধু visibility।

```sql
-- Step 1: 10 capability packs
INSERT INTO acl.capabilities (capability_code, capability_name, description, is_system) VALUES
  ('CAP_OM_MASTER_DATA',  'Master Data',           'Material, Vendor, Customer, ASL management',         false),
  ('CAP_PROC_BUYER',      'Procurement / Buying',  'Purchase orders, CSN tracking, planning',            false),
  ('CAP_PROC_RECEIVING',  'Gate & Receiving',       'Gate entries and goods receipts',                    false),
  ('CAP_PROC_QA',         'Quality Assurance',      'Inbound quality inspection',                         false),
  ('CAP_PROC_LOGISTICS',  'Warehouse & Logistics',  'Stock transfers and plant transfers',                 false),
  ('CAP_PROC_RETURNS',    'Returns & Claims',       'Return to vendor, debit notes, exchange references', false),
  ('CAP_PROC_ACCOUNTS',   'Accounts Payable',       'Invoice verification and landed costs',              false),
  ('CAP_PROC_SALES',      'Sales & Dispatch',       'Sales orders and customer invoices',                 false),
  ('CAP_PROC_INVENTORY',  'Inventory & Reports',    'Stock reports and physical inventory',               false),
  ('CAP_PROC_SETUP',      'Procurement Setup',      'Procurement master data configuration',              false);

-- Step 2: Screen mappings (own screens + reference screens per pack)
INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
SELECT 'CAP_OM_MASTER_DATA', id, 'VIEW', true FROM acl.menu_master WHERE menu_code IN (
  'OM_MATERIAL_LIST','OM_MATERIAL_CREATE','OM_VENDOR_LIST','OM_VENDOR_CREATE',
  'OM_ASL_LIST','OM_ASL_CREATE','OM_CUSTOMER_LIST','OM_CUSTOMER_CREATE')
UNION ALL
SELECT 'CAP_PROC_BUYER', id, 'VIEW', true FROM acl.menu_master WHERE menu_code IN (
  'PROC_PO_LIST','PROC_PO_CREATE','PROC_CSN_TRACKER','PROC_CSN_ALERTS',
  'PROC_PLANNING_VIEW','PROC_CURRENT_STOCK')                          -- +ref: stock
UNION ALL
SELECT 'CAP_PROC_RECEIVING', id, 'VIEW', true FROM acl.menu_master WHERE menu_code IN (
  'PROC_GATE_ENTRY_LIST','PROC_GATE_ENTRY_CREATE','PROC_GRN_LIST',
  'PROC_PO_LIST')                                                     -- +ref: PO
UNION ALL
SELECT 'CAP_PROC_QA', id, 'VIEW', true FROM acl.menu_master WHERE menu_code IN (
  'PROC_QA_QUEUE','PROC_GRN_LIST')                                    -- +ref: GRN
UNION ALL
SELECT 'CAP_PROC_LOGISTICS', id, 'VIEW', true FROM acl.menu_master WHERE menu_code IN (
  'PROC_STO_LIST','PROC_STO_CREATE','PROC_PLANT_TRANSFER_LIST',
  'PROC_CURRENT_STOCK')                                               -- +ref: stock
UNION ALL
SELECT 'CAP_PROC_RETURNS', id, 'VIEW', true FROM acl.menu_master WHERE menu_code IN (
  'PROC_RTV_LIST','PROC_RTV_CREATE','PROC_DEBIT_NOTE_LIST','PROC_EXCHANGE_REF_LIST',
  'PROC_GRN_LIST','PROC_PO_LIST')                                     -- +ref: GRN, PO
UNION ALL
SELECT 'CAP_PROC_ACCOUNTS', id, 'VIEW', true FROM acl.menu_master WHERE menu_code IN (
  'PROC_IV_LIST','PROC_IV_CREATE','PROC_BLOCKED_IV_LIST','PROC_LC_LIST',
  'PROC_GRN_LIST','PROC_PO_LIST')                                     -- +ref: 3-way match
UNION ALL
SELECT 'CAP_PROC_SALES', id, 'VIEW', true FROM acl.menu_master WHERE menu_code IN (
  'PROC_SO_LIST','PROC_SO_CREATE','PROC_INV_LIST',
  'PROC_CURRENT_STOCK')                                               -- +ref: stock
UNION ALL
SELECT 'CAP_PROC_INVENTORY', id, 'VIEW', true FROM acl.menu_master WHERE menu_code IN (
  'PROC_CURRENT_STOCK','PROC_STOCK_LEDGER','PROC_STOCK_VALUATION','PROC_PI_LIST')
UNION ALL
SELECT 'CAP_PROC_SETUP', id, 'VIEW', true FROM acl.menu_master WHERE menu_code IN (
  'PROC_PAYMENT_TERMS_MASTER','PROC_PORT_MASTER','PROC_PORT_TRANSIT_MASTER',
  'PROC_MATERIAL_CATEGORY_MASTER','PROC_IMPORT_LEAD_TIME_MASTER',
  'PROC_DOMESTIC_LEAD_TIME_MASTER','PROC_TRANSPORTER_MASTER','PROC_CHA_MASTER');
```

**Result:** 10 packs · 52 screen mappings
| Pack | Screens |
|------|---------|
| CAP_OM_MASTER_DATA | 8 |
| CAP_PROC_BUYER | 6 (5+1 ref) |
| CAP_PROC_RECEIVING | 4 (3+1 ref) |
| CAP_PROC_QA | 2 (1+1 ref) |
| CAP_PROC_LOGISTICS | 4 (3+1 ref) |
| CAP_PROC_RETURNS | 6 (4+2 ref) |
| CAP_PROC_ACCOUNTS | 6 (4+2 ref) |
| CAP_PROC_SALES | 4 (3+1 ref) |
| CAP_PROC_INVENTORY | 4 |
| CAP_PROC_SETUP | 8 |

---

### 2026-05-27 — HR Capability Packs insert (SAP style)
**Status:** ✅ Done in Dev

**Design:** Self-service / Approver / Admin — তিন ধরনের function আলাদা pack এ।

```sql
-- Step 1: 8 HR capability packs
INSERT INTO acl.capabilities (capability_code, capability_name, description, is_system) VALUES
  ('CAP_HR_LEAVE_SELF',       'Leave Self-Service',       'Employee leave application and request tracking',        false),
  ('CAP_HR_LEAVE_APPROVER',   'Leave Approver',           'Leave approval inbox and approval history',              false),
  ('CAP_HR_OUT_WORK_SELF',    'Out-Work Self-Service',    'Employee out-work application and request tracking',     false),
  ('CAP_HR_OUT_WORK_APPROVER','Out-Work Approver',        'Out-work approval inbox and approval history',           false),
  ('CAP_HR_ADMIN',            'HR Administration',        'Leave types, registers, out-work register, HR calendar', false),
  ('CAP_HR_ATTENDANCE',       'Attendance Management',    'Attendance reports, registers and admin correction',     false),
  ('CAP_HR_CORR_SELF',        'Correction Self-Service',  'Employee attendance correction request and tracking',    false),
  ('CAP_HR_CORR_APPROVER',    'Correction Approver',      'Attendance correction approval inbox and history',       false);

-- Step 2: Screen mappings
INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
SELECT 'CAP_HR_LEAVE_SELF', id, 'VIEW', true FROM acl.menu_master WHERE menu_code IN (
  'HR_LEAVE_APPLY','HR_LEAVE_MY_REQUESTS')
UNION ALL
SELECT 'CAP_HR_LEAVE_APPROVER', id, 'VIEW', true FROM acl.menu_master WHERE menu_code IN (
  'HR_LEAVE_APPROVAL_INBOX','HR_LEAVE_APPROVAL_SCOPE_HISTORY')
UNION ALL
SELECT 'CAP_HR_OUT_WORK_SELF', id, 'VIEW', true FROM acl.menu_master WHERE menu_code IN (
  'HR_OUT_WORK_APPLY','HR_OUT_WORK_MY_REQUESTS')
UNION ALL
SELECT 'CAP_HR_OUT_WORK_APPROVER', id, 'VIEW', true FROM acl.menu_master WHERE menu_code IN (
  'HR_OUT_WORK_APPROVAL_INBOX','HR_OUT_WORK_APPROVAL_SCOPE_HISTORY')
UNION ALL
SELECT 'CAP_HR_ADMIN', id, 'VIEW', true FROM acl.menu_master WHERE menu_code IN (
  'HR_LEAVE_TYPE_MANAGE','HR_LEAVE_REGISTER','HR_OUT_WORK_REGISTER','HR_CALENDAR_MANAGE')
UNION ALL
SELECT 'CAP_HR_ATTENDANCE', id, 'VIEW', true FROM acl.menu_master WHERE menu_code IN (
  'HR_ATTENDANCE_DAILY_REGISTER','HR_ATTENDANCE_MONTHLY_SUMMARY',
  'HR_ATTENDANCE_YEARLY_LEAVE_SUMMARY','HR_ATTENDANCE_DEPARTMENT_REPORT',
  'HR_ATTENDANCE_LEAVE_USAGE','HR_ATTENDANCE_CORRECTION')
UNION ALL
SELECT 'CAP_HR_CORR_SELF', id, 'VIEW', true FROM acl.menu_master WHERE menu_code IN (
  'HR_ATTENDANCE_CORRECTION','HR_ATTENDANCE_CORRECTION_PENDING_LIST')
UNION ALL
SELECT 'CAP_HR_CORR_APPROVER', id, 'VIEW', true FROM acl.menu_master WHERE menu_code IN (
  'HR_ATTENDANCE_CORRECTION_APPROVAL_INBOX',
  'HR_ATTENDANCE_CORRECTION_APPROVAL_SCOPE_HISTORY');
```

**Result:** 8 packs · 22 screen mappings
| Pack | Screens |
|------|---------|
| CAP_HR_LEAVE_SELF | 2 |
| CAP_HR_LEAVE_APPROVER | 2 |
| CAP_HR_OUT_WORK_SELF | 2 |
| CAP_HR_OUT_WORK_APPROVER | 2 |
| CAP_HR_ADMIN | 4 |
| CAP_HR_ATTENDANCE | 6 |
| CAP_HR_CORR_SELF | 2 |
| CAP_HR_CORR_APPROVER | 2 |

---

### 2026-05-27 — Capability action matrix insert (CREATE, EDIT, APPROVE, RELEASE)
**Status:** ✅ Done in Dev

**কেন:** আগে শুধু VIEW ছিল (menu visibility)। System full action-level ACL support করে, তাই প্রতিটা screen এ সঠিক actions যোগ করা হয়েছে।

**Logic:**
- List screen → VIEW + EDIT
- Create screen → VIEW + CREATE
- Approval screen → VIEW + APPROVE
- Master setup screen → VIEW + CREATE + EDIT
- Report / History screen → VIEW only
- Reference screen (অন্য pack এ) → VIEW only

```sql
INSERT INTO acl.capability_menu_actions (capability_code, menu_id, action, allowed)
-- CAP_OM_MASTER_DATA
SELECT 'CAP_OM_MASTER_DATA', id, 'EDIT',   true FROM acl.menu_master WHERE menu_code IN ('OM_MATERIAL_LIST','OM_VENDOR_LIST','OM_ASL_LIST','OM_CUSTOMER_LIST')
UNION ALL
SELECT 'CAP_OM_MASTER_DATA', id, 'CREATE', true FROM acl.menu_master WHERE menu_code IN ('OM_MATERIAL_CREATE','OM_VENDOR_CREATE','OM_ASL_CREATE','OM_CUSTOMER_CREATE')
-- CAP_PROC_BUYER
UNION ALL
SELECT 'CAP_PROC_BUYER', id, 'EDIT',   true FROM acl.menu_master WHERE menu_code IN ('PROC_PO_LIST')
UNION ALL
SELECT 'CAP_PROC_BUYER', id, 'CREATE', true FROM acl.menu_master WHERE menu_code IN ('PROC_PO_CREATE')
-- CAP_PROC_RECEIVING
UNION ALL
SELECT 'CAP_PROC_RECEIVING', id, 'EDIT',   true FROM acl.menu_master WHERE menu_code IN ('PROC_GATE_ENTRY_LIST')
UNION ALL
SELECT 'CAP_PROC_RECEIVING', id, 'CREATE', true FROM acl.menu_master WHERE menu_code IN ('PROC_GATE_ENTRY_CREATE')
-- CAP_PROC_QA
UNION ALL
SELECT 'CAP_PROC_QA', id, 'APPROVE', true FROM acl.menu_master WHERE menu_code IN ('PROC_QA_QUEUE')
-- CAP_PROC_LOGISTICS
UNION ALL
SELECT 'CAP_PROC_LOGISTICS', id, 'EDIT',   true FROM acl.menu_master WHERE menu_code IN ('PROC_STO_LIST','PROC_PLANT_TRANSFER_LIST')
UNION ALL
SELECT 'CAP_PROC_LOGISTICS', id, 'CREATE', true FROM acl.menu_master WHERE menu_code IN ('PROC_STO_CREATE')
-- CAP_PROC_RETURNS
UNION ALL
SELECT 'CAP_PROC_RETURNS', id, 'EDIT',   true FROM acl.menu_master WHERE menu_code IN ('PROC_RTV_LIST','PROC_DEBIT_NOTE_LIST','PROC_EXCHANGE_REF_LIST')
UNION ALL
SELECT 'CAP_PROC_RETURNS', id, 'CREATE', true FROM acl.menu_master WHERE menu_code IN ('PROC_RTV_CREATE')
-- CAP_PROC_ACCOUNTS
UNION ALL
SELECT 'CAP_PROC_ACCOUNTS', id, 'EDIT',    true FROM acl.menu_master WHERE menu_code IN ('PROC_IV_LIST','PROC_LC_LIST')
UNION ALL
SELECT 'CAP_PROC_ACCOUNTS', id, 'CREATE',  true FROM acl.menu_master WHERE menu_code IN ('PROC_IV_CREATE','PROC_LC_LIST')
UNION ALL
SELECT 'CAP_PROC_ACCOUNTS', id, 'RELEASE', true FROM acl.menu_master WHERE menu_code IN ('PROC_BLOCKED_IV_LIST')
-- CAP_PROC_SALES
UNION ALL
SELECT 'CAP_PROC_SALES', id, 'EDIT',   true FROM acl.menu_master WHERE menu_code IN ('PROC_SO_LIST','PROC_INV_LIST')
UNION ALL
SELECT 'CAP_PROC_SALES', id, 'CREATE', true FROM acl.menu_master WHERE menu_code IN ('PROC_SO_CREATE')
-- CAP_PROC_INVENTORY
UNION ALL
SELECT 'CAP_PROC_INVENTORY', id, 'CREATE', true FROM acl.menu_master WHERE menu_code IN ('PROC_PI_LIST')
UNION ALL
SELECT 'CAP_PROC_INVENTORY', id, 'EDIT',   true FROM acl.menu_master WHERE menu_code IN ('PROC_PI_LIST')
-- CAP_PROC_SETUP
UNION ALL
SELECT 'CAP_PROC_SETUP', id, 'CREATE', true FROM acl.menu_master WHERE menu_code IN ('PROC_PAYMENT_TERMS_MASTER','PROC_PORT_MASTER','PROC_PORT_TRANSIT_MASTER','PROC_MATERIAL_CATEGORY_MASTER','PROC_IMPORT_LEAD_TIME_MASTER','PROC_DOMESTIC_LEAD_TIME_MASTER','PROC_TRANSPORTER_MASTER','PROC_CHA_MASTER')
UNION ALL
SELECT 'CAP_PROC_SETUP', id, 'EDIT',   true FROM acl.menu_master WHERE menu_code IN ('PROC_PAYMENT_TERMS_MASTER','PROC_PORT_MASTER','PROC_PORT_TRANSIT_MASTER','PROC_MATERIAL_CATEGORY_MASTER','PROC_IMPORT_LEAD_TIME_MASTER','PROC_DOMESTIC_LEAD_TIME_MASTER','PROC_TRANSPORTER_MASTER','PROC_CHA_MASTER')
-- HR packs
UNION ALL
SELECT 'CAP_HR_LEAVE_SELF',        id, 'CREATE',  true FROM acl.menu_master WHERE menu_code IN ('HR_LEAVE_APPLY')
UNION ALL
SELECT 'CAP_HR_LEAVE_SELF',        id, 'EDIT',    true FROM acl.menu_master WHERE menu_code IN ('HR_LEAVE_MY_REQUESTS')
UNION ALL
SELECT 'CAP_HR_LEAVE_APPROVER',    id, 'APPROVE', true FROM acl.menu_master WHERE menu_code IN ('HR_LEAVE_APPROVAL_INBOX')
UNION ALL
SELECT 'CAP_HR_OUT_WORK_SELF',     id, 'CREATE',  true FROM acl.menu_master WHERE menu_code IN ('HR_OUT_WORK_APPLY')
UNION ALL
SELECT 'CAP_HR_OUT_WORK_SELF',     id, 'EDIT',    true FROM acl.menu_master WHERE menu_code IN ('HR_OUT_WORK_MY_REQUESTS')
UNION ALL
SELECT 'CAP_HR_OUT_WORK_APPROVER', id, 'APPROVE', true FROM acl.menu_master WHERE menu_code IN ('HR_OUT_WORK_APPROVAL_INBOX')
UNION ALL
SELECT 'CAP_HR_ADMIN',             id, 'CREATE',  true FROM acl.menu_master WHERE menu_code IN ('HR_LEAVE_TYPE_MANAGE','HR_CALENDAR_MANAGE')
UNION ALL
SELECT 'CAP_HR_ADMIN',             id, 'EDIT',    true FROM acl.menu_master WHERE menu_code IN ('HR_LEAVE_TYPE_MANAGE','HR_CALENDAR_MANAGE')
UNION ALL
SELECT 'CAP_HR_ATTENDANCE',        id, 'CREATE',  true FROM acl.menu_master WHERE menu_code IN ('HR_ATTENDANCE_CORRECTION')
UNION ALL
SELECT 'CAP_HR_ATTENDANCE',        id, 'EDIT',    true FROM acl.menu_master WHERE menu_code IN ('HR_ATTENDANCE_CORRECTION')
UNION ALL
SELECT 'CAP_HR_CORR_SELF',         id, 'CREATE',  true FROM acl.menu_master WHERE menu_code IN ('HR_ATTENDANCE_CORRECTION')
UNION ALL
SELECT 'CAP_HR_CORR_SELF',         id, 'EDIT',    true FROM acl.menu_master WHERE menu_code IN ('HR_ATTENDANCE_CORRECTION_PENDING_LIST')
UNION ALL
SELECT 'CAP_HR_CORR_APPROVER',     id, 'APPROVE', true FROM acl.menu_master WHERE menu_code IN ('HR_ATTENDANCE_CORRECTION_APPROVAL_INBOX');
```

**Result:**
| Pack | VIEW | CREATE | EDIT | APPROVE | RELEASE | Total |
|------|------|--------|------|---------|---------|-------|
| CAP_OM_MASTER_DATA | 8 | 4 | 4 | — | — | 16 |
| CAP_PROC_BUYER | 6 | 1 | 1 | — | — | 8 |
| CAP_PROC_RECEIVING | 4 | 1 | 1 | — | — | 6 |
| CAP_PROC_QA | 2 | — | — | 1 | — | 3 |
| CAP_PROC_LOGISTICS | 4 | 1 | 2 | — | — | 7 |
| CAP_PROC_RETURNS | 6 | 1 | 3 | — | — | 10 |
| CAP_PROC_ACCOUNTS | 6 | 2 | 2 | — | 1 | 11 |
| CAP_PROC_SALES | 4 | 1 | 2 | — | — | 7 |
| CAP_PROC_INVENTORY | 4 | 1 | 1 | — | — | 6 |
| CAP_PROC_SETUP | 8 | 8 | 8 | — | — | 24 |
| CAP_HR_LEAVE_SELF | 2 | 1 | 1 | — | — | 4 |
| CAP_HR_LEAVE_APPROVER | 2 | — | — | 1 | — | 3 |
| CAP_HR_OUT_WORK_SELF | 2 | 1 | 1 | — | — | 4 |
| CAP_HR_OUT_WORK_APPROVER | 2 | — | — | 1 | — | 3 |
| CAP_HR_ADMIN | 4 | 2 | 2 | — | — | 8 |
| CAP_HR_ATTENDANCE | 6 | 1 | 1 | — | — | 8 |
| CAP_HR_CORR_SELF | 2 | 1 | 1 | — | — | 4 |
| CAP_HR_CORR_APPROVER | 2 | — | — | 1 | — | 3 |

---

### 2026-05-27 — generate_menu_snapshot mutable search_path fix
**Status:** ✅ Done in Dev (Migration: `fix_generate_menu_snapshot_search_path`)

**কেন:** Supabase Advisor warning — 3-param overload এ `SET search_path` ছিল না।
4-param overload আগে থেকেই সঠিক ছিল।

```sql
-- Migration দিয়ে apply হয়েছে (DDL)
-- supabase/migrations/20260527..._fix_generate_menu_snapshot_search_path.sql
-- Body same রেখে শুধু SET search_path যোগ করা হয়েছে:
CREATE OR REPLACE FUNCTION erp_menu.generate_menu_snapshot(
  p_user_id uuid, p_company_id uuid, p_universe text
)
RETURNS void LANGUAGE plpgsql
SET search_path TO 'pg_catalog','public','acl','erp_acl','erp_audit',
                   'erp_cache','erp_core','erp_hr','erp_map',
                   'erp_master','erp_menu','erp_meta'
AS $function$ ... (body unchanged) $function$;
```

**Verify:**
```sql
SELECT pronargs, proconfig FROM pg_proc
WHERE proname = 'generate_menu_snapshot'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'erp_menu')
ORDER BY pronargs;
-- Both overloads (3 and 4 args) should show proconfig with search_path set
```

**Prod:** Migration file apply করলেই হবে।

---

---

### 2026-05-27 — ACL action model correction: VIEW-only capability + role_menu_permissions

**Status:** ✅ Done in Dev

**কেন:** System analysis করে দেখা গেল generate_acl_snapshot দুটো আলাদা source থেকে ACL নেয়:
1. `capability_menu_actions` → menu visibility (VIEW)
2. `role_menu_permissions` → action grants per role (CREATE, EDIT, APPROVE)

আগে capability_menu_actions এ CREATE/EDIT/APPROVE/RELEASE ছিল — সেটা ভুল approach।
সঠিক: capability = VIEW only (screen দেখাবে), role_menu_permissions = action authority।
Exception: CAP_HR_LEAVE_SELF + CAP_HR_OUT_WORK_SELF এ EDIT রাখা হয়েছে (self-service — সবাই নিজের request edit করতে পারবে)।

RELEASE action system built-in না (check constraint এ নেই) — বাদ দেওয়া হয়েছে।

```sql
-- Step 1: Fix capability_menu_actions — VIEW only + 2 HR EDIT
DELETE FROM acl.capability_menu_actions
WHERE action != 'VIEW'
  AND NOT (capability_code = 'CAP_HR_LEAVE_SELF'    AND action = 'EDIT')
  AND NOT (capability_code = 'CAP_HR_OUT_WORK_SELF' AND action = 'EDIT');

-- Step 2: role_capabilities — all 11 roles × 18 capability packs
INSERT INTO acl.role_capabilities (role_code, capability_code)
SELECT r.role_code, c.capability_code
FROM (VALUES
  ('DIRECTOR'), ('L4_MANAGER'), ('L3_MANAGER'), ('L2_AUDITOR'), ('L1_AUDITOR'),
  ('L2_MANAGER'), ('L1_MANAGER'), ('L4_USER'), ('L3_USER'), ('L2_USER'), ('L1_USER')
) AS r(role_code)
CROSS JOIN acl.capabilities c
ON CONFLICT DO NOTHING;

-- Step 3: company_module_map — all 4 BUSINESS companies × 14 modules, all enabled
INSERT INTO acl.company_module_map (company_id, module_code, enabled)
SELECT c.id, m.module_code, true
FROM erp_master.companies c
CROSS JOIN acl.module_registry m
WHERE c.company_kind = 'BUSINESS'
ON CONFLICT DO NOTHING;

-- Step 4: role_menu_permissions
-- L1_USER → CREATE + EDIT (inherits up to DIRECTOR via MANAGER family)
-- L1_MANAGER → APPROVE (inherits up to DIRECTOR)
-- Both apply to all 65 ACL PAGEs
INSERT INTO acl.role_menu_permissions (role_code, menu_id, action, effect, approval_required)
SELECT r.role_code, am.id, r.action, 'ALLOW', false
FROM acl.menu_master am
JOIN erp_menu.menu_master em ON em.resource_code = am.menu_code AND em.menu_type = 'PAGE'
CROSS JOIN (VALUES
  ('L1_USER',    'CREATE'),
  ('L1_USER',    'EDIT'),
  ('L1_MANAGER', 'APPROVE')
) AS r(role_code, action)
ON CONFLICT DO NOTHING;
```

**Result:**
| Table | Before | After |
|-------|--------|-------|
| capability_menu_actions | 135 (VIEW+CREATE+EDIT+APPROVE+RELEASE) | 78 (VIEW only + 2 HR EDIT) |
| role_capabilities | 0 | 198 (11 roles × 18 caps) |
| company_module_map | 0 | 56 (4 companies × 14 modules) |
| role_menu_permissions | 0 | 195 (L1_USER×65×2 + L1_MANAGER×65×1) |

**Role inheritance explanation:**
- L1_USER CREATE+EDIT → L2_USER, L3_USER, L4_USER, L1_MANAGER...DIRECTOR সবাই পাবে (MANAGER family inherits USER)
- L1_MANAGER APPROVE → L2_MANAGER...DIRECTOR সবাই পাবে

**⚠️ Fully replaced same session** — নিচের entry দেখো।

---

### 2026-05-27 — role_menu_permissions final setup (proper version)
**Status:** ✅ Done in Dev

**Design:**
- Capability = VIEW (screen visibility) → capability_menu_actions এ আছে
- Role = action authority → role_menu_permissions এ
- Inheritance দিয়ে lowest role তে entry দিলে উপরে propagate হয়
- Report screens (16টা) তে কোনো WRITE/EDIT/DELETE/APPROVE নেই
- Auditor = general VIEW only, PID = তাদের responsibility তাই full access

**Report screens (no mutations):**
PROC_CSN_TRACKER, PROC_CSN_ALERTS, PROC_PLANNING_VIEW,
PROC_CURRENT_STOCK, PROC_STOCK_LEDGER, PROC_STOCK_VALUATION,
HR_LEAVE_REGISTER, HR_LEAVE_APPROVAL_SCOPE_HISTORY,
HR_OUT_WORK_REGISTER, HR_OUT_WORK_APPROVAL_SCOPE_HISTORY,
HR_ATTENDANCE_DAILY_REGISTER, HR_ATTENDANCE_MONTHLY_SUMMARY,
HR_ATTENDANCE_YEARLY_LEAVE_SUMMARY, HR_ATTENDANCE_DEPARTMENT_REPORT,
HR_ATTENDANCE_LEAVE_USAGE, HR_ATTENDANCE_CORRECTION_APPROVAL_SCOPE_HISTORY

```sql
DELETE FROM acl.role_menu_permissions;

-- 1. EXPORT: সবার জন্য সব screen (L1_USER + L1_AUDITOR = base, বাকিরা inherit)
INSERT INTO acl.role_menu_permissions (role_code, menu_id, action, effect, approval_required)
SELECT r.role_code, am.id, 'EXPORT', 'ALLOW', false
FROM acl.menu_master am
JOIN erp_menu.menu_master em ON em.resource_code = am.menu_code AND em.menu_type = 'PAGE'
CROSS JOIN (VALUES ('L1_USER'), ('L1_AUDITOR')) AS r(role_code);

-- 2. WRITE: L1_USER on transactional screens (L2/L3/L4/managers inherit)
INSERT INTO acl.role_menu_permissions (role_code, menu_id, action, effect, approval_required)
SELECT 'L1_USER', am.id, 'WRITE', 'ALLOW', false
FROM acl.menu_master am
JOIN erp_menu.menu_master em ON em.resource_code = am.menu_code AND em.menu_type = 'PAGE'
WHERE am.menu_code NOT IN (
  'PROC_CSN_TRACKER','PROC_CSN_ALERTS','PROC_PLANNING_VIEW',
  'PROC_CURRENT_STOCK','PROC_STOCK_LEDGER','PROC_STOCK_VALUATION',
  'HR_LEAVE_REGISTER','HR_LEAVE_APPROVAL_SCOPE_HISTORY',
  'HR_OUT_WORK_REGISTER','HR_OUT_WORK_APPROVAL_SCOPE_HISTORY',
  'HR_ATTENDANCE_DAILY_REGISTER','HR_ATTENDANCE_MONTHLY_SUMMARY',
  'HR_ATTENDANCE_YEARLY_LEAVE_SUMMARY','HR_ATTENDANCE_DEPARTMENT_REPORT',
  'HR_ATTENDANCE_LEAVE_USAGE','HR_ATTENDANCE_CORRECTION_APPROVAL_SCOPE_HISTORY'
);

-- 3. EDIT: L2_USER on transactional screens (L3/L4/managers inherit)
INSERT INTO acl.role_menu_permissions (role_code, menu_id, action, effect, approval_required)
SELECT 'L2_USER', am.id, 'EDIT', 'ALLOW', false
FROM acl.menu_master am
JOIN erp_menu.menu_master em ON em.resource_code = am.menu_code AND em.menu_type = 'PAGE'
WHERE am.menu_code NOT IN (
  'PROC_CSN_TRACKER','PROC_CSN_ALERTS','PROC_PLANNING_VIEW',
  'PROC_CURRENT_STOCK','PROC_STOCK_LEDGER','PROC_STOCK_VALUATION',
  'HR_LEAVE_REGISTER','HR_LEAVE_APPROVAL_SCOPE_HISTORY',
  'HR_OUT_WORK_REGISTER','HR_OUT_WORK_APPROVAL_SCOPE_HISTORY',
  'HR_ATTENDANCE_DAILY_REGISTER','HR_ATTENDANCE_MONTHLY_SUMMARY',
  'HR_ATTENDANCE_YEARLY_LEAVE_SUMMARY','HR_ATTENDANCE_DEPARTMENT_REPORT',
  'HR_ATTENDANCE_LEAVE_USAGE','HR_ATTENDANCE_CORRECTION_APPROVAL_SCOPE_HISTORY'
);

-- 4. APPROVE + DELETE: L1_MANAGER on transactional (L2_MANAGER...DIRECTOR inherit)
INSERT INTO acl.role_menu_permissions (role_code, menu_id, action, effect, approval_required)
SELECT 'L1_MANAGER', am.id, a.action, 'ALLOW', false
FROM acl.menu_master am
JOIN erp_menu.menu_master em ON em.resource_code = am.menu_code AND em.menu_type = 'PAGE'
CROSS JOIN (VALUES ('APPROVE'), ('DELETE')) AS a(action)
WHERE am.menu_code NOT IN (
  'PROC_CSN_TRACKER','PROC_CSN_ALERTS','PROC_PLANNING_VIEW',
  'PROC_CURRENT_STOCK','PROC_STOCK_LEDGER','PROC_STOCK_VALUATION',
  'HR_LEAVE_REGISTER','HR_LEAVE_APPROVAL_SCOPE_HISTORY',
  'HR_OUT_WORK_REGISTER','HR_OUT_WORK_APPROVAL_SCOPE_HISTORY',
  'HR_ATTENDANCE_DAILY_REGISTER','HR_ATTENDANCE_MONTHLY_SUMMARY',
  'HR_ATTENDANCE_YEARLY_LEAVE_SUMMARY','HR_ATTENDANCE_DEPARTMENT_REPORT',
  'HR_ATTENDANCE_LEAVE_USAGE','HR_ATTENDANCE_CORRECTION_APPROVAL_SCOPE_HISTORY'
);

-- 5. L1_AUDITOR → full access on PROC_PI_LIST (PID = auditor responsibility)
-- L2_AUDITOR inherits via AUDITOR family
INSERT INTO acl.role_menu_permissions (role_code, menu_id, action, effect, approval_required)
SELECT 'L1_AUDITOR', am.id, a.action, 'ALLOW', false
FROM acl.menu_master am
CROSS JOIN (VALUES ('WRITE'), ('EDIT'), ('DELETE'), ('APPROVE')) AS a(action)
WHERE am.menu_code = 'PROC_PI_LIST';

-- 6. L2_AUDITOR → APPROVE on all HR screens (21 screens)
INSERT INTO acl.role_menu_permissions (role_code, menu_id, action, effect, approval_required)
SELECT 'L2_AUDITOR', am.id, 'APPROVE', 'ALLOW', false
FROM acl.menu_master am
JOIN erp_menu.menu_master em ON em.resource_code = am.menu_code AND em.menu_type = 'PAGE'
WHERE am.menu_code LIKE 'HR_%';
```

**Result:**
| role_code | action | pages | note |
|-----------|--------|-------|------|
| L1_USER | WRITE | 49 | transactional only |
| L1_USER | EXPORT | 65 | all screens |
| L2_USER | EDIT | 49 | transactional only |
| L1_MANAGER | APPROVE | 49 | transactional only |
| L1_MANAGER | DELETE | 49 | transactional only |
| L1_AUDITOR | EXPORT | 65 | all screens |
| L1_AUDITOR | WRITE/EDIT/DELETE/APPROVE | 1 | PROC_PI_LIST only |
| L2_AUDITOR | APPROVE | 21 | HR screens |

**Effective per role (with inheritance):**
| Role | Actions |
|------|---------|
| L1_USER | WRITE + EXPORT |
| L2_USER | WRITE + EDIT + EXPORT |
| L3_USER, L4_USER | WRITE + EDIT + EXPORT |
| L1_MANAGER → DIRECTOR | WRITE + EDIT + APPROVE + DELETE + EXPORT |
| L1_AUDITOR | EXPORT + full PID (WRITE+EDIT+DELETE+APPROVE) |
| L2_AUDITOR | EXPORT + full PID + APPROVE on HR |

**⚠️ Correction applied same session:** role_menu_permissions এ `CREATE` ভুলে insert হয়েছিল।
System এ `CREATE` action নেই — backend `WRITE` check করে নতুন record তৈরিতে।
```sql
UPDATE acl.role_menu_permissions SET action = 'WRITE' WHERE action = 'CREATE';
```

**Final role_menu_permissions:**
| role_code | action | pages |
|-----------|--------|-------|
| L1_USER | WRITE | 65 |
| L1_USER | EDIT | 65 |
| L1_MANAGER | APPROVE | 65 |

**System's 6 valid actions (from vwed_engine.ts):**
VIEW · WRITE · EDIT · DELETE · APPROVE · EXPORT

**Pending (needs user input):** erp_acl.work_contexts, acl.work_context_capabilities

---

## Prod এ Apply করার সময়
উপরের সব SQL prod project এ একবার চালাতে হবে।
Order important — erp_menu ACL rebuild → acl.menu_master → module_resource_map → capability packs → action model fix → role_capabilities → company_module_map → role_menu_permissions → work_contexts → work_context_capabilities → acl_versions → capture + generate।
SA universe আলাদাভাবে (already done in prod if migration ran)।
