# Codex Task Brief — STO/PO Parity Follow-up Fixes

Two confirmed bugs found while reviewing the STO/PO approval parity work (commit `90601e8` and follow-ups). Root cause for both already identified — implement the fixes below.

---

## Bug 1 — Order Approvals page loses filter state on back-navigation (missing `openScreen()`)

**File:** `frontend/src/pages/dashboard/procurement/po/POOrderGroupListPage.jsx`

**Root cause:** `openDetail()` only calls react-router's `navigate()` — it never calls `openScreen()` from `screenStackEngine.js`. Every other working list page in this module (`STOListPage.jsx`, `PlantTransferListPage.jsx`, etc.) calls both `openScreen(...)` and `navigate(...)` together when drilling into a detail page. The custom screen-stack engine tracks "active screen" via `openScreen`/`pushScreen`, not via the router. Because `openDetail()` skips it, the stack never registers that a new screen was pushed — when the user navigates back from the STO/PO detail page, `POOrderGroupListPage` remounts fresh and its local `useState("PENDING_APPROVAL")` filter resets, discarding whatever tab (e.g. `DRAFT`) the user had selected. This is the exact bug the user reported: "double click korle ota pending tab e chole jachhe."

**Current code:**
```js
function openDetail(row) {
  if (String(row?.doc_type || "").toUpperCase() === "STO") {
    navigate(`/dashboard/procurement/stos/${encodeURIComponent(row.id)}`);
    return;
  }
  navigate(`/dashboard/procurement/po-order-groups/${encodeURIComponent(row.id)}`);
}
```

**Fix:** Import `openScreenWithContext` (preferred over plain `openScreen`, since it also supports `refreshOnReturn` so this list can optionally refresh when the user comes back after approving/rejecting) from `../../../../navigation/screenStackEngine.js`, and the relevant screen codes from `OPERATION_SCREENS` (`PROC_STO_DETAIL` and the PO order-group detail screen code — check `operationScreens.js` for the exact key, likely `PROC_PO_ORDER_GROUP_DETAIL` or similar — confirm before using). Reference pattern from `STOListPage.jsx`:
```js
function openDetail(row) {
  openScreenWithContext(OPERATION_SCREENS.PROC_STO_DETAIL.screen_code, { id: row.id }, { refreshOnReturn: true });
  navigate(`/dashboard/procurement/stos/${encodeURIComponent(row.id)}`);
}
```
Apply the equivalent for the PO branch using the correct PO order-group detail screen code.

**Important — systemic check, not just this one file:** This same bug class (`navigate()` called without a paired `openScreen()`/`openScreenWithContext()`) may exist in other pages touched during the STO/PO parity and Gate-27 prep work. Grep the `frontend/src/pages/dashboard/procurement/` tree for `navigate(\`/dashboard/procurement` call sites and verify each one is paired with an `openScreen`/`openScreenWithContext`/`pushScreen` call immediately before it, matching the working reference pattern in `STOListPage.jsx`. Fix any other occurrences found — do not limit the fix to just `POOrderGroupListPage.jsx`.

---

## Bug 2 — STO Detail page shows raw UUIDs for Cost Center and Payment Term

**File:** `frontend/src/pages/dashboard/procurement/sto/STODetailPage.jsx`

**Root cause:** The header section renders `detail.sending_cost_center_id` / `detail.receiving_cost_center_id` directly (lines ~559-560), and the Transfer Lines grid renders `row.payment_term_id` directly (line ~589) — both raw UUIDs, never resolved to a human label. This is the same display-name gap that was already fixed for Material (`materialMap`, built from `useMaterialOptionsQuery`) — Cost Center and Payment Term never got the same treatment.

**Good news — no backend change needed.** This component already fetches the data required to resolve both:
- `sendingCostCenterQuery` / `receivingCostCenterQuery` (via `useCostCentersQuery`, scoped to `detail.sending_company_id` / `detail.receiving_company_id`) — already used to build `sendingCostCenterOptions` / `receivingCostCenterOptions` for the Edit modal's dropdowns.
- `paymentTermQuery` (via `usePaymentTermOptionsQuery`) — already used to build `paymentTermOptions` for the Edit modal.

**Fix:** Build two lookup maps the same way `materialMap` is built (around line 154-157):
```js
const sendingCostCenterMap = useMemo(
  () => new Map((sendingCostCenterQuery.data?.data ?? []).map((entry) => [entry.id, `${entry.cost_center_code || entry.id} | ${entry.cost_center_name || entry.name || ""}`])),
  [sendingCostCenterQuery.data?.data]
);
const receivingCostCenterMap = useMemo(
  () => new Map((receivingCostCenterQuery.data?.data ?? []).map((entry) => [entry.id, `${entry.cost_center_code || entry.id} | ${entry.cost_center_name || entry.name || ""}`])),
  [receivingCostCenterQuery.data?.data]
);
const paymentTermMap = useMemo(
  () => new Map(paymentTerms.map((entry) => [entry.id, `${entry.code || entry.name} | ${entry.name}`])),
  [paymentTerms]
);
```
Then replace the raw-ID renders:
```jsx
<ErpFieldPreview label="Sending Cost Center" value={sendingCostCenterMap.get(detail.sending_cost_center_id) || detail.sending_cost_center_id || "—"} />
<ErpFieldPreview label="Receiving Cost Center" value={receivingCostCenterMap.get(detail.receiving_cost_center_id) || detail.receiving_cost_center_id || "—"} />
```
and in the lines grid column:
```js
{ key: "payment_term_id", label: "Payment Term", render: (row) => paymentTermMap.get(row.payment_term_id) || row.payment_term_id || "—" },
```

**Also check:** `PODetailPage.jsx` for the identical pattern (raw `sending_cost_center_id`/`receiving_cost_center_id`/`payment_term_id` display) — if present there too, fix it the same way for parity. Do not introduce divergence between PO and STO detail pages.

---

## Verification checklist (after implementing)
1. `npx eslint` on every changed file — zero new errors.
2. `npx vite build` — must succeed.
3. Manually trace: open Pending Order Approvals page → switch to DRAFT tab → double-click an STO row → use Back/ESC → confirm the DRAFT tab is still selected (not reset to PENDING_APPROVAL).
4. Open any existing STO detail page and confirm Sending/Receiving Cost Center and the line Payment Term column show readable labels, not UUIDs.
5. Re-run the same structural-integrity check used throughout this session (`total line count` vs `last top-level closing brace line`) on every file touched, to rule out the "code stranded after closing brace" bug class that has recurred multiple times this session.

Commit message should end with `Co-Authored-By: Codex <noreply@openai.com>`.
