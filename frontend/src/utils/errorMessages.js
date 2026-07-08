export const ERROR_MESSAGES = {
  GE_ID_REQUIRED: "Gate entry ID is missing.",
  GE_NOT_OPEN: "This gate entry cannot be modified - it is no longer open.",
  GE_ALREADY_PRUNED: "This gate entry has already been pruned.",
  GE_CANCELLED: "This gate entry has been cancelled and cannot be pruned.",
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

  GEX_GATE_ENTRY_REQUIRED: "Gate entry ID is required.",
  GEX_ALREADY_EXISTS: "An inbound gate exit already exists for this gate entry.",
  GEX_TARE_REQUIRED: "Tare weight is required for weighed gate exits.",
  GEX_NOT_FOUND: "Gate exit not found.",
  GEX_ID_REQUIRED: "Gate exit ID is missing.",
  GEX_CREATE_FAILED: null,
  GEX_FETCH_FAILED: null,
  GEX_LINE_UPDATE_FAILED: null,

  GRN_GATE_ENTRY_REQUIRED: "Gate entry ID is required to create a GRN.",
  GRN_GATE_ENTRY_LINE_REQUIRED: "Gate entry line ID is required.",
  GRN_GATE_ENTRY_LINE_NOT_FOUND: "Gate entry line not found.",
  GRN_ALREADY_EXISTS: "A GRN already exists for this gate entry line.",
  GRN_RECEIVED_QTY_INVALID: "Received quantity cannot be negative.",
  GRN_DISCREPANCY_REMARKS_REQUIRED: "Please explain the reason for the quantity difference.",
  GRN_LOCATION_MAP_NOT_FOUND: "Selected storage location is not mapped to this company.",
  GE_NOT_FOUND: "Gate entry not found.",
  GE_LINE_FETCH_FAILED: null,
  GE_LINE_GRN_LIST_FAILED: null,
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

  MATERIAL_POSTING_BLOCKED:
    "This material has an active physical inventory count in progress. Posting is blocked until the count is closed.",

  AUTH_FAIL: "PERMISSION",
  AUTH_NOT_AUTHENTICATED: "আপনার session মেয়াদ শেষ হয়ে গেছে। অনুগ্রহ করে আবার login করুন।",

  ADMIN_ONLY: "PERMISSION",
  MANAGER_OR_SA_REQUIRED: "PERMISSION",
  OM_ADMIN_REQUIRED: "PERMISSION",
  OM_SA_REQUIRED: "PERMISSION",
  NO_HANDLER_MATCHED: "PERMISSION",

  PO_OPEN_LIST_FAILED: null,
  PO_NOT_FOUND: null,
  PO_LINE_NOT_FOUND: null,
  PO_LINE_NOT_OPEN: "This PO line is no longer open for receipt.",

  CSN_OPEN_LIST_FAILED: null,
  CSN_NOT_FOUND: null,
  CSN_ARRIVAL_UPDATE_FAILED: null,
  CSN_FETCH_FAILED: null,

  DOCUMENT_FLOW_PARAMS_REQUIRED: "Document type and ID are required.",
  DOCUMENT_FLOW_UNKNOWN_TYPE: "Unrecognised document type.",
  DOCUMENT_FLOW_FETCH_GE_LINES_FAILED: null,
  DOCUMENT_FLOW_FETCH_IV_LINES_FAILED: null,
  DOCUMENT_FLOW_FETCH_IV_LINKS_FAILED: null,

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

  LEAVE_TYPE_CODE_REQUIRED: "Leave type code is required.",
  LEAVE_TYPE_CODE_INVALID: "Leave type code must be 1-20 uppercase letters, digits, or underscores.",
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

  INSUFFICIENT_STOCK: "Insufficient stock available for this transaction.",
};

export const GENERIC_PERMISSION_MESSAGE = "আপনার এই কাজের অনুমতি নেই।";
export const GENERIC_IT_MESSAGE =
  "একটি সিস্টেম সমস্যা হয়েছে। অনুগ্রহ করে Administrator এর সাথে যোগাযোগ করুন।";

function looksSafeForUsers(message) {
  if (typeof message !== "string") {
    return false;
  }
  const trimmed = message.trim();
  if (!trimmed || trimmed.length >= 200) {
    return false;
  }
  if (trimmed.includes(" at ") || trimmed.includes("Error:") || trimmed.includes("stack")) {
    return false;
  }
  return true;
}

export function resolveErrorMessage(errorCode, backendMessage, status) {
  const mapped = ERROR_MESSAGES[errorCode];

  if (mapped === "PERMISSION") {
    return GENERIC_PERMISSION_MESSAGE;
  }

  if (typeof mapped === "string") {
    return mapped;
  }

  if (status === 403) {
    return GENERIC_PERMISSION_MESSAGE;
  }

  if (mapped === null) {
    return GENERIC_IT_MESSAGE;
  }

  if (typeof status === "number" && status >= 500) {
    return GENERIC_IT_MESSAGE;
  }

  if (looksSafeForUsers(backendMessage)) {
    return backendMessage.trim();
  }

  return GENERIC_IT_MESSAGE;
}
