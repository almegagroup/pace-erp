# Codex Log

This file is Codex's own work log for the Claude+Codex workflow, used to record Codex-specific actions, decisions, and completed tasks in a concise running history that can be extended over time.

## Template

### YYYY-MM-DD HH:MM TZ
- Task:
- Changes:
- Notes:

## Entries

### 2026-06-24 08:34 IST
- Task: Created `docs/Codex-Log.md`.
- Changes: Added the header, a reusable template section, and the initial log entry.
- Notes: Created as the starting work log for the Claude+Codex workflow.

### 2026-06-24 08:35 IST
- Task: Redesigned PO Create across the frontend page and procurement PO API handlers.
- Changes: Moved Payment Term and Freight Term from header-level inputs to each material line, added a per-line drawer for Remarks and Rebate details (rate, basis, remarks), added a header-level drawer for GST Terms and repeatable Extra Fields, and relabeled the per-line delivery date field to `ETD` for Domestic POs or `ETA to Port` for Import POs.
- Notes: Files touched were `frontend/src/pages/dashboard/procurement/po/POCreatePage.jsx` and `supabase/functions/api/_core/procurement/po.handlers.ts`.

### 2026-06-24 12:27 IST
- Task: Reworked PO create line details and materials extras UI in the frontend page.
- Changes: Moved GST Terms from the header-level drawer into each line's `LineMoreDrawer`, added per-line `gst_terms` state and payload mapping, removed the header `More Details` flow entirely, added a `+ Add Field` Materials action, and rendered `extra_fields` inline under the materials grid with per-row remove controls.
- Notes: Edited only `frontend/src/pages/dashboard/procurement/po/POCreatePage.jsx` and appended this log entry.

### 2026-06-24 12:32 IST
- Task: Updated PO create backend GST term handling to validate per material instead of at the header/group level.
- Changes: Removed top-level `gst_terms` parsing and validation from `createPOHandler`, stopped writing `gst_terms` onto `erp_procurement.po_order_group`, and added optional per-material validation from `materialRecord.gst_terms` inside the materials loop while leaving the `purchase_order` insert unchanged.
- Notes: A migration adding a `gst_terms` column to `erp_procurement.purchase_order` is still required before the per-line value can be persisted; right now the handler validates `materialRecord.gst_terms` and then silently drops it.

### 2026-06-24 12:45 IST
- Task: Added reusable Procurement user display-name resolution and applied it to PO and PO-order-group responses/UI.
- Changes: Created `supabase/functions/api/_shared/resolveUserDisplayNames.ts`, updated `supabase/functions/api/_core/procurement/po.handlers.ts` to append `*_by_display` siblings across returned PO, PO line, PO order-group, approval-log, and amendment-log payloads via one batched resolver pass per response, and updated `frontend/src/pages/dashboard/procurement/po/POListPage.jsx` to render `created_by_display` with fallback to the raw UUID.
- Notes: Files touched were `supabase/functions/api/_shared/resolveUserDisplayNames.ts`, `supabase/functions/api/_core/procurement/po.handlers.ts`, `frontend/src/pages/dashboard/procurement/po/POListPage.jsx`, and `docs/Codex-Log.md`.

### 2026-06-24 15:33 IST
- Task: Replaced raw PO master UUIDs with readable company and line-item display values in procurement PO detail/list responses and the PO detail UI.
- Changes: Added batched PO reference lookups in `supabase/functions/api/_core/procurement/po.handlers.ts` so PO detail responses now include `company_name`, `material_display`, `cost_center_display`, and `payment_term_display`, extended the PO list response with `company_name`, updated `frontend/src/pages/dashboard/procurement/po/PODetailPage.jsx` to render the company name in the header, replaced the line material UUID cell with the formatted material display, and inserted Cost Center and Payment Term columns after Rate.
- Notes: Kept the lookup strategy to one query per master table across the returned lines to avoid N+1 queries and left existing fallbacks to raw IDs in place when a display value is missing.
