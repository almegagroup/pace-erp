# CODEX-GATE25-TASK-BRIEF

**Gate:** 25
**Domain:** PROCUREMENT
**Title:** Document Flow Section
**Dependency:** Gate-24 VERIFIED
**Scope:** One backend handler that resolves the full document chain for any procurement document type, one reusable FE component, and a one-line addition to 10 existing detail pages.

---

## Files to Create

| File-ID | Path | Type |
|---|---|---|
| 25.1 | `supabase/functions/api/_core/procurement/document_flow.handlers.ts` | Backend handler |
| 25.2 | `frontend/src/pages/dashboard/procurement/DocumentFlowSection.jsx` | FE component |

## Files to Modify

| File | Change |
|---|---|
| `supabase/functions/api/_routes/procurement.routes.ts` | Import handler + 1 switch case |
| `frontend/src/pages/dashboard/procurement/procurementApi.js` | Append `getDocumentFlow` function |
| `frontend/src/pages/dashboard/procurement/po/PODetailPage.jsx` | Add `<DocumentFlowSection>` |
| `frontend/src/pages/dashboard/procurement/grn/GRNDetailPage.jsx` | Add `<DocumentFlowSection>` |
| `frontend/src/pages/dashboard/procurement/qa/QADocumentPage.jsx` | Add `<DocumentFlowSection>` |
| `frontend/src/pages/dashboard/procurement/sto/STODetailPage.jsx` | Add `<DocumentFlowSection>` |
| `frontend/src/pages/dashboard/procurement/rtv/RTVDetailPage.jsx` | Add `<DocumentFlowSection>` |
| `frontend/src/pages/dashboard/procurement/accounts/IVDetailPage.jsx` | Add `<DocumentFlowSection>` |
| `frontend/src/pages/dashboard/procurement/accounts/LandedCostDetailPage.jsx` | Add `<DocumentFlowSection>` |
| `frontend/src/pages/dashboard/procurement/sales/SODetailPage.jsx` | Add `<DocumentFlowSection>` |
| `frontend/src/pages/dashboard/procurement/sales/SalesInvoiceDetailPage.jsx` | Add `<DocumentFlowSection>` |
| `frontend/src/pages/dashboard/procurement/inventory/PIDocumentDetailPage.jsx` | Add `<DocumentFlowSection>` |

**No new migrations. No new screen codes. No new AppRouter routes.**

---

## Critical Rules

1. **serviceRoleClient only** for all DB queries.
2. **okResponse / errorResponse** from `../response.ts`.
3. **All tables are in `erp_procurement` schema** — use `.schema("erp_procurement")` on every query.
4. **Deduplication** — use a `Set<string>` of `"doc_type:id"` keys to prevent the same document appearing twice in the result.
5. **Never throw** if a linked document isn't found — just skip it (the document may have been deleted or the FK is nullable).
6. **File-ID header** required on every new file.
7. **openScreen before navigate** — in DocumentFlowSection, always call `openScreen(screenCode)` before `navigate(path)`.
8. **procurementApi.js** — append `getDocumentFlow` at the end of the file.
9. **Import path** for DocumentFlowSection in all 10 detail pages is `"../DocumentFlowSection.jsx"` (they are all in one-level subfolders of `procurement/`).

---

## 25.1 — Backend: `document_flow.handlers.ts`

### File header
```typescript
/*
 * File-ID: 25.1
 * File-Path: supabase/functions/api/_core/procurement/document_flow.handlers.ts
 * Gate: 25
 * Phase: 25
 * Domain: PROCUREMENT
 * Purpose: Resolve full document chain for any procurement document type.
 * Authority: Backend
 */
```

### Imports and types
```typescript
import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";

type DocFlowHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

type FlowNode = {
  doc_type: string;
  id: string;
  doc_number: string;
  status: string;
  date: string | null;
  is_current: boolean;
};
```

