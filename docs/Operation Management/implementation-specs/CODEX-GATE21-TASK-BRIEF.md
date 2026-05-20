# CODEX-GATE21-TASK-BRIEF — Missing FE Pages (Debit Note, Exchange Ref, Blocked IV, Gate Exit Inbound)

**Gate:** 21  
**Domain:** PROCUREMENT / FE  
**Authority:** Frontend

---

## Overview

Gate-21 creates 5 missing FE pages for procurement sub-flows that have complete backend handlers but no FE views. No new DB migrations, no new BE handlers, no new `procurementApi.js` functions needed — all API calls already exist.

---

## Files to Create (5 FE pages)

```
frontend/src/pages/dashboard/procurement/rtv/DebitNoteListPage.jsx
frontend/src/pages/dashboard/procurement/rtv/DebitNoteDetailPage.jsx
frontend/src/pages/dashboard/procurement/rtv/ExchangeRefListPage.jsx
frontend/src/pages/dashboard/procurement/accounts/BlockedIVListPage.jsx
frontend/src/pages/dashboard/procurement/gate/GateExitInboundDetailPage.jsx
```

## Files to Modify (3 files)

```
frontend/src/navigation/screens/projects/operationModule/operationScreens.js  ← add 5 screen entries
frontend/src/router/AppRouter.jsx                                              ← add 5 imports + 5 routes
frontend/src/pages/dashboard/procurement/gate/GateEntryDetailPage.jsx         ← navigate to GateExitInboundDetailPage after creation
```

---

## operationScreens.js — Add 5 Screen Entries

Insert these 5 entries into the `OPERATION_SCREENS` object in `operationScreens.js`. Insert them in logical position — Debit Note + Exchange Ref after `PROC_RTV_DETAIL`, Blocked IV after `PROC_IV_DETAIL`, Gate Exit Inbound after `PROC_GATE_ENTRY_DETAIL`.

```js
PROC_DEBIT_NOTE_LIST: {
  screen_code: "PROC_DEBIT_NOTE_LIST",
  route: "/dashboard/procurement/debit-notes",
  universe: "ACL",
  type: SCREEN_TYPE.FULL,
  keepAlive: false,
},

PROC_DEBIT_NOTE_DETAIL: {
  screen_code: "PROC_DEBIT_NOTE_DETAIL",
  route: "/dashboard/procurement/debit-notes/:id",
  universe: "ACL",
  type: SCREEN_TYPE.FULL,
  keepAlive: false,
},

PROC_EXCHANGE_REF_LIST: {
  screen_code: "PROC_EXCHANGE_REF_LIST",
  route: "/dashboard/procurement/exchange-refs",
  universe: "ACL",
  type: SCREEN_TYPE.FULL,
  keepAlive: false,
},

PROC_BLOCKED_IV_LIST: {
  screen_code: "PROC_BLOCKED_IV_LIST",
  route: "/dashboard/procurement/accounts/blocked-ivs",
  universe: "ACL",
  type: SCREEN_TYPE.FULL,
  keepAlive: false,
},

PROC_GATE_EXIT_INBOUND_DETAIL: {
  screen_code: "PROC_GATE_EXIT_INBOUND_DETAIL",
  route: "/dashboard/procurement/gate-exits/inbound/:id",
  universe: "ACL",
  type: SCREEN_TYPE.FULL,
  keepAlive: false,
},
```

---

## AppRouter.jsx — Add Imports and Routes

**Add 5 imports** (after the existing RTVDetailPage import line):
```jsx
import DebitNoteListPage from "../pages/dashboard/procurement/rtv/DebitNoteListPage.jsx";
import DebitNoteDetailPage from "../pages/dashboard/procurement/rtv/DebitNoteDetailPage.jsx";
import ExchangeRefListPage from "../pages/dashboard/procurement/rtv/ExchangeRefListPage.jsx";
import BlockedIVListPage from "../pages/dashboard/procurement/accounts/BlockedIVListPage.jsx";
import GateExitInboundDetailPage from "../pages/dashboard/procurement/gate/GateExitInboundDetailPage.jsx";
```

**Add 5 routes** inside the dashboard `<Route>` block:

After the `procurement/rtvs/:id` route:
```jsx
<Route
  path="procurement/debit-notes"
  element={<DebitNoteListPage />}
/>
<Route
  path="procurement/debit-notes/:id"
  element={<DebitNoteDetailPage />}
/>
<Route
  path="procurement/exchange-refs"
  element={<ExchangeRefListPage />}
/>
```

After the `procurement/accounts/invoice-verifications/:id` route:
```jsx
<Route
  path="procurement/accounts/blocked-ivs"
  element={<BlockedIVListPage />}
/>
```

After the `procurement/gate-entries/:id` route:
```jsx
<Route
  path="procurement/gate-exits/inbound/:id"
  element={<GateExitInboundDetailPage />}
/>
```

---

## GateEntryDetailPage.jsx — Modification

