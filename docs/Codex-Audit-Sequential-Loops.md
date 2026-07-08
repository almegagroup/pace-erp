# Codex Audit: Sequential / Per-Item Network-DB Loops

Audit date: 2026-07-08

Scope:
- `supabase/functions` backend handlers and helper loops inside handler files
- `frontend/src` code paths that fan out into per-item API calls

Method:
- Reported only loops that execute a DB/API/fetch call once per row/item instead of using a set-based query or a bulk endpoint.
- Included `.map(... async ...)` / `Promise.all(...)` fan-out cases when they still make one request per item.
- Excluded retry loops and pure in-memory loops.

## Summary

Worst offenders by round-trips per request:

1. `supabase/functions/api/_core/procurement/po.handlers.ts:917` creates one PO per raw material and does about `7` DB/RPC round-trips per material, plus nested helper fan-out.
2. `supabase/functions/api/_core/procurement/grn.handlers.ts:1068` legacy GRN reversal does about `5-7` DB/RPC round-trips per GRN line.
3. `supabase/functions/api/_core/procurement/rtv.handlers.ts:508` RTV posting does about `4-6` DB/RPC round-trips per RTV line.
4. `supabase/functions/api/_core/procurement/sales_order.handlers.ts:696` sales issue posting does about `5` DB/RPC round-trips per issue line.
5. `supabase/functions/api/_core/procurement/sto.handlers.ts:780` consignment-distribution STO creation does about `5-7` DB/RPC round-trips per CSN line, depending on whether the STO header is created in that iteration.
6. `supabase/functions/api/_core/procurement/po.handlers.ts:2525` and `:2612` process PO order groups one PO at a time; direct confirm / approve also triggers nested CSN creation.
7. `supabase/functions/api/_core/procurement/opening_stock.handlers.ts:713`, `physical_inventory.handlers.ts:738`, and `inward_qa.handlers.ts:729` each post inventory movements per line/item rather than through a batch RPC.
8. Frontend fan-out hotspots:
   `frontend/src/pages/dashboard/procurement/accounts/IVCreatePage.jsx:67`,
   `frontend/src/pages/dashboard/procurement/accounts/LandedCostListPage.jsx:49`,
   `frontend/src/pages/dashboard/procurement/rtv/RTVListPage.jsx:74`,
   `frontend/src/admin/sa/screens/SACapabilityGovernance.jsx:119`,
   all issue one API request per visible item.

## Admin

| File:Line | Loop does | Round-trips per iteration | Independence | Rough severity |
| --- | --- | --- | --- | --- |
| `frontend/src/admin/sa/screens/SACapabilityGovernance.jsx:119` | Loads capability-action counts by fetching each capability pack separately. | `1` API call per capability. | `INDEPENDENT` | Per visible capability pack, usually `10-100`. |
| `frontend/src/admin/sa/screens/SACapabilityGovernance.jsx:168` | Loads attached capabilities for each work context separately. | `1` API call per work context. | `INDEPENDENT` | Per company work context, usually `5-50`. |
| `frontend/src/admin/sa/screens/SACapabilityGovernance.jsx:284` | Saves capability matrix rows by disabling or upserting one resource rule at a time. | `1` API call per resource row. | `INDEPENDENT` | Per module resource row, usually `10-200`. |
| `frontend/src/admin/sa/screens/SACapabilityGovernance.jsx:1023` | Removes selected pack contents one resource rule at a time. | `1` API call per selected rule. | `INDEPENDENT` | Per bulk removal, usually `1-100`. |
| `frontend/src/admin/sa/screens/SAMaterialMaster.jsx:294` | Activates selected materials one by one through the OM status endpoint. | `1` API call per material id. | `INDEPENDENT` | Per bulk selection, usually `1-100`. |
| `frontend/src/admin/sa/screens/SAMaterialMaster.jsx:313` | Deactivates selected materials one by one through the OM status endpoint. | `1` API call per material id. | `INDEPENDENT` | Per bulk selection, usually `1-100`. |
| `frontend/src/admin/sa/screens/SAMaterialMaster.jsx:1099` | Loads UOM conversions for each material with alternate UOMs separately. | `1` API call per material. | `INDEPENDENT` | Per current page with alt-UOM materials, usually `1-25`. |
| `frontend/src/admin/sa/screens/SAVendorMaster.jsx:504` | Activates selected vendors one by one through the OM status endpoint. | `1` API call per vendor id. | `INDEPENDENT` | Per bulk selection, usually `1-100`. |
| `frontend/src/admin/sa/screens/SAVendorMaster.jsx:515` | Deactivates selected vendors one by one through the OM status endpoint. | `1` API call per vendor id. | `INDEPENDENT` | Per bulk selection, usually `1-100`. |

## HR

