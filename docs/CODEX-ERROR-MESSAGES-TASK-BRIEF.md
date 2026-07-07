# CODEX TASK — User-Facing Error Message Map

## Objective

Create a frontend error message map so that all API errors shown to users are either:
- A **specific, helpful message** (for errors the user can fix), or
- A **standard IT message** (for errors the user cannot fix)

---

## Background

When an API call fails, the backend returns a JSON body like:
```json
{ "error_code": "GE_PRUNE_BLOCKED_BY_GRN", "message": "Reverse all GRNs before pruning. Pending: GRN-300002" }
```

Currently the frontend shows this raw `message` string directly. We want to:
1. Map known `error_code` values to user-friendly messages
2. For unmapped or system-level codes → show a standard IT message

---

## Classification Rules

| Category | When to use | Message to show |
|----------|-------------|-----------------|
| **User-facing** | 400 validation errors, business rule violations | Specific helpful message (see Step 2) |
| **Permission** | 403 — user lacks access | "আপনার এই কাজের অনুমতি নেই।" |
| **IT/System** | 500 errors, infrastructure failures, unmapped codes | "একটি সিস্টেম সমস্যা হয়েছে। অনুগ্রহ করে Administrator এর সাথে যোগাযোগ করুন।" |

---

## Step 1 — Create the error message map file

**File:** `frontend/src/utils/errorMessages.js`