The existing `GateEntryDetailPage.jsx` already handles `createGateExitInbound()`. After a successful gate exit creation, it must navigate to the new detail page.

**Current behaviour (assumed):** After creating the gate exit, user stays on gate entry page or gets a toast.

**Required change:** After `createGateExitInbound()` resolves successfully, call:
```js
openScreen(OPERATION_SCREENS.PROC_GATE_EXIT_INBOUND_DETAIL.screen_code);
navigate(`/dashboard/procurement/gate-exits/inbound/${result.id}`);
```

If the page already shows a link/section for the linked gate exit (using `getGateExitInbound`), also add a clickable link in that section that opens the detail page.

---

## Page Specifications

### 1. DebitNoteListPage.jsx

**API call:** `listDebitNotes(params)` → returns `{ items: [...] }`

**Params supported:** `company_id`, `vendor_id`, `status`, `limit` (default 50)

**Columns to show:**
| Column | Field |
|---|---|
| DN Number | `dn_number` |
| Date | `dn_date` |
| Vendor | `vendor_id` (show as-is or resolve vendor name if vendor list is cached) |
| RTV | `rtv_id` |
| Total Value | `total_value` (formatted number, right-aligned) |
| Status | `status` — badge with colour |
| Created | `created_at` |

**Status badge colours:**
- `DRAFT` → amber
- `SENT` → sky
- `ACKNOWLEDGED` → violet
- `SETTLED` → emerald

**Filter bar:** Status filter (All / DRAFT / SENT / ACKNOWLEDGED / SETTLED)

**On row click:** `openScreen("PROC_DEBIT_NOTE_DETAIL")` then `navigate(/dashboard/procurement/debit-notes/${row.id})`

**Pattern:** Follow `RTVListPage.jsx` (same folder). Use `ErpMasterListTemplate`, `ErpDenseGrid`, `ErpPaginationStrip`, `useMenu`.

---

### 2. DebitNoteDetailPage.jsx

**URL param:** `id` from path (`/dashboard/procurement/debit-notes/:id`)

**API calls:**
- `getDebitNote(id)` → returns debit note object
- `markDebitNoteSent(id)` → POST, returns updated object
- `acknowledgeDebitNote(id)` → POST, returns updated object
- `settleDebitNote(id)` → POST, returns updated object

**Debit note fields:**
```
id, dn_number, dn_date, company_id, vendor_id, rtv_id
material_value, freight_amount, insurance_amount, customs_duty_amount
cha_charges_amount, loading_charges, unloading_charges, other_charges
total_value, status, remarks
sent_at, acknowledged_at, settled_at, created_at, last_updated_at
```

**Layout:**
- Header: DN Number + Status badge + Date
- Info row: Vendor | Company | Linked RTV (clickable → `openScreen("PROC_RTV_DETAIL")` + navigate)
- Value breakdown section (read-only grid or card):
  - Material Value
  - Freight Amount
  - Insurance Amount
  - Customs Duty
  - CHA Charges
  - Loading Charges
  - Unloading Charges
  - Other Charges
  - **Total Value** (bold/highlighted)
- Lifecycle timestamps: Sent At | Acknowledged At | Settled At (show "—" if null)
- Remarks field (read-only display)

**Action buttons** (show based on status):
| Status | Available Actions |
|---|---|
| `DRAFT` | **Mark Sent** |
| `SENT` | **Acknowledge** |
| `ACKNOWLEDGED` | **Settle** |
| `SETTLED` | *(no actions)* |

Each action: confirm dialog → call API → reload page data on success.

**Back navigation:** `openScreen("PROC_DEBIT_NOTE_LIST")` + navigate to `/dashboard/procurement/debit-notes`

**Pattern:** Follow `RTVDetailPage.jsx`.

---

### 3. ExchangeRefListPage.jsx

**API call:** `listExchangeRefs(params)` → returns `{ items: [...] }`

**Params supported:** `company_id`, `rtv_id`, `status`, `limit` (default 50)

**Columns to show:**
| Column | Field |
|---|---|
| Ref Number | `exchange_ref_number` |
| Vendor | `vendor_id` |
| Linked RTV | `rtv_id` |
| Replacement GRN | `replacement_grn_id` (show "—" if null) |
| Status | `status` — badge |
| Created | `created_at` |

**Status badge colours:**
- `RETURN_DISPATCHED` → sky
- `REPLACEMENT_RECEIVED` → emerald

**Inline action — "Link Replacement GRN":**
- Show button on rows where status = `RETURN_DISPATCHED`
- Clicking opens a small inline modal/popover with:
  - Input: Replacement GRN ID (text input)
  - Submit calls `linkReplacementGRN(row.id, { replacement_grn_id: value })`
  - On success: reload list
- API function: `linkReplacementGRN(id, data)` — already exists in `procurementApi.js`

**No separate detail page** — there is no `getExchangeRef` backend handler.

**On row click (non-action click):** Navigate to linked RTV detail: `openScreen("PROC_RTV_DETAIL")` + navigate to `/dashboard/procurement/rtvs/${row.rtv_id}`

