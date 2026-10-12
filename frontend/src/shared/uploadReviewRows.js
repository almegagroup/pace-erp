/*
 * File-Path: frontend/src/shared/uploadReviewRows.js
 * Purpose: Shared review-grid ordering for spreadsheet uploads. A user should
 *          always see rows that require attention before already-ready rows,
 *          without losing the source spreadsheet's order within the same
 *          priority. `needsAction` may return a boolean or a positive number:
 *          a higher number is surfaced first. This keeps the default behavior
 *          for existing uploaders while allowing a workflow to put the most
 *          actionable blockers (for example, unresolved master data) before
 *          secondary validation failures.
 */

export function prioritizeUploadReviewRows(rows, needsAction) {
  return (rows ?? [])
    .map((row, originalIndex) => {
      const result = needsAction(row);
      const numericPriority = typeof result === "number" ? result : Number(Boolean(result));
      return { row, originalIndex, priority: Number.isFinite(numericPriority) ? Math.max(0, numericPriority) : 0 };
    })
    .sort((left, right) => right.priority - left.priority || left.originalIndex - right.originalIndex)
    .map(({ row }) => row);
}
