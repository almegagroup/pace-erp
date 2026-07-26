# PACE ERP — UI Patterns Reference

এই file এ PACE ERP এর সব reusable UI patterns documented আছে। নতুন page বানানোর আগে এখান থেকে correct pattern বেছে নাও।

---

## Pattern 1 — SAP Selection Screen (Criteria-First Query Pages)

**SAP equivalent:** VA05, MB52, MB51, ME2M, CO03, COID

### কখন use করবে

যেসব page এ:
- User কে আগে criteria দিতে হয় (date range, company, plant, material) — তারপর data আসবে
- Criteria ছাড়া load করলে potentially বড় result set আসতে পারে
- "এই screen এ গেলে কী দেখাবে?" এর জবাব "depends on what you want to see" — তাহলে selection screen pattern

| Page type | উদাহরণ |
|-----------|--------|
| Stock reports | Stock Ledger, MMBE, Valuation Report |
| Movement reports | Stock Movement History, Document Flow |
| Production PO lookup | Process PO list (COID equivalent) |
| Planning views | Procurement Planning, Production Plan Feed |
| Physical Inventory | PID document list |
| Financial reports | Period Costing, Weighted Avg Report |

**Auto-load ঠিক আছে (selection screen দরকার নেই):**
GE Register, PO Register, GRN Register, CSN Register — এগুলো company-scoped + server-side paginated, always-visible filter strip দিয়ে চলে।

---

### State Machine

```
[CRITERIA state]
  → User fills criteria
  → Presses F8 or "Execute" button
[RESULTS state]
  → Data loads and displays
  → User presses "Change Criteria" or ESC
[CRITERIA state again]
```

State: `"CRITERIA" | "RESULTS"` — simple string, not a router change.

---

### Component Structure

```jsx
// ErpSelectionScreen — reusable wrapper
// Props:
//   criteriaForm: ReactNode — the form content
//   onExecute: () => void — called when F8/Execute clicked
//   resultsSection: ReactNode — shown in RESULTS state
//   isLoading: boolean
//   onChangeCriteria: () => void — shown as button in RESULTS state

import { useState, useEffect, useCallback } from "react";

export default function ErpSelectionScreen({
  title,
  criteriaForm,
  onExecute,
  resultsSection,
  isLoading,
}) {
  const [mode, setMode] = useState("CRITERIA"); // "CRITERIA" | "RESULTS"

  // F8 shortcut
  useEffect(() => {
    function handleKey(e) {
      if (e.key === "F8") { e.preventDefault(); handleExecute(); }
      if (e.key === "Escape" && mode === "RESULTS") setMode("CRITERIA");
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [mode]);

  function handleExecute() {
    onExecute();
    setMode("RESULTS");
  }

  if (mode === "CRITERIA") {
    return (
      <div className="...">
        <div className="eyebrow">{title}</div>
        {criteriaForm}
        <button onClick={handleExecute}>Execute (F8)</button>
      </div>
    );
  }

  return (
    <div className="...">
      <button onClick={() => setMode("CRITERIA")}>← Change Criteria</button>
      {isLoading ? <Spinner /> : resultsSection}
    </div>
  );
}
```

---

### Usage Example (Stock Ledger page)

```jsx
export default function StockLedgerPage() {
  const [criteria, setCriteria] = useState({ companyId: "", materialId: "", dateFrom: "", dateTo: "" });
  const [executeParams, setExecuteParams] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["stock-ledger", executeParams],
    enabled: Boolean(executeParams),
    queryFn: () => fetchStockLedger(executeParams),
  });

  return (
    <ErpSelectionScreen
      title="Stock Ledger"
      criteriaForm={<StockLedgerCriteriaForm value={criteria} onChange={setCriteria} />}
      onExecute={() => setExecuteParams({ ...criteria })}
      isLoading={isLoading}
      resultsSection={<StockLedgerResults rows={data?.rows ?? []} />}
    />
  );
}
```

**Key points:**
- `executeParams` starts as `null` → `enabled: false` → no fetch on mount
- `onExecute` snapshot করে criteria → triggers fetch
- Back navigation (useQuery cache) → instant re-render without refetch

---

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **F8** | Execute (from criteria screen) |
| **ESC** | Change Criteria (from results screen) |

---

### Criteria Form Guidelines

- Mandatory fields: highlight with `*` label
- Default values: company = user's current company, dates = current month
- Tab order: company → plant → material → date from → date to → Execute button
- Execute button: `tone="primary"`, label = "Execute (F8)"
- "Change Criteria" button in results header: `tone="neutral"`, always visible

---

## Pattern 2 — Master List with Inline Filter (Register Pages)

GE Register, PO Register, GRN Register, CSN Register এর জন্য।

**Rules:**
- `useQuery` mandatory — no `useEffect` + `setState`
- Server-side pagination: `limit` + `offset`, backend returns `{ items, total }`
- Filter strip always visible (company, status, date range, quick search)
- Keyboard nav on rows: ↑↓ focus, Enter = open detail
- `ErpDenseGrid` component use করো

---

## Pattern 3 — Detail Page with Action Bar

GE Detail, GRN Detail, PO Detail এর জন্য।

**Rules:**
- `useQuery` mandatory
- Action buttons (Prune, Cancel, Approve, etc.): `openActionConfirm` দিয়ে confirm করো
- After mutation: `queryClient.setQueryData(key, result)` — no refetch
- Status badge: top-right, color-coded
- Never show raw UUID in any field

---

*Last updated: 2026-07-08*