### Document metadata table
```typescript
// Maps doc_type → { table name, number column, date column, SELECT string }
const DOC_META: Record<string, { table: string; select: string; numberCol: string; dateCol: string }> = {
  PO:            { table: "purchase_order",            select: "id, po_number, status, order_date",           numberCol: "po_number",           dateCol: "order_date" },
  CSN:           { table: "consignment_note",           select: "id, csn_number, status, gate_entry_date",     numberCol: "csn_number",           dateCol: "gate_entry_date" },
  GATE_ENTRY:    { table: "gate_entry",                 select: "id, ge_number, status, ge_date",              numberCol: "ge_number",            dateCol: "ge_date" },
  GRN:           { table: "goods_receipt",              select: "id, grn_number, status, posting_date",        numberCol: "grn_number",           dateCol: "posting_date" },
  QA:            { table: "inward_qa_document",         select: "id, qa_number, status, qa_created_at",        numberCol: "qa_number",            dateCol: "qa_created_at" },
  IV:            { table: "invoice_verification",       select: "id, iv_number, status, vendor_invoice_date",  numberCol: "iv_number",            dateCol: "vendor_invoice_date" },
  LANDED_COST:   { table: "landed_cost",                select: "id, lc_number, status, created_at",           numberCol: "lc_number",            dateCol: "created_at" },
  RTV:           { table: "return_to_vendor",           select: "id, rtv_number, status, created_at",          numberCol: "rtv_number",           dateCol: "created_at" },
  DEBIT_NOTE:    { table: "debit_note",                 select: "id, debit_note_number, status, created_at",   numberCol: "debit_note_number",    dateCol: "created_at" },
  STO:           { table: "stock_transfer_order",       select: "id, sto_number, status, created_at",          numberCol: "sto_number",           dateCol: "created_at" },
  SO:            { table: "sales_order",                select: "id, so_number, status, order_date",           numberCol: "so_number",            dateCol: "order_date" },
  SALES_INVOICE: { table: "sales_invoice",              select: "id, invoice_number, status, invoice_date",    numberCol: "invoice_number",       dateCol: "invoice_date" },
  PID:           { table: "physical_inventory_document",select: "id, pi_number, status, count_date",           numberCol: "pi_number",            dateCol: "count_date" },
};

// Natural display order — nodes will be sorted by this sequence
const NATURAL_ORDER = [
  "PO", "CSN", "STO", "GATE_ENTRY", "GRN", "QA",
  "IV", "LANDED_COST", "RTV", "DEBIT_NOTE",
  "SO", "SALES_INVOICE", "PID",
];
```

### Helper functions
```typescript
type RawRow = Record<string, unknown>;

function buildNode(row: RawRow, docType: string, isCurrent: boolean): FlowNode {
  const meta = DOC_META[docType];
  if (!meta) throw new Error(`Unknown doc_type: ${docType}`);
  const dateRaw = row[meta.dateCol];
  return {
    doc_type: docType,
    id: String(row.id),
    doc_number: String(row[meta.numberCol] ?? ""),
    status: String(row.status ?? ""),
    date: dateRaw != null ? String(dateRaw).slice(0, 10) : null,
    is_current: isCurrent,
  };
}

async function fetchOne(table: string, id: string): Promise<RawRow | null> {
  const meta = DOC_META[table]; // table is doc_type key here
  if (!meta) return null;
  const { data } = await serviceRoleClient
    .schema("erp_procurement")
    .from(meta.table)
    .select(meta.select)
    .eq("id", id)
    .maybeSingle();
  return data as RawRow | null;
}

async function fetchMany(
  docType: string,
  filter: { column: string; value: string | string[] },
): Promise<RawRow[]> {
  const meta = DOC_META[docType];
  if (!meta) return [];
  const ids = Array.isArray(filter.value) ? filter.value : null;
  const single = Array.isArray(filter.value) ? null : filter.value;
  if (ids !== null && ids.length === 0) return [];
  let q = serviceRoleClient
    .schema("erp_procurement")
    .from(meta.table)
    .select(meta.select);
  if (ids !== null) {
    q = q.in(filter.column, ids);
  } else if (single !== null) {
    q = q.eq(filter.column, single);
  }
  const { data } = await q;
  return (data ?? []) as RawRow[];
}

// Fetch iv_ids linked to one or more grn_ids via invoice_verification_line
async function fetchIvIdsForGrns(grnIds: string[]): Promise<string[]> {
  if (!grnIds.length) return [];
  const { data } = await serviceRoleClient
    .schema("erp_procurement")
    .from("invoice_verification_line")
    .select("iv_id")
    .in("grn_id", grnIds);
  return [...new Set((data ?? []).map((r: RawRow) => String(r.iv_id)))];
}

// Fetch gate_entry_line rows for a gate entry to extract csn_ids and po_ids
async function fetchGateEntryLineRefs(geId: string): Promise<{ csnIds: string[]; poIds: string[] }> {
  const { data } = await serviceRoleClient
    .schema("erp_procurement")
    .from("gate_entry_line")
    .select("csn_id, po_id")
    .eq("gate_entry_id", geId);
  const rows = (data ?? []) as RawRow[];
  const csnIds = [...new Set(rows.map(r => r.csn_id).filter(Boolean).map(String))];
  const poIds  = [...new Set(rows.map(r => r.po_id).filter(Boolean).map(String))];
  return { csnIds, poIds };
}

function sortNodes(nodes: FlowNode[]): FlowNode[] {
  return [...nodes].sort((a, b) => {
    const ai = NATURAL_ORDER.indexOf(a.doc_type);
    const bi = NATURAL_ORDER.indexOf(b.doc_type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

// Add a node to the collector, deduplicating by doc_type:id
function addNode(
  collector: FlowNode[],
  seen: Set<string>,
  row: RawRow,
  docType: string,
  isCurrent: boolean,
): void {
  const key = `${docType}:${row.id}`;
  if (seen.has(key)) return;
  seen.add(key);
  collector.push(buildNode(row, docType, isCurrent));
}

function addMany(
  collector: FlowNode[],
  seen: Set<string>,
  rows: RawRow[],
  docType: string,
): void {
  for (const row of rows) {
    addNode(collector, seen, row, docType, false);
  }
}
```

