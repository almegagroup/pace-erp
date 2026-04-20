/*
 * File-ID: PHASE3D-ERROR-MESSAGES
 * File-Path: frontend/src/config/errorMessages.js
 * Phase: 3
 * Domain: FRONT
 * Purpose: Central map of backend error codes to human-readable UI messages.
 *
 * Rules:
 *   - Keys are exact backend error codes (from `code` field in error responses)
 *   - Values are plain English suitable for toast messages shown to SA / ACL users
 *   - Technical details (code, request_id, gate_id) go to console.error only — never in UI
 *   - Add new codes here; never hard-code messages inline across pages
 *
 * Usage:
 *   import { getErrorMessage } from '../config/errorMessages.js';
 *   const message = getErrorMessage(code) ?? fallbackMessage;
 */

const ERROR_MESSAGES = Object.freeze({
  // ── Auth ──────────────────────────────────────────────────────────────────
  AUTH_NOT_AUTHENTICATED: "Your session has expired. Please log in again.",
  AUTH_SESSION_EXPIRED: "Your session has expired. Please log in again.",
  AUTH_SESSION_INACTIVE: "Your session is no longer active. Please log in again.",

  // ── Company / Work context ────────────────────────────────────────────────
  ME_CONTEXT_COMPANY_REQUIRED: "Please select a company to continue.",
  ME_CONTEXT_COMPANY_FORBIDDEN: "You no longer have access to that company.",
  ME_CONTEXT_WORK_CONTEXT_UNAVAILABLE: "No work context is available for the selected company.",
  ME_CONTEXT_WORK_CONTEXT_FORBIDDEN: "The selected work context is not available to you.",
  ME_CONTEXT_WORK_CONTEXT_REQUIRED: "Please select a work context to continue.",
  ME_CONTEXT_ADMIN_FIXED: "Admin workspace does not use a company switcher.",
  ME_CONTEXT_UPDATE_FAILED: "Workspace context could not be updated. Please try again.",

  // ── Multi-company pipeline ────────────────────────────────────────────────
  MULTI_COMPANY_HEADER_REQUIRED: "Please select a company before taking this action.",
  MULTI_COMPANY_ACCESS_DENIED: "You do not have access to the selected company.",
  MULTI_COMPANY_INVALID: "The selected company is not valid for this action.",

  // ── Workflow decisions ────────────────────────────────────────────────────
  WORKFLOW_DECISION_FAILED: "Approval decision could not be submitted. Please try again.",
  NETWORK_WORKFLOW_DECISION_FAILED: "Connection error. Decision could not be submitted.",

  // ── HR — Leave ────────────────────────────────────────────────────────────
  LEAVE_REQUEST_CREATE_FAILED: "Leave request could not be submitted.",
  LEAVE_REQUEST_UPDATE_FAILED: "Leave request could not be updated.",
  LEAVE_REQUEST_CANCEL_FAILED: "Leave request could not be cancelled.",
  LEAVE_REQUEST_LIST_FAILED: "Leave request history could not be loaded.",
  LEAVE_APPROVAL_INBOX_FAILED: "Leave approval inbox could not be loaded.",
  LEAVE_APPROVAL_HISTORY_FAILED: "Leave approval history could not be loaded.",
  LEAVE_REGISTER_FAILED: "Leave register could not be loaded.",

  // ── HR — Out Work ─────────────────────────────────────────────────────────
  OUT_WORK_REQUEST_CREATE_FAILED: "Out work request could not be submitted.",
  OUT_WORK_REQUEST_UPDATE_FAILED: "Out work request could not be updated.",
  OUT_WORK_REQUEST_CANCEL_FAILED: "Out work request could not be cancelled.",
  OUT_WORK_REQUEST_LIST_FAILED: "Out work request history could not be loaded.",
  OUT_WORK_DESTINATION_LIST_FAILED: "Destination list could not be loaded.",
  OUT_WORK_DESTINATION_CREATE_FAILED: "Destination could not be created.",
  OUT_WORK_APPROVAL_INBOX_FAILED: "Out work approval inbox could not be loaded.",
  OUT_WORK_APPROVAL_HISTORY_FAILED: "Out work approval history could not be loaded.",
  OUT_WORK_REGISTER_FAILED: "Out work register could not be loaded.",

  // ── Admin — User scope ────────────────────────────────────────────────────
  USER_SCOPE_SAVE_FAILED: "User scope could not be saved. Check the selected companies, contexts, and departments.",
  USER_SCOPE_INPUT_INVALID: "Required fields are missing. Auth user ID and parent company are required.",
  USER_SCOPE_USER_NOT_FOUND: "User not found.",
  USER_SCOPE_COMPANY_INVALID: "One or more companies are inactive or not valid business companies.",
  USER_SCOPE_PROJECT_INVALID: "One or more projects do not match the selected company scope.",
  USER_SCOPE_DEPARTMENT_INVALID: "One or more departments are outside the selected company scope.",
  USER_SCOPE_SINGLE_DEPARTMENT_REQUIRED: "A user can only have one HR department at a time.",
  USER_SCOPE_WORK_CONTEXT_INVALID: "One or more work contexts are outside the selected work companies.",

  // ── Admin — Set Primary Company ───────────────────────────────────────────
  SET_PRIMARY_INPUT_INVALID: "Auth user ID and company ID are required.",
  SET_PRIMARY_USER_NOT_FOUND: "User not found.",
  SET_PRIMARY_COMPANY_NOT_ASSIGNED: "That company is not assigned to this user. Assign it first before setting as primary.",
  SET_PRIMARY_RESET_FAILED: "Primary company could not be updated. Please try again.",
  SET_PRIMARY_SET_FAILED: "Primary company could not be set. Please try again.",

  // ── Generic ───────────────────────────────────────────────────────────────
  REQUEST_FAILED: "The request could not be completed. Please try again.",
  ADMIN_ONLY: "This action requires admin access.",
});

/**
 * Returns the human-readable message for a given error code, or null if not mapped.
 * Always falls back gracefully — never throws.
 *
 * @param {string | null | undefined} code
 * @returns {string | null}
 */
export function getErrorMessage(code) {
  if (!code || typeof code !== "string") {
    return null;
  }

  return ERROR_MESSAGES[code] ?? null;
}

export { ERROR_MESSAGES };