| File:Line | Loop does | Round-trips per iteration | Independence | Rough severity |
| --- | --- | --- | --- | --- |
| `supabase/functions/api/_core/hr/leave.handlers.ts:256` | Builds a work-context map by loading active contexts one company at a time. | `1` DB query per company. | `INDEPENDENT` | Per distinct company in the result set, usually `1-10`. |
| `supabase/functions/api/_core/hr/leave.handlers.ts:1386` | Writes leave day-records by calling the leave upsert RPC once per date. | `1` RPC per day. | `INDEPENDENT` | Per approved leave span, usually `1-31` days. |
| `supabase/functions/api/_core/hr/out_work.handlers.ts:234` | Builds a work-context map by loading active contexts one company at a time. | `1` DB query per company. | `INDEPENDENT` | Per distinct company in the result set, usually `1-10`. |
| `supabase/functions/api/_core/hr/out_work.handlers.ts:1323` | Writes out-work day-records by calling the out-work upsert RPC once per date. | `1` RPC per day. | `INDEPENDENT` | Per approved out-work span, usually `1-31` days. |

## OM

| File:Line | Loop does | Round-trips per iteration | Independence | Rough severity |
| --- | --- | --- | --- | --- |
| `supabase/functions/api/_core/om/material.handlers.ts:217` | Bulk-saves created materials row by row after duplicate check and code generation. | About `3` DB/RPC calls per create row. | `INDEPENDENT` | Bulk material create/import, usually `1-100+` rows. |
| `supabase/functions/api/_core/om/material.handlers.ts:292` | Bulk-saves updated materials row by row after loading the existing row and optional duplicate check. | About `2` DB calls per update row. | `INDEPENDENT` | Bulk material update, usually `1-100+` rows. |
| `supabase/functions/api/_core/om/material.handlers.ts:395` | CSV import creates each material row separately after duplicate check and code generation. | About `3` DB/RPC calls per CSV row. | `INDEPENDENT` | CSV imports, usually `10-1000` rows. |
| `supabase/functions/api/_core/om/material.handlers.ts:718` | Deletes materials one id at a time. | `1` DB delete per material id. | `INDEPENDENT` | Per bulk delete, usually `1-100`. |
| `supabase/functions/api/_core/om/material.handlers.ts:926` | Imports material-company mappings by upserting one mapping row at a time. | `1` DB upsert per CSV row. | `INDEPENDENT` | Mapping imports, usually `10-1000` rows. |
| `supabase/functions/api/_core/om/vendor.handlers.ts:374` | Deletes vendors one id at a time. | `1` DB delete per vendor id. | `INDEPENDENT` | Per bulk delete, usually `1-100`. |
| `supabase/functions/api/_core/om/vendor_material_info.handlers.ts:343` | Validates each supplied UOM code separately while creating vendor-material info. | `1` DB lookup per UOM row. | `INDEPENDENT` | Per VMI create, usually `1-5` UOM rows. |
| `supabase/functions/api/_core/om/vendor_material_info.handlers.ts:565` | Validates each supplied UOM code separately while updating vendor-material info. | `1` DB lookup per UOM row. | `INDEPENDENT` | Per VMI update, usually `1-5` UOM rows. |

## Procurement

