/*
 * File-Path: frontend/src/shared/uploadReviewRows.js
 * Purpose: Shared review-grid ordering for spreadsheet uploads. A user should
 *          always see rows that require attention before already-ready rows,
 *          without losing the source spreadsheet's order within the same
 *          priority. `needsAction` may return a boolean or a number:
 *          a higher number is surfaced first. This keeps the default behavior
 *          for existing uploaders while allowing a workflow to put the most
 *          actionable blockers (for example, unresolved master data) before
 *          secondary validation failures. Negative priorities deliberately
 *          place non-actionable historical/upload duplicates below normal
 *          review rows.
 */

export function prioritizeUploadReviewRows(rows, needsAction) {
  return (rows ?? [])
    .map((row, originalIndex) => {
      const result = needsAction(row);
      const numericPriority = typeof result === "number" ? result : Number(Boolean(result));
      return { row, originalIndex, priority: Number.isFinite(numericPriority) ? numericPriority : 0 };
    })
    .sort((left, right) => right.priority - left.priority || left.originalIndex - right.originalIndex)
    .map(({ row }) => row);
}

/**
 * Mark later occurrences of the same business-line key in one spreadsheet.
 * The first occurrence remains usable and the source order is preserved.
 * Existing ERP-record duplicates remain a server-authoritative decision.
 */
export function markSpreadsheetDuplicates(rows, getBusinessKey) {
  const firstRowByKey = new Map();
  return (rows ?? []).map((row, originalIndex) => {
    const key = String(getBusinessKey(row) ?? "").trim();
    if (!key) return { ...row, upload_duplicate: false, upload_duplicate_of: null };
    const first = firstRowByKey.get(key);
    if (first != null) return { ...row, upload_duplicate: true, upload_duplicate_of: first };
    const identity = row.row_index ?? row.row_key ?? originalIndex;
    firstRowByKey.set(key, identity);
    return { ...row, upload_duplicate: false, upload_duplicate_of: null };
  });
}
