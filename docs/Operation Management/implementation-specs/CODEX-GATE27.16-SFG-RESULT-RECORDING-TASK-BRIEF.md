# CODEX-GATE27.16-SFG-RESULT-RECORDING-TASK-BRIEF

**Gate:** 27.16
**Domain:** PRODUCTION
**Title:** SFG Result Recording page — exact clone of Inward QA's mechanism, applied to Process PO Verify batches instead of GRN
**Scope:** 1 migration (new tables, cloned shape) + backend (new handlers, cloned from `inward_qa.handlers.ts`) + frontend (new page, cloned from the Inward QA page)
**Dependency:** Gate-27.6 (done). Independent of 27.14/27.15.
**Reference doc:** feasibility §83.4 ("SFG Result Recording is an exact identical mechanism to the existing Inward QA page — same `qa_test_method_master`/`qa_category_test_config` infrastructure, same UI/workflow pattern — only the context changes... Build it as a direct clone, not a fresh design.")

---

## 0. What you are cloning — read these first, do not redesign

- Backend: `supabase/functions/api/_core/procurement/inward_qa.handlers.ts`
- Frontend: `frontend/src/pages/dashboard/procurement/qa/QAQueuePage.jsx` (note: this is the **Procurement** QA page, a different file from Production's `QAQueuePage.jsx` — do not confuse them)
- Tables: `erp_procurement.inward_qa_document`, `erp_procurement.inward_qa_test_line`, `erp_procurement.inward_qa_decision_line`
- Shared masters reused as-is (do not clone these, just reference them): `qa_test_method_master`, `qa_category_test_config`

**The only thing that changes is the source context**: Inward QA's source is a GRN (vendor receipt); SFG Result Recording's source is a Process PO's Verify-stage SFG batch (i.e., a `process_order` row with `status = 'VERIFIED'` and `po_type IN ('MTO','HPS','MTS')` — INT/MTEST skip QI hold entirely per Gate-27.6, so they have nothing to record here). Everything else — test-line structure, category/method config lookup, decision-line recording — should mirror the Inward QA mechanism as closely as possible.

---

## 1. Migration (new file, additive, idempotent)

Create the SFG-equivalent tables in `erp_production` schema, mirroring the three `inward_qa_*` tables' column shapes exactly, substituting the GRN-specific linkage for a Process PO linkage:

- `erp_production.sfg_qa_document` — mirror `inward_qa_document`'s columns, but its "source document" reference is `process_order_id` (FK to `erp_production.process_order`) instead of a GRN id, plus `batch_number` (denormalized, from the process order) for easy display.
- `erp_production.sfg_qa_test_line` — mirror `inward_qa_test_line` exactly (same `qa_test_method_master`/`qa_category_test_config` FK columns, same result-value columns).
- `erp_production.sfg_qa_decision_line` — mirror `inward_qa_decision_line` exactly (same usage-decision columns). **Note:** per the locked design, MTO/HPS/MTS's QI→Unrestricted release already happens automatically at Verify (P321, done in Gate-27.6) — this decision-line table here is for recording the **lab/quality test result and pass/fail outcome**, not for triggering a *second* stock movement. Do not add any stock-posting logic to this feature — it is a documentation/traceability layer that sits alongside the already-completed Verify movement, not a gate before it.

Add a document-number series entry if the existing `generate_doc_number`/number-series pattern requires one for a new document type (check `erp_procurement.document_number_series` pattern used by `inward_qa_document.qa_number` and follow the same convention for a new `sfg_qa_number`).

Copy grants exactly as the `inward_qa_*` tables have them (inspect via `information_schema` / existing migration before writing).

---

## 2. Backend handlers (new file `supabase/functions/api/_core/production/sfg_qa.handlers.ts`)

Clone `inward_qa.handlers.ts`'s handler shapes (list, get, create-test-lines, record-decision) function-for-function, adjusting:
- The "eligible source documents" list query: instead of GRNs pending QA, list `process_order` rows where `status = 'VERIFIED'` and `po_type IN ('MTO','HPS','MTS')` and no `sfg_qa_document` yet exists for that `process_order_id` (or list all with a status column showing whether recording is done — match whichever list pattern Inward QA's own "pending QA" list uses).
- Test-line creation: same `qa_test_method_master`/`qa_category_test_config` lookup pattern, scoped by the process order's Prodshade material instead of the GRN's material.
- Decision recording: same shape, but do **not** call `postStockMovement` — this feature never posts stock (see §1 note). Just persist the decision/result.
- R-01: resolve PO number, batch number, Prodshade display, stroke number the same batched way Gate-27.6's list handlers already do (reuse those patterns, e.g. `resolveUserDisplayNames`, batched `.in()` material/stroke lookups) — do not invent a different resolution style.
- Register new routes in `production.routes.ts` and ACL entries in `route-acl-registry.ts`, reusing the QA-capability resource code already used by Production's own QA routes (`PROD_QA_QUEUE` or the nearest equivalent — inspect what Gate-27.5/27.6 already registered for QA actions and reuse that resource family, don't invent a new one).

---

## 3. Frontend (new file `frontend/src/pages/dashboard/production/SfgResultRecordingPage.jsx`)

Clone the **structure** of `frontend/src/pages/dashboard/procurement/qa/QAQueuePage.jsx` (Procurement's Inward QA page) — same list/detail/test-line-entry/decision-recording flow — retargeted to the SFG/Process-PO context:
- List: VERIFIED Process POs (MTO/HPS/MTS) pending or completed SFG result recording, showing PO Number, Batch Number, Prodshade, Stroke, Verified date, recording status.
- Detail: enter test results per configured category/method (same UI pattern as Inward QA's test-line entry), then record the decision/outcome.
- `useQuery` throughout, R-01 compliant, add `prodApi.js` wrapper functions for the new endpoints.
- Add this page to whatever navigation/menu registration pattern the other new Production pages in this Gate already use (check how `QAQueuePage.jsx`/`ReversalPage.jsx` etc. got their routes registered in the app's navigation, e.g. `operationScreens.js`, and follow the same pattern with a new tx-code entry if that's how it's done — inspect before inventing).

---

## Hard rules
1. This is a clone, not a redesign — when in doubt, match Inward QA's existing behavior exactly rather than improving on it.
2. No stock posting in this feature — Verify's P261/P101/P321 already happened in Gate-27.6; this only records the lab/QA test outcome.
3. R-01, `useQuery`, batched reads, ACL registration — same standing rules as every other brief.
4. Migration idempotent, additive only.

## Verification
1. Confirm no `postStockMovement` call anywhere in the new handler file.
2. Confirm the new tables' grants mirror `inward_qa_*`'s grants.
3. `deno check` on the new handler file and routes/ACL registry.
4. Confirm INT/MTEST process orders never appear in this feature's eligible list (they have no QI hold to record against).

## Log + commit
Append one `docs/Codex-Log.md` entry listing every new file and the exact `inward_qa_*` counterpart each was cloned from. **Do not run git commands.**