| File:Line | Loop does | Round-trips per iteration | Independence | Rough severity |
| --- | --- | --- | --- | --- |
| `supabase/functions/api/_core/procurement/l2_masters.handlers.ts:1543` | Validates CHA-port mappings by checking each port separately before bulk upsert. | `1` DB lookup per port id. | `INDEPENDENT` | Per CHA mapping save, usually `1-20` ports. |
| `supabase/functions/api/_core/procurement/po.handlers.ts:781` | Prepares PO lines by validating cost center and approved ASL/UOM one line at a time. | About `3` DB queries per PO line. | `INDEPENDENT` | Per PO line, usually `1-20`. |
| `supabase/functions/api/_core/procurement/po.handlers.ts:917` | Creates one PO per requested raw material, including line prep, number generation, header insert, and line insert. | About `7` DB/RPC calls per raw material. | `INDEPENDENT` | Per order-group material, usually `1-20`. |
| `supabase/functions/api/_core/procurement/po.handlers.ts:616` | Creates CSNs one PO line at a time by checking existence, generating number, resolving category, and inserting. | About `4` DB/RPC calls per PO line. | `INDEPENDENT` | Per PO line; current design is usually `1` line per PO, legacy can be `1-20`. |
| `supabase/functions/api/_core/procurement/po.handlers.ts:692` | Inactivates linked CSNs one row at a time. | `1` DB update per CSN row. | `INDEPENDENT` | Per PO/STO CSN set, usually `1-20`. |
| `supabase/functions/api/_core/procurement/po.handlers.ts:2152` | Updates knocked-off quantity one PO line at a time after bulk status update. | `1` DB update per PO line. | `INDEPENDENT` | Per knocked-off PO, usually `1-20` lines. |
| `supabase/functions/api/_core/procurement/po.handlers.ts:2457` | Hydrates each PO in an order group by loading lines with one query per PO. | `1` DB query per PO. | `INDEPENDENT` | Per PO order group, usually `1-20` POs. |
| `supabase/functions/api/_core/procurement/po.handlers.ts:2525` | Confirms/escalates each PO in an order group one by one; direct-confirm also loads lines and creates CSNs. | `2` DB calls per PO on approval path, or about `6` per PO on direct-confirm path. | `INDEPENDENT` | Per PO order group, usually `1-20` POs. |
| `supabase/functions/api/_core/procurement/po.handlers.ts:2612` | Approves each PO in an order group one by one, then loads lines and creates CSNs. | About `6` DB/RPC calls per PO in the current single-line design. | `INDEPENDENT` | Per PO order group, usually `1-20` POs. |
| `supabase/functions/api/_core/procurement/po.handlers.ts:2704` | Rejects each PO in an order group one by one and logs the rejection separately. | `2` DB writes per PO. | `INDEPENDENT` | Per PO order group, usually `1-20` POs. |
| `frontend/src/pages/dashboard/procurement/po/POCreateOpeningPage.jsx:517` | Auto-confirms each created opening PO with one API call per PO. | `1` API call per created PO. | `INDEPENDENT` | Per opening PO batch, usually `1-20` POs. |
| `supabase/functions/api/_core/procurement/gate_entry.handlers.ts:883` | Writes distributed net weight back to gate-entry lines one line at a time. | `1` DB update per gate-entry line. | `INDEPENDENT` | Per weighed gate entry, usually `1-20` lines. |
| `supabase/functions/api/_core/procurement/gate_entry.handlers.ts:963` | Restores consignment-note status one CSN at a time when rolling back gate-exit inbound flow. | `1` DB update per CSN. | `INDEPENDENT` | Per gate entry, usually `1-20` CSNs. |
| `supabase/functions/api/_core/procurement/grn.handlers.ts:1068` | Reverses old-style GRN lines one by one, including stock reversal, PO reversal, GE updates, CSN restore, and QA cleanup. | About `5-7` DB/RPC calls per GRN line. | `DEPENDENT` | Per legacy GRN line, usually `1-20`. |
| `supabase/functions/api/_core/procurement/invoice_verification.handlers.ts:519` | Recomputes and stores IV match results one invoice line at a time. | `1` DB update per IV line. | `INDEPENDENT` | Per IV document, usually `1-50` lines. |
| `supabase/functions/api/_core/procurement/inward_qa.handlers.ts:729` | Posts QA usage-decision stock movements and inserts decision rows one decision line at a time. | About `2-3` DB/RPC calls per decision line. | `DEPENDENT` | Per QA decision set, usually `1-10` lines. |
| `supabase/functions/api/_core/procurement/opening_stock.handlers.ts:713` | Posts opening-stock lines one by one, then writes posting references back per line. | About `3` DB/RPC calls per line. | `DEPENDENT` | Per opening-stock document, usually `1-100` lines. |
| `supabase/functions/api/_core/procurement/physical_inventory.handlers.ts:738` | Posts PI differences item by item and releases the block row per item. | About `2-3` DB/RPC calls per item. | `DEPENDENT` | Per PI document, usually `10-500` items. |
| `supabase/functions/api/_core/procurement/rtv.handlers.ts:508` | Posts RTV stock movements one line at a time, including snapshot checks, PI block check, stock movements, and line update. | About `4-6` DB/RPC calls per RTV line, depending on direct-path branch. | `DEPENDENT` | Per RTV line, usually `1-20`. |
| `frontend/src/pages/dashboard/procurement/accounts/LandedCostListPage.jsx:49` | Hydrates GRN details for landed-cost rows by calling `getGRN` per unique GRN id. | `1` API call per unique GRN. | `INDEPENDENT` | Per landed-cost page, usually `1-50` GRNs. |
| `frontend/src/pages/dashboard/procurement/accounts/IVCreatePage.jsx:67` | Hydrates full GRN details for each posted GRN candidate separately. | `1` API call per GRN. | `INDEPENDENT` | IV create vendor selection, usually `1-200` GRNs. |
| `frontend/src/pages/dashboard/procurement/rtv/RTVListPage.jsx:74` | Hydrates GRN details for RTV rows by calling `getGRN` per unique GRN id. | `1` API call per unique GRN. | `INDEPENDENT` | Per RTV list page, usually `1-50` GRNs. |
| `supabase/functions/api/_core/procurement/sales_order.handlers.ts:696` | Issues sales-order lines one by one, including material lookup, stock snapshot, PI block check, stock movement, and line update. | About `5` DB/RPC calls per issue line. | `DEPENDENT` | Per SO issue batch, usually `1-20` lines. |
| `supabase/functions/api/_core/procurement/sales_order.handlers.ts:1039` | Builds sales-invoice lines by loading the source SO line separately for each DC line. | `1` DB query per DC line. | `INDEPENDENT` | Per delivery challan, usually `1-20` lines. |
| `supabase/functions/api/_core/procurement/sales_order.handlers.ts:1174` | Recomputes sales-invoice totals by updating each invoice line separately. | `1` DB update per sales-invoice line. | `INDEPENDENT` | Per sales invoice, usually `1-20` lines. |
| `supabase/functions/api/_core/procurement/sto.handlers.ts:680` | Creates inter-plant STO CSNs one STO line at a time after existence check and doc-number/payment-term lookups. | About `4` DB/RPC calls per STO line. | `INDEPENDENT` | Per inter-plant STO line, usually `1-20`. |
| `supabase/functions/api/_core/procurement/sto.handlers.ts:780` | Builds consignment-distribution STOs one CSN at a time, loading sub/mother CSN, PO, PO line, optional STO header, line insert, and CSN update. | About `5-7` DB/RPC calls per CSN line. | `DEPENDENT` | Per transform from sub-CSNs, usually `1-20` lines. |
| `supabase/functions/api/_core/procurement/sto.handlers.ts:1177` | Updates STO editable lines one line at a time. | `1` DB update per STO line. | `INDEPENDENT` | Per STO edit, usually `1-20` lines. |
| `supabase/functions/api/_core/procurement/sto.handlers.ts:1809` | Dispatches STO lines one by one, including snapshot check, PI block check, stock posting, and line status update. | About `4` DB/RPC calls per STO line. | `DEPENDENT` | Per STO dispatch, usually `1-20` lines. |
| `supabase/functions/api/_core/procurement/sto.handlers.ts:2068` | Rolls received GRN quantities into STO lines by re-fetching all STO lines and then updating one line per GRN line. | About `2` DB calls per linked GRN line. | `DEPENDENT` | Per STO receipt / linked GRN, usually `1-20` lines. |