Structure:
```javascript
// error_code → user-facing message string
// null = IT/system error (use generic IT message)
// "PERMISSION" = permission denied (use generic permission message)

export const ERROR_MESSAGES = {
  // GE — Gate Entry
  GE_ID_REQUIRED: "Gate entry ID is missing.",
  GE_NOT_OPEN: "This gate entry cannot be modified — it is no longer open.",
  GE_ALREADY_PRUNED: "This gate entry has already been pruned.",
  GE_CANCELLED: "This gate entry has been cancelled and cannot be pruned.",
  GE_PRUNE_BLOCKED_BY_GRN: null, // message comes dynamically from backend — pass through as-is
  GE_TYPE_INVALID: "Invalid gate entry type selected.",
  GE_LINE_INVALID: "One or more gate entry lines are missing required fields (quantity, UOM, or material).",
  GE_LINE_REF_MISSING: "Each line must be linked to a PO line or STO line.",
  GE_GROSS_WEIGHT_REQUIRED: "Gross weight is required for BULK or TANKER delivery lines.",
  GE_COMPANY_SCOPE: "One or more PO lines belong to a different company.",
  GE_CREATE_FAILED: null,
  GE_UPDATE_FAILED: null,
  GE_LINE_CREATE_FAILED: null,
  GE_LINE_REPLACE_FAILED: null,
  GE_LIST_FAILED: null,
  GE_PRUNE_FAILED: null,
  GE_PRUNE_GRN_CHECK_FAILED: null,

  // GEX — Gate Exit
  GEX_GATE_ENTRY_REQUIRED: "Gate entry ID is required.",
  GEX_ALREADY_EXISTS: "An inbound gate exit already exists for this gate entry.",
  GEX_TARE_REQUIRED: "Tare weight is required for weighed gate exits.",
  GEX_NOT_FOUND: "Gate exit not found.",
  GEX_ID_REQUIRED: "Gate exit ID is missing.",
  GEX_CREATE_FAILED: null,
  GEX_FETCH_FAILED: null,
  GEX_LINE_UPDATE_FAILED: null,

  // GRN — Goods Receipt
  GRN_GATE_ENTRY_REQUIRED: "Gate entry ID is required to create a GRN.",
  GRN_ALREADY_EXISTS: "A GRN already exists for this gate entry.",
  GRN_NOT_FOUND: "GRN not found.",
  GRN_NOT_DRAFT: "Only DRAFT GRNs can be edited or posted.",
  GRN_NOT_POSTED: "Only POSTED GRNs can be reversed.",
  GRN_STORAGE_REQUIRED: "Every GRN line must have a storage location before posting.",
  GRN_STOCK_TYPE_INVALID: "Invalid stock type selected.",
  GRN_REVERSAL_REASON_REQUIRED: "A reason is required to reverse a GRN.",
  GRN_ID_REQUIRED: "GRN ID is missing.",
  GRN_CREATE_FAILED: null,
  GRN_UPDATE_FAILED: null,
  GRN_LINE_FETCH_FAILED: null,
  GRN_LINE_CREATE_FAILED: null,
  GRN_LINE_UPDATE_FAILED: null,
  GRN_LINE_POST_UPDATE_FAILED: null,
  GRN_POST_RPC_FAILED: null,
  GRN_REVERSE_RPC_FAILED: null,
  GRN_REVERSE_UPDATE_FAILED: null,
  GRN_REVERSE_CSN_LINK_FAILED: null,
  GRN_REVERSE_CSN_UPDATE_FAILED: null,
  GRN_REVERSE_GATE_LINE_FAILED: null,
  GRN_REVERSE_QA_VOID_FAILED: null,
  GRN_HEADER_POST_FAILED: null,
  GRN_LIST_FAILED: null,
  GRN_CSN_FETCH_FAILED: null,
  GRN_CSN_UPDATE_FAILED: null,
  GRN_VENDOR_PRICE_UPDATE_FAILED: null,
  GRN_EXISTING_CHECK_FAILED: null,
  GRN_GATE_ENTRY_FETCH_FAILED: null,
  GRN_GATE_ENTRY_LINE_UPDATE_FAILED: null,
  GRN_CSN_LINK_FETCH_FAILED: null,

  // MATERIAL_POSTING
  MATERIAL_POSTING_BLOCKED: "This material has an active physical inventory count in progress. Posting is blocked until the count is closed.",

  // AUTH
  AUTH_FAIL: "PERMISSION", // handled specially by login flow
  AUTH_NOT_AUTHENTICATED: "আপনার session মেয়াদ শেষ হয়ে গেছে। অনুগ্রহ করে আবার login করুন।",

  // PERMISSION (generic)
  ADMIN_ONLY: "PERMISSION",
  MANAGER_OR_SA_REQUIRED: "PERMISSION",
  OM_ADMIN_REQUIRED: "PERMISSION",
  OM_SA_REQUIRED: "PERMISSION",
  NO_HANDLER_MATCHED: "PERMISSION",

  // PO
  PO_OPEN_LIST_FAILED: null,
  PO_NOT_FOUND: null,
  PO_LINE_NOT_FOUND: null,
  PO_LINE_NOT_OPEN: "This PO line is no longer open for receipt.",

  // CSN
  CSN_OPEN_LIST_FAILED: null,
  CSN_NOT_FOUND: null,
  CSN_ARRIVAL_UPDATE_FAILED: null,
  CSN_FETCH_FAILED: null,

  // DOCUMENT FLOW
  DOCUMENT_FLOW_PARAMS_REQUIRED: "Document type and ID are required.",
  DOCUMENT_FLOW_UNKNOWN_TYPE: "Unrecognised document type.",
  DOCUMENT_FLOW_FETCH_GE_LINES_FAILED: null,
  DOCUMENT_FLOW_FETCH_IV_LINES_FAILED: null,
  DOCUMENT_FLOW_FETCH_IV_LINKS_FAILED: null,

  // HOLIDAY / CALENDAR
  HOLIDAY_DATE_REQUIRED: "Please provide a date or date range.",
  HOLIDAY_DATE_RANGE_INVALID: "Start date must be on or before end date.",
  HOLIDAY_DATE_DUPLICATE: "A calendar entry already exists for one or more of the selected dates.",
  HOLIDAY_NAME_REQUIRED: "Holiday name is required.",
  HOLIDAY_NAME_TOO_LONG: "Holiday name must be 100 characters or fewer.",
  HOLIDAY_NO_CHANGES: "No changes were provided to update.",
  HOLIDAY_NOT_FOUND: "Holiday not found.",
  HOLIDAY_ID_REQUIRED: "Holiday ID is required.",
  HOLIDAY_FORBIDDEN: "PERMISSION",
  HOLIDAY_CREATE_FAILED: null,
  HOLIDAY_UPDATE_FAILED: null,
  HOLIDAY_DELETE_FAILED: null,
  HOLIDAY_LIST_FAILED: null,

  // LEAVE
  LEAVE_DATE_RANGE_INVALID: "End date must be after start date.",
  LEAVE_NO_WORKING_DAYS: "The selected date range contains no working days.",
  LEAVE_REASON_REQUIRED: "A reason is required for leave requests.",
  LEAVE_TYPE_REQUIRED: "Please select a leave type.",
  LEAVE_TYPE_INVALID: "The selected leave type is not available for your company.",
  LEAVE_DUPLICATE_DATE_RANGE: "A leave request already exists for this date range.",
  LEAVE_BACKDATE_LIMIT_EXCEEDED: "The selected date exceeds the allowed backdate limit.",
  LEAVE_CANCEL_NOT_ALLOWED: "This leave request can no longer be cancelled.",
  LEAVE_EDIT_NOT_ALLOWED: "This leave request can no longer be edited.",
  LEAVE_CANCEL_FORBIDDEN: "PERMISSION",
  LEAVE_UPDATE_FORBIDDEN: "PERMISSION",
  LEAVE_REQUEST_NOT_FOUND: "Leave request not found.",
  LEAVE_WORKFLOW_NOT_FOUND: "Workflow request not found.",

  // LEAVE TYPE MANAGEMENT
  LEAVE_TYPE_CODE_REQUIRED: "Leave type code is required.",
  LEAVE_TYPE_CODE_INVALID: "Leave type code must be 1–20 uppercase letters, digits, or underscores.",
  LEAVE_TYPE_CODE_DUPLICATE: "A leave type with this code already exists for your company.",
  LEAVE_TYPE_NAME_REQUIRED: "Leave type name is required.",
  LEAVE_TYPE_MAX_DAYS_INVALID: "Maximum days per year must be a positive number.",
  LEAVE_TYPE_NO_CHANGES: "No changes were provided.",
  LEAVE_TYPE_NOT_FOUND: "Leave type not found.",
  LEAVE_TYPE_ID_REQUIRED: "Leave type ID is required.",
  LEAVE_TYPE_FORBIDDEN: "PERMISSION",
  LEAVE_TYPE_MANAGE_FORBIDDEN: "PERMISSION",
  LEAVE_TYPE_OVERRIDE_FORBIDDEN: "PERMISSION",
  LEAVE_TYPE_OVERRIDE_NOT_ALLOWED: "Leave type can only be changed while the request is pending.",
  LEAVE_TYPE_OVERRIDE_SELF_FORBIDDEN: "Use the regular edit option to change your own leave type.",

  // OUT WORK
  OUT_WORK_DATE_RANGE_INVALID: "End date must be after start date.",
  OUT_WORK_REASON_REQUIRED: "A reason is required for out-work requests.",
  OUT_WORK_DESTINATION_REQUIRED: "Please select or create a destination.",
  OUT_WORK_DESTINATION_NOT_FOUND: "Selected destination not found.",
  OUT_WORK_DESTINATION_ADDRESS_REQUIRED: "Destination address is required.",
  OUT_WORK_DESTINATION_NAME_REQUIRED: "Destination name is required.",
  OUT_WORK_DAY_SCOPE_INVALID: "Day scope must be FULL_DAY or PARTIAL_DAY.",
  OUT_WORK_DEPARTURE_TIME_REQUIRED: "Office departure time is required for partial-day out-work.",
  OUT_WORK_PARTIAL_DAY_SINGLE_DATE_ONLY: "Partial-day out-work must be for a single date.",
  OUT_WORK_DUPLICATE_DATE_RANGE: "An out-work request already exists for this date range.",
  OUT_WORK_BACKDATE_LIMIT_EXCEEDED: "The selected date exceeds the allowed backdate limit.",
  OUT_WORK_CANCEL_NOT_ALLOWED: "This out-work request can no longer be cancelled.",
  OUT_WORK_EDIT_NOT_ALLOWED: "This out-work request can no longer be edited.",
  OUT_WORK_CANCEL_FORBIDDEN: "PERMISSION",
  OUT_WORK_UPDATE_FORBIDDEN: "PERMISSION",
  OUT_WORK_REQUEST_NOT_FOUND: "Out-work request not found.",

  // ATTENDANCE
  ATTENDANCE_REPORT_FORBIDDEN: "PERMISSION",
  BACKDATED_LEAVE_FORBIDDEN: "PERMISSION",
  BACKDATED_OUT_WORK_FORBIDDEN: "PERMISSION",
  MANUAL_CORRECTION_FORBIDDEN: "PERMISSION",
  CORRECTION_INBOX_FORBIDDEN: "PERMISSION",
  CORRECTION_NOTE_REQUIRED: "A correction note is required.",
  CORRECTION_REQUEST_ID_REQUIRED: "Correction request ID is missing.",
  CORRECTION_REQUEST_NOT_FOUND: "Correction request not found.",
  CORRECTION_STATUS_INVALID: "Invalid attendance status. Valid values: PRESENT, ABSENT, MISS_PUNCH.",
  DATE_RANGE_INVALID: "End date must be on or after start date.",
  DATE_RANGE_TOO_WIDE: "Date range is limited to 31 days.",
  EMPLOYEE_ID_REQUIRED: "Employee ID is required.",
  EMPLOYEE_NOT_FOUND: "Employee not found.",
  INVALID_PARAMS: "Year and month are required.",
  DAY_KIND_INVALID: "Day kind must be HOLIDAY, WEEK_OFF, or WORKING_DAY.",

  // INSUFFICIENT STOCK
  INSUFFICIENT_STOCK: "Insufficient stock available for this transaction.",
};

export const GENERIC_PERMISSION_MESSAGE = "আপনার এই কাজের অনুমতি নেই।";
export const GENERIC_IT_MESSAGE = "একটি সিস্টেম সমস্যা হয়েছে। অনুগ্রহ করে Administrator এর সাথে যোগাযোগ করুন।";

/**
 * Resolve an API error_code to a user-facing message.
 * @param {string} errorCode
 * @param {string} [backendMessage] - raw message from backend (used as fallback for dynamic messages)
 * @returns {string}
 */
export function resolveErrorMessage(errorCode, backendMessage) {
  const mapped = ERROR_MESSAGES[errorCode];

  if (mapped === "PERMISSION") return GENERIC_PERMISSION_MESSAGE;
  if (mapped === null) return GENERIC_IT_MESSAGE;
  if (typeof mapped === "string") return mapped;

  // Not in map — use backend message if it looks user-safe (short, no stack trace)
  if (backendMessage && backendMessage.length < 200 && !backendMessage.includes("at ")) {
    return backendMessage;
  }

  return GENERIC_IT_MESSAGE;
}
```