### Main handler
```typescript
export async function getDocumentFlowHandler(
  req: Request,
  ctx: DocFlowHandlerContext,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const docType = String(url.searchParams.get("doc_type") ?? "").toUpperCase().trim();
    const id = String(url.searchParams.get("id") ?? "").trim();

    if (!docType || !id) {
      return errorResponse(
        "DOCUMENT_FLOW_PARAMS_REQUIRED",
        "doc_type and id are required.",
        ctx.request_id,
        "NONE",
        400,
        {},
        req,
      );
    }

    if (!DOC_META[docType]) {
      return errorResponse(
        "DOCUMENT_FLOW_UNKNOWN_TYPE",
        `Unknown doc_type: ${docType}`,
        ctx.request_id,
        "NONE",
        400,
        {},
        req,
      );
    }

    const nodes: FlowNode[] = [];
    const seen = new Set<string>();

    await resolveChain(docType, id, nodes, seen);

    return okResponse({ data: sortNodes(nodes) }, ctx.request_id, req);
  } catch (err) {
    const code = err instanceof Error ? err.message : "DOCUMENT_FLOW_FAILED";
    return errorResponse(code, "Unable to resolve document flow.", ctx.request_id, "NONE", 500, {}, req);
  }
}
```

### Chain resolution function — `resolveChain`

This is the core of the handler. Implement as a `switch` on `docType`:

```typescript
async function resolveChain(
  docType: string,
  id: string,
  nodes: FlowNode[],
  seen: Set<string>,
): Promise<void> {
  switch (docType) {

    // ─── PO ────────────────────────────────────────────────────────────────────
    case "PO": {
      const po = await fetchOne("PO", id);
      if (!po) return;
      addNode(nodes, seen, po, "PO", true);

      // Forward: CSNs, GRNs, IVs, LCs, RTVs
      const [csns, grns, ivs, lcs, rtvs] = await Promise.all([
        fetchMany("CSN",         { column: "po_id", value: id }),
        fetchMany("GRN",         { column: "po_id", value: id }),
        fetchMany("IV",          { column: "po_id", value: id }),
        fetchMany("LANDED_COST", { column: "po_id", value: id }),
        fetchMany("RTV",         { column: "po_id", value: id }),
      ]);
      addMany(nodes, seen, csns, "CSN");
      addMany(nodes, seen, grns, "GRN");
      addMany(nodes, seen, ivs, "IV");
      addMany(nodes, seen, lcs, "LANDED_COST");
      addMany(nodes, seen, rtvs, "RTV");

      // Gate entries from GRNs
      const geIds = grns.map(g => String(g.gate_entry_id)).filter(Boolean);
      if (geIds.length) {
        addMany(nodes, seen, await fetchMany("GATE_ENTRY", { column: "id", value: geIds }), "GATE_ENTRY");
      }

      // QA docs from GRNs
      const grnIds = grns.map(g => String(g.id));
      if (grnIds.length) {
        addMany(nodes, seen, await fetchMany("QA", { column: "grn_id", value: grnIds }), "QA");
      }

      // Debit notes from RTVs
      const rtvIds = rtvs.map(r => String(r.id));
      if (rtvIds.length) {
        addMany(nodes, seen, await fetchMany("DEBIT_NOTE", { column: "rtv_id", value: rtvIds }), "DEBIT_NOTE");
      }
      break;
    }

    // ─── CSN ───────────────────────────────────────────────────────────────────
    case "CSN": {
      const csn = await fetchOne("CSN", id);
      if (!csn) return;
      addNode(nodes, seen, csn, "CSN", true);

      // Backward: PO
      if (csn.po_id) {
        const po = await fetchOne("PO", String(csn.po_id));
        if (po) addNode(nodes, seen, po, "PO", false);
      }

      // Forward: Gate Entry (gate_entry_id on CSN), GRN (grn_id on CSN)
      if (csn.gate_entry_id) {
        const ge = await fetchOne("GATE_ENTRY", String(csn.gate_entry_id));
        if (ge) addNode(nodes, seen, ge, "GATE_ENTRY", false);
      }
      if (csn.grn_id) {
        const grn = await fetchOne("GRN", String(csn.grn_id));
        if (grn) {
          addNode(nodes, seen, grn, "GRN", false);
          const grnId = String(grn.id);
          const [qaRows, ivIds, lcRows, rtvRows] = await Promise.all([
            fetchMany("QA",          { column: "grn_id", value: grnId }),
            fetchIvIdsForGrns([grnId]),
            fetchMany("LANDED_COST", { column: "grn_id", value: grnId }),
            fetchMany("RTV",         { column: "grn_id", value: grnId }),
          ]);
          addMany(nodes, seen, qaRows, "QA");
          if (ivIds.length) addMany(nodes, seen, await fetchMany("IV", { column: "id", value: ivIds }), "IV");
          addMany(nodes, seen, lcRows, "LANDED_COST");
          addMany(nodes, seen, rtvRows, "RTV");
          const rtvIds = rtvRows.map(r => String(r.id));
          if (rtvIds.length) addMany(nodes, seen, await fetchMany("DEBIT_NOTE", { column: "rtv_id", value: rtvIds }), "DEBIT_NOTE");
        }
      }
      // Also: LCs linked directly to this CSN
      addMany(nodes, seen, await fetchMany("LANDED_COST", { column: "csn_id", value: id }), "LANDED_COST");
      break;
    }

    // ─── GATE_ENTRY ────────────────────────────────────────────────────────────
    case "GATE_ENTRY": {
      const ge = await fetchOne("GATE_ENTRY", id);
      if (!ge) return;
      addNode(nodes, seen, ge, "GATE_ENTRY", true);

      // Upstream: CSNs and POs from gate_entry_line
      const { csnIds, poIds } = await fetchGateEntryLineRefs(id);
      const [csns, pos] = await Promise.all([
        csnIds.length ? fetchMany("CSN", { column: "id", value: csnIds }) : Promise.resolve([]),
        poIds.length  ? fetchMany("PO",  { column: "id", value: poIds  }) : Promise.resolve([]),
      ]);
      addMany(nodes, seen, csns, "CSN");
      addMany(nodes, seen, pos, "PO");

      // Forward: GRNs
      const grns = await fetchMany("GRN", { column: "gate_entry_id", value: id });
      addMany(nodes, seen, grns, "GRN");

      const grnIds = grns.map(g => String(g.id));
      if (grnIds.length) {
        const [qaRows, ivIds, lcRows, rtvRows] = await Promise.all([
          fetchMany("QA",          { column: "grn_id", value: grnIds }),
          fetchIvIdsForGrns(grnIds),
          fetchMany("LANDED_COST", { column: "grn_id", value: grnIds }),
          fetchMany("RTV",         { column: "grn_id", value: grnIds }),
        ]);
        addMany(nodes, seen, qaRows, "QA");
        if (ivIds.length) addMany(nodes, seen, await fetchMany("IV", { column: "id", value: ivIds }), "IV");
        addMany(nodes, seen, lcRows, "LANDED_COST");
        addMany(nodes, seen, rtvRows, "RTV");
        const rtvIds = rtvRows.map(r => String(r.id));
        if (rtvIds.length) addMany(nodes, seen, await fetchMany("DEBIT_NOTE", { column: "rtv_id", value: rtvIds }), "DEBIT_NOTE");
      }
      break;
    }

    // ─── GRN ───────────────────────────────────────────────────────────────────
    case "GRN": {
      const grn = await fetchOne("GRN", id);
      if (!grn) return;
      addNode(nodes, seen, grn, "GRN", true);

      // Backward: Gate Entry, PO or STO
      const [ge, po, sto, csns] = await Promise.all([
        grn.gate_entry_id ? fetchOne("GATE_ENTRY", String(grn.gate_entry_id)) : Promise.resolve(null),
        grn.po_id         ? fetchOne("PO",          String(grn.po_id))         : Promise.resolve(null),
        grn.sto_id        ? fetchOne("STO",          String(grn.sto_id))        : Promise.resolve(null),
        fetchMany("CSN", { column: "grn_id", value: id }),
      ]);
      if (ge) addNode(nodes, seen, ge, "GATE_ENTRY", false);
      if (po) addNode(nodes, seen, po, "PO", false);
      if (sto) addNode(nodes, seen, sto, "STO", false);
      addMany(nodes, seen, csns, "CSN");

      // Forward: QA, IV, LC, RTV
      const [qaRows, ivIds, lcRows, rtvRows] = await Promise.all([
        fetchMany("QA",          { column: "grn_id", value: id }),
        fetchIvIdsForGrns([id]),
        fetchMany("LANDED_COST", { column: "grn_id", value: id }),
        fetchMany("RTV",         { column: "grn_id", value: id }),
      ]);
      addMany(nodes, seen, qaRows, "QA");
      if (ivIds.length) addMany(nodes, seen, await fetchMany("IV", { column: "id", value: ivIds }), "IV");
      addMany(nodes, seen, lcRows, "LANDED_COST");
      addMany(nodes, seen, rtvRows, "RTV");
      const rtvIds = rtvRows.map(r => String(r.id));
      if (rtvIds.length) addMany(nodes, seen, await fetchMany("DEBIT_NOTE", { column: "rtv_id", value: rtvIds }), "DEBIT_NOTE");
      break;
    }

    // ─── QA ────────────────────────────────────────────────────────────────────
    case "QA": {
      const qa = await fetchOne("QA", id);
      if (!qa) return;
      addNode(nodes, seen, qa, "QA", true);

      if (qa.grn_id) {
        const grn = await fetchOne("GRN", String(qa.grn_id));
        if (grn) {
          addNode(nodes, seen, grn, "GRN", false);
          const [ge, po, csns] = await Promise.all([
            grn.gate_entry_id ? fetchOne("GATE_ENTRY", String(grn.gate_entry_id)) : Promise.resolve(null),
            grn.po_id         ? fetchOne("PO",          String(grn.po_id))         : Promise.resolve(null),
            fetchMany("CSN", { column: "grn_id", value: String(grn.id) }),
          ]);
          if (ge) addNode(nodes, seen, ge, "GATE_ENTRY", false);
          if (po) addNode(nodes, seen, po, "PO", false);
          addMany(nodes, seen, csns, "CSN");
        }
      }
      break;
    }

    // ─── IV ────────────────────────────────────────────────────────────────────
    case "IV": {
      const iv = await fetchOne("IV", id);
      if (!iv) return;
      addNode(nodes, seen, iv, "IV", true);

      // Backward: PO
      if (iv.po_id) {
        const po = await fetchOne("PO", String(iv.po_id));
        if (po) addNode(nodes, seen, po, "PO", false);
      }

      // GRNs via iv_lines
      const { data: ivLines } = await serviceRoleClient
        .schema("erp_procurement")
        .from("invoice_verification_line")
        .select("grn_id")
        .eq("iv_id", id);
      const grnIds = [...new Set((ivLines ?? []).map((r: RawRow) => String(r.grn_id)).filter(Boolean))];
      if (grnIds.length) {
        const grns = await fetchMany("GRN", { column: "id", value: grnIds });
        addMany(nodes, seen, grns, "GRN");
        const geIds = grns.map(g => String(g.gate_entry_id)).filter(Boolean);
        if (geIds.length) addMany(nodes, seen, await fetchMany("GATE_ENTRY", { column: "id", value: geIds }), "GATE_ENTRY");
        addMany(nodes, seen, await fetchMany("CSN", { column: "grn_id", value: grnIds }), "CSN");
      }
      break;
    }

    // ─── LANDED_COST ───────────────────────────────────────────────────────────
    case "LANDED_COST": {
      const lc = await fetchOne("LANDED_COST", id);
      if (!lc) return;
      addNode(nodes, seen, lc, "LANDED_COST", true);

      const [grn, csn, po] = await Promise.all([
        lc.grn_id ? fetchOne("GRN", String(lc.grn_id)) : Promise.resolve(null),
        lc.csn_id ? fetchOne("CSN", String(lc.csn_id)) : Promise.resolve(null),
        lc.po_id  ? fetchOne("PO",  String(lc.po_id))  : Promise.resolve(null),
      ]);
      if (po)  addNode(nodes, seen, po,  "PO",  false);
      if (csn) addNode(nodes, seen, csn, "CSN", false);
      if (grn) {
        addNode(nodes, seen, grn, "GRN", false);
        const ge = grn.gate_entry_id ? await fetchOne("GATE_ENTRY", String(grn.gate_entry_id)) : null;
        if (ge) addNode(nodes, seen, ge, "GATE_ENTRY", false);
        // Other downstream from GRN
        const [qaRows, ivIds, rtvRows] = await Promise.all([
          fetchMany("QA",  { column: "grn_id", value: String(grn.id) }),
          fetchIvIdsForGrns([String(grn.id)]),
          fetchMany("RTV", { column: "grn_id", value: String(grn.id) }),
        ]);
        addMany(nodes, seen, qaRows, "QA");
        if (ivIds.length) addMany(nodes, seen, await fetchMany("IV", { column: "id", value: ivIds }), "IV");
        addMany(nodes, seen, rtvRows, "RTV");
        const rtvIds = rtvRows.map(r => String(r.id));
        if (rtvIds.length) addMany(nodes, seen, await fetchMany("DEBIT_NOTE", { column: "rtv_id", value: rtvIds }), "DEBIT_NOTE");
      }
      break;
    }

    // ─── RTV ───────────────────────────────────────────────────────────────────
    case "RTV": {
      const rtv = await fetchOne("RTV", id);
      if (!rtv) return;
      addNode(nodes, seen, rtv, "RTV", true);

      const [grn, po, debitNotes] = await Promise.all([
        rtv.grn_id ? fetchOne("GRN", String(rtv.grn_id)) : Promise.resolve(null),
        rtv.po_id  ? fetchOne("PO",  String(rtv.po_id))  : Promise.resolve(null),
        fetchMany("DEBIT_NOTE", { column: "rtv_id", value: id }),
      ]);
      if (po) addNode(nodes, seen, po, "PO", false);
      addMany(nodes, seen, debitNotes, "DEBIT_NOTE");
      if (grn) {
        addNode(nodes, seen, grn, "GRN", false);
        const [ge, csns] = await Promise.all([
          grn.gate_entry_id ? fetchOne("GATE_ENTRY", String(grn.gate_entry_id)) : Promise.resolve(null),
          fetchMany("CSN", { column: "grn_id", value: String(grn.id) }),
        ]);
        if (ge) addNode(nodes, seen, ge, "GATE_ENTRY", false);
        addMany(nodes, seen, csns, "CSN");
      }
      break;
    }

    // ─── STO ───────────────────────────────────────────────────────────────────
    case "STO": {
      const sto = await fetchOne("STO", id);
      if (!sto) return;
      addNode(nodes, seen, sto, "STO", true);

      // CSNs that reference this STO (sto_id is plain uuid column on CSN)
      const [csns, grns] = await Promise.all([
        fetchMany("CSN", { column: "sto_id", value: id }),
        fetchMany("GRN", { column: "sto_id", value: id }),
      ]);
      addMany(nodes, seen, csns, "CSN");
      addMany(nodes, seen, grns, "GRN");

      const grnIds = grns.map(g => String(g.id));
      const geIds  = grns.map(g => String(g.gate_entry_id)).filter(Boolean);
      if (geIds.length)  addMany(nodes, seen, await fetchMany("GATE_ENTRY", { column: "id", value: geIds }),  "GATE_ENTRY");
      if (grnIds.length) addMany(nodes, seen, await fetchMany("QA",         { column: "grn_id", value: grnIds }), "QA");
      break;
    }

    // ─── SO ────────────────────────────────────────────────────────────────────
    case "SO": {
      const so = await fetchOne("SO", id);
      if (!so) return;
      addNode(nodes, seen, so, "SO", true);
      addMany(nodes, seen, await fetchMany("SALES_INVOICE", { column: "so_id", value: id }), "SALES_INVOICE");
      break;
    }

    // ─── SALES_INVOICE ─────────────────────────────────────────────────────────
    case "SALES_INVOICE": {
      const si = await fetchOne("SALES_INVOICE", id);
      if (!si) return;
      addNode(nodes, seen, si, "SALES_INVOICE", true);
      if (si.so_id) {
        const so = await fetchOne("SO", String(si.so_id));
        if (so) addNode(nodes, seen, so, "SO", false);
      }
      break;
    }

    // ─── PID ───────────────────────────────────────────────────────────────────
    case "PID": {
      const pid = await fetchOne("PID", id);
      if (!pid) return;
      addNode(nodes, seen, pid, "PID", true);
      // PID is standalone — no upstream/downstream document links
      break;
    }

    default:
      break;
  }
}
```