## Production

| File:Line | Loop does | Round-trips per iteration | Independence | Rough severity |
| --- | --- | --- | --- | --- |
| `supabase/functions/api/_core/production/process_order.handlers.ts:551` | Writes actual quantities back to process-order lines one line at a time during finalization prep. | `1` DB write per line. | `INDEPENDENT` | Per process order, usually `1-50` component lines. |
| `supabase/functions/api/_core/production/process_order.handlers.ts:641` | Applies QA quantity adjustments one process-order line at a time. | `1` DB update per line. | `INDEPENDENT` | Per verification request, usually `1-50` lines. |
| `supabase/functions/api/_core/production/process_order.handlers.ts:664` | Posts RM/PM issue movements one process-order line at a time and stores ledger ids back per line. | About `2` DB/RPC calls per line. | `DEPENDENT` | Per process order, usually `1-50` component lines. |
| `supabase/functions/api/_core/production/process_order.handlers.ts:786` | Reverses RM/PM issue movements one process-order line at a time. | `1` RPC per line. | `DEPENDENT` | Per reversed process order, usually `1-50` component lines. |
| `supabase/functions/api/_core/production/packing_order.handlers.ts:362` | Writes actual quantities back to packing-order lines one line at a time. | `1` DB update per line. | `INDEPENDENT` | Per packing order, usually `1-50` PM lines. |
| `supabase/functions/api/_core/production/packing_order.handlers.ts:395` | Posts PM issue movements one packing line at a time and stores ledger ids back per line. | About `2` DB/RPC calls per PM line. | `DEPENDENT` | Per packing order, usually `1-50` PM lines. |
| `supabase/functions/api/_core/production/packing_order.handlers.ts:469` | Reverses PM issue movements one packing line at a time. | `1` RPC per PM line. | `DEPENDENT` | Per reversed packing order, usually `1-50` PM lines. |
| `supabase/functions/api/_core/production/pack_bom.handlers.ts:492` | Applies pack-BOM change-request rows one change at a time. | `1` DB write per change row. | `INDEPENDENT` | Per BOM change request, usually `1-50` lines. |
| `supabase/functions/api/_core/production/stroke_change_request.handlers.ts:260` | Applies stroke change-request rows one line at a time. | `1` DB update per stroke line. | `INDEPENDENT` | Per stroke change request, usually `1-50` lines. |

## Session

| File:Line | Loop does | Round-trips per iteration | Independence | Rough severity |
| --- | --- | --- | --- | --- |
| `supabase/functions/api/_core/session/session.admin_revoke.ts:37` | Force-revokes each active session cluster separately by terminating cluster, windows, and linked sessions. | About `3` DB updates per active cluster. | `INDEPENDENT` | Per user revoke, usually `1-5` active clusters. |
