/*
 * File-Path: frontend/src/shared/uploadReviewRows.js
 * Purpose: Shared review-grid ordering for spreadsheet uploads. A user should
 *          always see rows that require attention before already-ready rows,
 *          without losing the source spreadsheet's order within either group.
 */

export function prioritizeUploadReviewRows(rows, needsAction) {
  return (rows ?? [])
    .map((row, originalIndex) => ({ row, originalIndex, needsAction: Boolean(needsAction(row)) }))
    .sort((left, right) => Number(right.needsAction) - Number(left.needsAction) || left.originalIndex - right.originalIndex)
    .map(({ row }) => row);
}