---

## Routes

### Import to add in `procurement.routes.ts`
```typescript
import { getDocumentFlowHandler } from "../_core/procurement/document_flow.handlers.ts";
```

### Switch case (add after `case "GET:/api/procurement/planning":`)
```typescript
case "GET:/api/procurement/document-flow":
  return await getDocumentFlowHandler(req, ctx);
```

---

## procurementApi.js — New Function (append at end)

```javascript
export function getDocumentFlow(params) {
  return fetchProcurement("GET", "/api/procurement/document-flow", undefined, params);
}
```

> **Unwrap note:** The handler returns `{ data: nodes }` — no `total` key — so `fetchProcurement` returns `payload.data` = the nodes array directly. The component calls `setNodes(Array.isArray(response) ? response : [])`.

---

## 25.2 — FE: `DocumentFlowSection.jsx`

**File-ID:** 25.2
**Path:** `frontend/src/pages/dashboard/procurement/DocumentFlowSection.jsx`

### Full spec

```jsx
/*
 * File-ID: 25.2
 * File-Path: frontend/src/pages/dashboard/procurement/DocumentFlowSection.jsx
 * Gate: 25
 * Phase: 25
 * Domain: PROCUREMENT
 * Purpose: Reusable document flow chain section for procurement detail pages.
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../navigation/screens/projects/operationModule/operationScreens.js";
import { getDocumentFlow } from "./procurementApi.js";
```