**Note on `GE_PRUNE_BLOCKED_BY_GRN`:** This one has a dynamic backend message ("Reverse all GRNs before pruning. Pending: GRN-300002"). Set it to `undefined` (not in the map) so `resolveErrorMessage` falls through to the backend message passthrough logic, which will show it as-is since it's short and user-readable.

Actually, remove `GE_PRUNE_BLOCKED_BY_GRN` from the map entirely — leave it unmapped so the passthrough logic handles it.

---

## UI Display Rules — PACE ERP Style

**Do NOT create a new modal or popup component for errors.**

PACE ERP already has a consistent error display pattern — follow it exactly:

### Pattern 1 — Page-level errors (most common)
Use the existing `notices` prop on `ErpScreenScaffold` and `ErpMasterListTemplate`:
```jsx
notices={[
  { key: "api-error", tone: "error", message: resolveErrorMessage(err.error_code, err.message) }
]}
```
This shows a red notice strip at the top of the page. User reads it and acts — no dismiss button needed, it clears when the page state changes.

### Pattern 2 — Action-blocking confirmation (already in use)
For errors that come back AFTER a user clicked an action button (e.g. a save or prune that failed), set the error into the page's existing `error` state:
```jsx
} catch (err) {
  setError(resolveErrorMessage(err.error_code, err.message));
}
```
The page already renders this via the `notices` prop — no change to JSX needed, only the message content improves.