**Pattern:** Follow `RTVListPage.jsx`. Use `ErpMasterListTemplate`, `ErpDenseGrid`, `useMenu`.

---

### 4. BlockedIVListPage.jsx

**API call:** `listBlockedIVs(params)` → returns `{ items: [...] }` — returns IV records where status=BLOCKED

**Params supported:** `company_id`, `limit` (default 50)

**Columns to show:**
| Column | Field |
|---|---|
| IV Number | `iv_number` |
| Invoice No | `invoice_number` |
| Invoice Date | `invoice_date` |
| Vendor | `vendor_id` |
| Invoice Value | `invoice_value` (formatted number) |
| Matched Value | `matched_value` (formatted number) |
| Block Reason | `block_reason` |
| Created | `created_at` |

**Status badge:** All rows are BLOCKED — show a single BLOCKED badge in a header/description text, or add a BLOCKED chip in each row if the field is present.

**On row click:** `openScreen("PROC_IV_DETAIL")` + navigate to `/dashboard/procurement/accounts/invoice-verifications/${row.id}`

**No actions** on this page — it is a read-only filtered view of blocked IVs. The user navigates to the full IV detail page to take action.

**Pattern:** Follow `IVListPage.jsx` at `frontend/src/pages/dashboard/procurement/accounts/IVListPage.jsx`. Use `ErpMasterListTemplate`, `ErpDenseGrid`.

---

### 5. GateExitInboundDetailPage.jsx

**URL param:** `id` from path (`/dashboard/procurement/gate-exits/inbound/:id`)

**API call:** `getGateExitInbound(id)` → returns gate exit object + `effective_net_weight` (virtual)

**Gate exit fields:**
```
id, exit_number, exit_date, exit_time
company_id, plant_id, gate_entry_id
vehicle_number, driver_name, gate_staff_id
rst_number_tare, tare_weight, net_weight_calculated, net_weight_override
effective_net_weight  (virtual: net_weight_override ?? net_weight_calculated)
remarks, created_at
```

**Layout:**
- Header: Exit Number + Exit Date
- Info row: Vehicle Number | Driver Name | Gate Staff ID
- Weights section (read-only cards):
  - RST Number (Tare) — `rst_number_tare`
  - Tare Weight — `tare_weight`
  - Net Weight (Calculated) — `net_weight_calculated`
  - Net Weight (Override) — `net_weight_override` (show "—" if null)
  - **Effective Net Weight** — `effective_net_weight` (bold, highlighted)
- Remarks (show "—" if null)
- Linked Gate Entry link: `openScreen("PROC_GATE_ENTRY_DETAIL")` + navigate to `/dashboard/procurement/gate-entries/${gate_entry_id}`

**No actions on this page** — gate exit inbound is immutable once created.

**Back navigation:** `openScreen("PROC_GATE_ENTRY_DETAIL")` + navigate to `/dashboard/procurement/gate-entries/${data.gate_entry_id}`

**Pattern:** Follow `GateEntryDetailPage.jsx` for structure/layout.

---

## Critical Rules — Apply to All 5 Pages

1. **Always `openScreen()` before `navigate()`** — every programmatic navigation must call `openScreen(screenCode)` first, then `navigate(path)`. Import both from the correct paths:
   ```js
   import { openScreen } from "../../../../navigation/screenStackEngine.js";
   import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
   ```

2. **Import API functions from `procurementApi.js`** — all needed API functions already exist, do not re-declare them:
   ```js
   import { listDebitNotes, getDebitNote, markDebitNoteSent, acknowledgeDebitNote, settleDebitNote } from "../procurementApi.js";
   import { listExchangeRefs, linkReplacementGRN } from "../procurementApi.js";
   import { listBlockedIVs } from "../procurementApi.js";
   import { getGateExitInbound } from "../procurementApi.js";
   ```
   Relative paths will differ by folder depth — adjust as needed.

3. **useMenu hook** — call `const { setActiveScreen } = useMenu()` and set active screen on mount.

4. **Error handling** — show user-friendly error message if API call fails. Do not crash silently.

5. **Loading state** — show loading spinner/skeleton while fetching. All 5 pages fetch on mount.

6. **No new procurementApi.js functions needed** — all API calls already exist.

7. **No new DB migrations needed** — all tables already exist.

8. **No new BE handlers needed** — all handlers already deployed.

---

## File-ID Convention

Use these File-IDs in the file header comments:

| File | File-ID |
|---|---|
| DebitNoteListPage.jsx | 21.1 |
| DebitNoteDetailPage.jsx | 21.2 |
| ExchangeRefListPage.jsx | 21.3 |
| BlockedIVListPage.jsx | 21.4 |
| GateExitInboundDetailPage.jsx | 21.5 |

---

## After Implementation

Update `OM-IMPLEMENTATION-LOG.md`:
- Gate-21 items 21.1–21.5 → DONE