### DOC_TYPE_CONFIG (define in the component file)

```javascript
const DOC_TYPE_CONFIG = {
  PO:            { label: "PO",            screen: "PROC_PO_DETAIL",          path: "/dashboard/procurement/purchase-orders",                      bg: "bg-sky-100",     text: "text-sky-800"    },
  CSN:           { label: "CSN",           screen: "PROC_CSN_DETAIL",          path: "/dashboard/procurement/csns",                                 bg: "bg-violet-100",  text: "text-violet-800" },
  GATE_ENTRY:    { label: "Gate Entry",    screen: "PROC_GATE_ENTRY_DETAIL",   path: "/dashboard/procurement/gate-entries",                         bg: "bg-slate-100",   text: "text-slate-700"  },
  GRN:           { label: "GRN",           screen: "PROC_GRN_DETAIL",          path: "/dashboard/procurement/grns",                                 bg: "bg-emerald-100", text: "text-emerald-800"},
  QA:            { label: "QA",            screen: "PROC_QA_DOCUMENT",         path: "/dashboard/procurement/qa-documents",                         bg: "bg-amber-100",   text: "text-amber-800"  },
  IV:            { label: "Invoice Verif", screen: "PROC_IV_DETAIL",           path: "/dashboard/procurement/accounts/invoice-verifications",       bg: "bg-blue-100",    text: "text-blue-800"   },
  LANDED_COST:   { label: "Landed Cost",   screen: "PROC_LC_DETAIL",           path: "/dashboard/procurement/accounts/landed-costs",                bg: "bg-indigo-100",  text: "text-indigo-800" },
  RTV:           { label: "RTV",           screen: "PROC_RTV_DETAIL",          path: "/dashboard/procurement/rtvs",                                 bg: "bg-orange-100",  text: "text-orange-800" },
  DEBIT_NOTE:    { label: "Debit Note",    screen: "PROC_DEBIT_NOTE_DETAIL",   path: "/dashboard/procurement/debit-notes",                          bg: "bg-rose-100",    text: "text-rose-800"   },
  STO:           { label: "STO",           screen: "PROC_STO_DETAIL",          path: "/dashboard/procurement/stos",                                 bg: "bg-purple-100",  text: "text-purple-800" },
  SO:            { label: "Sales Order",   screen: "PROC_SO_DETAIL",           path: "/dashboard/procurement/sales-orders",                         bg: "bg-teal-100",    text: "text-teal-800"   },
  SALES_INVOICE: { label: "Sales Invoice", screen: "PROC_INV_DETAIL",          path: "/dashboard/procurement/sales-invoices",                       bg: "bg-green-100",   text: "text-green-800"  },
  PID:           { label: "Phys. Inv.",    screen: "PROC_PI_DETAIL",           path: "/dashboard/procurement/physical-inventory",                   bg: "bg-slate-100",   text: "text-slate-700"  },
};
```