### Pattern 3 — Pre-flight blocking (openActionConfirm)
For cases where the UI knows BEFORE calling the API that the action is blocked (e.g. GE prune with unresolved GRNs), the existing `openActionConfirm` pattern is already correct — do NOT change it.

### What NOT to do
- Do not add `<Modal>`, `<Toast>`, `<Snackbar>`, or any new popup component
- Do not use `alert()` or `window.confirm()`
- Do not auto-dismiss error messages — user must be able to read them
- Do not show errors outside of the existing notice strip location

---

## Step 2 — Wire into the API layer

Find the central API error handler. Look for files like:
- `frontend/src/api/apiClient.js`
- `frontend/src/pages/dashboard/procurement/procurementApi.js` (or similar)

Find where API errors are thrown/caught and displayed. The pattern to look for:

```javascript
// Current (bad):
throw new Error(data.message || data.error_code || "Unknown error");

// New (good):
import { resolveErrorMessage } from "../../../utils/errorMessages.js";
throw new Error(resolveErrorMessage(data.error_code, data.message));
```

Find the ONE place where API errors are parsed — likely a shared fetch wrapper or `apiClient`. Update that one place. Do NOT update every individual API function.

If there is no central wrapper and errors are thrown in individual functions, update the shared error parsing logic only — do not touch every function.

---

## Step 3 — Verify

After implementing:
1. The file `frontend/src/utils/errorMessages.js` exists
2. `resolveErrorMessage` is imported and used in the API layer
3. No individual API function has been modified to add error messages inline

---

## What NOT to do

- Do not change any backend files
- Do not add error messages inline in individual page components
- Do not translate the specific dynamic messages (like GRN numbers in prune error) — those pass through as-is
- Do not change the error display UI — only the message content

---

## Output

- `frontend/src/utils/errorMessages.js` — the map + resolver function
- Minimal change to the API fetch wrapper to use `resolveErrorMessage`

Commit: `feat: user-facing error message map + resolver`