### Component logic

```jsx
export default function DocumentFlowSection({ docType, docId }) {
  const navigate = useNavigate();
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!docType || !docId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    getDocumentFlow({ doc_type: docType, id: docId })
      .then((res) => {
        if (!cancelled) setNodes(Array.isArray(res) ? res : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "FLOW_FETCH_FAILED");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [docType, docId]);

  function handleNodeClick(node) {
    if (node.is_current) return;
    const cfg = DOC_TYPE_CONFIG[node.doc_type];
    if (!cfg) return;
    const sc = OPERATION_SCREENS[cfg.screen];
    if (sc) openScreen(sc.screen_code);
    navigate(`${cfg.path}/${node.id}`);
  }

  return (
    <ErpSectionCard eyebrow="Document Flow" title="Related document chain">
      {loading ? (
        <div className="text-sm text-slate-400">Loading document flow...</div>
      ) : error ? (
        <div className="text-sm text-rose-600">{error}</div>
      ) : nodes.length === 0 ? (
        <div className="text-sm text-slate-400">No linked documents found.</div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 overflow-x-auto pb-1">
          {nodes.map((node, idx) => {
            const cfg = DOC_TYPE_CONFIG[node.doc_type] ?? { label: node.doc_type, bg: "bg-slate-100", text: "text-slate-700" };
            const isClickable = !node.is_current && !!DOC_TYPE_CONFIG[node.doc_type];
            return (
              <div key={`${node.doc_type}-${node.id}`} className="flex items-center gap-2">
                {idx > 0 && <span className="text-slate-400 text-sm">→</span>}
                <button
                  type="button"
                  onClick={() => handleNodeClick(node)}
                  disabled={!isClickable}
                  className={[
                    "flex flex-col rounded border px-3 py-2 text-left text-xs transition-all",
                    node.is_current
                      ? "border-sky-400 ring-2 ring-sky-300 cursor-default " + cfg.bg + " " + cfg.text
                      : isClickable
                      ? "border-slate-200 hover:border-slate-400 hover:shadow-sm cursor-pointer " + cfg.bg + " " + cfg.text
                      : "border-slate-200 cursor-default " + cfg.bg + " " + cfg.text,
                  ].join(" ")}
                >
                  <span className="font-semibold uppercase tracking-wide text-[10px]">{cfg.label}</span>
                  <span className="mt-0.5 font-medium text-[12px]">{node.doc_number || node.id.slice(0, 8)}</span>
                  <span className="mt-0.5 text-[10px] opacity-70">{node.status}</span>
                  {node.date && <span className="mt-0.5 text-[10px] opacity-60">{node.date}</span>}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ErpSectionCard>
  );
}
```

---

## 10 Detail Page Modifications

For each page below, add **two things**:

1. Import at the top (with other procurement imports):
```jsx
import DocumentFlowSection from "../DocumentFlowSection.jsx";
```

2. Add `<DocumentFlowSection>` as the **last section** inside the `!loading && detail` render branch, just before the closing layout tag.

```jsx
<DocumentFlowSection docType="<DOC_TYPE>" docId={detail.id} />
```

### Exact docType per page

| Page file | docType string |
|---|---|
| `po/PODetailPage.jsx` | `"PO"` |
| `grn/GRNDetailPage.jsx` | `"GRN"` |
| `qa/QADocumentPage.jsx` | `"QA"` |
| `sto/STODetailPage.jsx` | `"STO"` |
| `rtv/RTVDetailPage.jsx` | `"RTV"` |
| `accounts/IVDetailPage.jsx` | `"IV"` |
| `accounts/LandedCostDetailPage.jsx` | `"LANDED_COST"` |
| `sales/SODetailPage.jsx` | `"SO"` |
| `sales/SalesInvoiceDetailPage.jsx` | `"SALES_INVOICE"` |
| `inventory/PIDocumentDetailPage.jsx` | `"PID"` |

**Import path is `"../DocumentFlowSection.jsx"` for ALL 10 pages** (they are all in one-level subfolders of `procurement/`).

Place `<DocumentFlowSection>` **after all existing ErpSectionCard sections**, as the final section in the detail view. It should only render when `detail` is not null (inside the existing `!loading && detail` branch).

---

## Summary Checklist for Codex

- [ ] `document_flow.handlers.ts` — File-ID 25.1, all 13 doc_type cases in `resolveChain`
- [ ] `DocumentFlowSection.jsx` — File-ID 25.2, useEffect fetch, deduplication-safe, openScreen+navigate on click
- [ ] `procurement.routes.ts` — import + `case "GET:/api/procurement/document-flow":`
- [ ] `procurementApi.js` — `getDocumentFlow` appended
- [ ] 10 detail pages — import + `<DocumentFlowSection docType="..." docId={detail.id} />`
