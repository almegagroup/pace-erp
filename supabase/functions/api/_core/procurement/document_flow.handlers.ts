/*
 * File-ID: 25.1
 * File-Path: supabase/functions/api/_core/procurement/document_flow.handlers.ts
 * Gate: 25
 * Phase: 25
 * Domain: PROCUREMENT
 * Purpose: Resolve full document chain for any procurement document type.
 * Authority: Backend
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../response.ts";
import { isCompanyScopeAdminBypass } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";

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

type RawRow = Record<string, unknown>;

// Found live 2026-08-19 (business owner, P0010/L1_AUDITOR on a PID they have
// full PROC_PI_LIST access to): this endpoint serves 13 different document
// types via one generic handler, but the ACL gate was a single hardcoded
// PROC_PO_LIST:VIEW in route-acl-registry.ts -- a user with zero PO access
// (perfectly normal for a PID-only auditor) got 403'd on their OWN document's
// flow tab. resourceCode now resolves dynamically per doc_type (see Gate-2.5
// in _pipeline/runner.ts, which imports DOC_FLOW_RESOURCE_BY_TYPE below) --
// same pattern already used for POST /api/workflow/decision's Gate-2. This
// also surfaced a second, separate gap while fixing it: the handler never
// verified the fetched document's own company against the caller's company
// scope at all (11-bug-pattern #2) -- companyColumns + the check in
// getDocumentFlowHandler below close that too.
const DOC_META: Record<string, { table: string; select: string; numberCol: string; dateCol: string; companyColumns: string[] }> = {
  PO: {
    table: "purchase_order",
    select: "id, po_number, status, po_date, company_id",
    numberCol: "po_number",
    dateCol: "po_date",
    companyColumns: ["company_id"],
  },
  CSN: {
    table: "consignment_note",
    select: "id, csn_number, status, gate_entry_date, po_id, grn_id, gate_entry_id, sto_id, company_id",
    numberCol: "csn_number",
    dateCol: "gate_entry_date",
    companyColumns: ["company_id"],
  },
  GATE_ENTRY: {
    table: "gate_entry",
    select: "id, ge_number, status, ge_date, company_id",
    numberCol: "ge_number",
    dateCol: "ge_date",
    companyColumns: ["company_id"],
  },
  GRN: {
    table: "goods_receipt",
    select: "id, grn_number, status, posting_date, gate_entry_id, po_id, sto_id, company_id",
    numberCol: "grn_number",
    dateCol: "posting_date",
    companyColumns: ["company_id"],
  },
  QA: {
    table: "inward_qa_document",
    select: "id, qa_number, status, qa_created_at, grn_id, po_id, company_id",
    numberCol: "qa_number",
    dateCol: "qa_created_at",
    companyColumns: ["company_id"],
  },
  IV: {
    table: "invoice_verification",
    select: "id, iv_number, status, vendor_invoice_date, po_id, company_id",
    numberCol: "iv_number",
    dateCol: "vendor_invoice_date",
    companyColumns: ["company_id"],
  },
  LANDED_COST: {
    table: "landed_cost",
    select: "id, lc_number, status, created_at, grn_id, csn_id, po_id, company_id",
    numberCol: "lc_number",
    dateCol: "created_at",
    companyColumns: ["company_id"],
  },
  RTV: {
    table: "return_to_vendor",
    select: "id, rtv_number, status, created_at, grn_id, po_id, company_id",
    numberCol: "rtv_number",
    dateCol: "created_at",
    companyColumns: ["company_id"],
  },
  DEBIT_NOTE: {
    table: "debit_note",
    select: "id, dn_number, status, created_at, rtv_id, company_id",
    numberCol: "dn_number",
    dateCol: "created_at",
    companyColumns: ["company_id"],
  },
  STO: {
    // No single company_id column -- an STO spans a sending and a receiving
    // company (same shape sto.handlers.ts's own scope check already uses).
    table: "stock_transfer_order",
    select: "id, sto_number, status, created_at, related_csn_id, sending_company_id, receiving_company_id",
    numberCol: "sto_number",
    dateCol: "created_at",
    companyColumns: ["sending_company_id", "receiving_company_id"],
  },
  SO: {
    table: "sales_order",
    select: "id, so_number, status, so_date, company_id",
    numberCol: "so_number",
    dateCol: "so_date",
    companyColumns: ["company_id"],
  },
  SALES_INVOICE: {
    table: "sales_invoice",
    select: "id, invoice_number, status, invoice_date, so_id, company_id",
    numberCol: "invoice_number",
    dateCol: "invoice_date",
    companyColumns: ["company_id"],
  },
  PID: {
    table: "physical_inventory_document",
    select: "id, document_number, status, count_date, company_id",
    numberCol: "document_number",
    dateCol: "count_date",
    companyColumns: ["company_id"],
  },
};

// Exported for _pipeline/runner.ts's Gate-2.5 dynamic ACL resolution.
export const DOC_FLOW_RESOURCE_BY_TYPE: Record<string, string> = {
  PO: "PROC_PO_LIST",
  CSN: "PROC_CSN_TRACKER",
  GATE_ENTRY: "PROC_GATE_ENTRY_LIST",
  GRN: "PROC_GRN_LIST",
  QA: "PROC_QA_QUEUE",
  IV: "PROC_IV_LIST",
  LANDED_COST: "PROC_LC_LIST",
  RTV: "PROC_RTV_LIST",
  DEBIT_NOTE: "PROC_DEBIT_NOTE_LIST",
  STO: "PROC_STO_LIST",
  SO: "PROC_SO_LIST",
  SALES_INVOICE: "PROC_INV_LIST",
  PID: "PROC_PI_LIST",
};

const NATURAL_ORDER = [
  "PO",
  "CSN",
  "STO",
  "GATE_ENTRY",
  "GRN",
  "QA",
  "IV",
  "LANDED_COST",
  "RTV",
  "DEBIT_NOTE",
  "SO",
  "SALES_INVOICE",
  "PID",
];

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

async function fetchOne(docType: string, id: string): Promise<RawRow | null> {
  const meta = DOC_META[docType];
  if (!meta || !id) return null;
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from(meta.table)
    .select(meta.select)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`DOCUMENT_FLOW_FETCH_${docType}_FAILED`);
  return (data as RawRow | null) ?? null;
}

async function fetchMany(
  docType: string,
  filter: { column: string; value: string | string[] },
): Promise<RawRow[]> {
  const meta = DOC_META[docType];
  if (!meta) return [];
  const ids = Array.isArray(filter.value) ? filter.value.filter(Boolean) : null;
  const single = Array.isArray(filter.value) ? null : filter.value;
  if (ids !== null && ids.length === 0) return [];

  let query = serviceRoleClient
    .schema("erp_procurement")
    .from(meta.table)
    .select(meta.select);

  if (ids !== null) {
    query = query.in(filter.column, ids);
  } else if (single) {
    query = query.eq(filter.column, single);
  }

  const { data, error } = await query;
  if (error) throw new Error(`DOCUMENT_FLOW_FETCH_${docType}_FAILED`);
  return (data ?? []) as RawRow[];
}

async function fetchIvIdsForGrns(grnIds: string[]): Promise<string[]> {
  if (!grnIds.length) return [];
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("invoice_verification_line")
    .select("iv_id")
    .in("grn_id", grnIds);
  if (error) throw new Error("DOCUMENT_FLOW_FETCH_IV_LINKS_FAILED");
  return [...new Set((data ?? []).map((row: RawRow) => String(row.iv_id ?? "")).filter(Boolean))];
}

async function fetchGateEntryLineRefs(geId: string): Promise<{ csnIds: string[]; poIds: string[] }> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("gate_entry_line")
    .select("csn_id, po_id")
    .eq("gate_entry_id", geId);
  if (error) throw new Error("DOCUMENT_FLOW_FETCH_GE_LINES_FAILED");
  const rows = (data ?? []) as RawRow[];
  return {
    csnIds: [...new Set(rows.map((row) => String(row.csn_id ?? "")).filter(Boolean))],
    poIds: [...new Set(rows.map((row) => String(row.po_id ?? "")).filter(Boolean))],
  };
}

async function fetchGrnIdsForIv(ivId: string): Promise<string[]> {
  const { data, error } = await serviceRoleClient
    .schema("erp_procurement")
    .from("invoice_verification_line")
    .select("grn_id")
    .eq("iv_id", ivId);
  if (error) throw new Error("DOCUMENT_FLOW_FETCH_IV_LINES_FAILED");
  return [...new Set((data ?? []).map((row: RawRow) => String(row.grn_id ?? "")).filter(Boolean))];
}

function sortNodes(nodes: FlowNode[]): FlowNode[] {
  return [...nodes].sort((a, b) => {
    const left = NATURAL_ORDER.indexOf(a.doc_type);
    const right = NATURAL_ORDER.indexOf(b.doc_type);
    return (left === -1 ? 99 : left) - (right === -1 ? 99 : right);
  });
}

function addNode(
  collector: FlowNode[],
  seen: Set<string>,
  row: RawRow,
  docType: string,
  isCurrent: boolean,
): void {
  const key = `${docType}:${String(row.id ?? "")}`;
  if (!row.id || seen.has(key)) return;
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

    const meta = DOC_META[docType];
    if (!meta) {
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

    const root = await fetchOne(docType, id);
    if (!root) {
      return errorResponse(
        "DOCUMENT_FLOW_NOT_FOUND",
        "Document not found.",
        ctx.request_id,
        "NONE",
        404,
        {},
        req,
      );
    }

    // Company scope: verify the fetched document actually belongs to one of
    // the caller's own companies (route ACL already checked the resource+
    // action is allowed for the caller's active company -- that alone
    // doesn't verify THIS specific document's own company, since id is
    // caller-supplied). Matches STO's own sending/receiving dual-company
    // check for STO rows.
    if (!isCompanyScopeAdminBypass(ctx)) {
      const candidateCompanyIds = meta.companyColumns
        .map((col) => String(root[col] ?? "").trim())
        .filter(Boolean);
      const resourceCode = DOC_FLOW_RESOURCE_BY_TYPE[docType];
      let allowed = false;
      for (const companyId of candidateCompanyIds) {
        if (await canMaintainCompanyResource(ctx, companyId, resourceCode, "VIEW")) {
          allowed = true;
          break;
        }
      }
      if (!allowed) {
        return errorResponse(
          "COMPANY_SCOPE_VIOLATION",
          "You do not have access to this document.",
          ctx.request_id,
          "NONE",
          403,
          {},
          req,
        );
      }
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

async function resolveChain(
  docType: string,
  id: string,
  nodes: FlowNode[],
  seen: Set<string>,
): Promise<void> {
  switch (docType) {
    case "PO": {
      const po = await fetchOne("PO", id);
      if (!po) return;
      addNode(nodes, seen, po, "PO", true);

      const [csns, grns, ivs, lcs, rtvs] = await Promise.all([
        fetchMany("CSN", { column: "po_id", value: id }),
        fetchMany("GRN", { column: "po_id", value: id }),
        fetchMany("IV", { column: "po_id", value: id }),
        fetchMany("LANDED_COST", { column: "po_id", value: id }),
        fetchMany("RTV", { column: "po_id", value: id }),
      ]);
      addMany(nodes, seen, csns, "CSN");
      addMany(nodes, seen, grns, "GRN");
      addMany(nodes, seen, ivs, "IV");
      addMany(nodes, seen, lcs, "LANDED_COST");
      addMany(nodes, seen, rtvs, "RTV");

      const geIds = grns.map((row) => String(row.gate_entry_id ?? "")).filter(Boolean);
      if (geIds.length) {
        addMany(nodes, seen, await fetchMany("GATE_ENTRY", { column: "id", value: geIds }), "GATE_ENTRY");
      }

      const grnIds = grns.map((row) => String(row.id ?? "")).filter(Boolean);
      if (grnIds.length) {
        addMany(nodes, seen, await fetchMany("QA", { column: "grn_id", value: grnIds }), "QA");
      }

      const rtvIds = rtvs.map((row) => String(row.id ?? "")).filter(Boolean);
      if (rtvIds.length) {
        addMany(nodes, seen, await fetchMany("DEBIT_NOTE", { column: "rtv_id", value: rtvIds }), "DEBIT_NOTE");
      }
      break;
    }

    case "CSN": {
      const csn = await fetchOne("CSN", id);
      if (!csn) return;
      addNode(nodes, seen, csn, "CSN", true);

      if (csn.po_id) {
        const po = await fetchOne("PO", String(csn.po_id));
        if (po) addNode(nodes, seen, po, "PO", false);
      }

      if (csn.sto_id) {
        const sto = await fetchOne("STO", String(csn.sto_id));
        if (sto) addNode(nodes, seen, sto, "STO", false);
      }

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
            fetchMany("QA", { column: "grn_id", value: grnId }),
            fetchIvIdsForGrns([grnId]),
            fetchMany("LANDED_COST", { column: "grn_id", value: grnId }),
            fetchMany("RTV", { column: "grn_id", value: grnId }),
          ]);
          addMany(nodes, seen, qaRows, "QA");
          if (ivIds.length) {
            addMany(nodes, seen, await fetchMany("IV", { column: "id", value: ivIds }), "IV");
          }
          addMany(nodes, seen, lcRows, "LANDED_COST");
          addMany(nodes, seen, rtvRows, "RTV");
          const rtvIds = rtvRows.map((row) => String(row.id ?? "")).filter(Boolean);
          if (rtvIds.length) {
            addMany(nodes, seen, await fetchMany("DEBIT_NOTE", { column: "rtv_id", value: rtvIds }), "DEBIT_NOTE");
          }
        }
      }

      addMany(nodes, seen, await fetchMany("LANDED_COST", { column: "csn_id", value: id }), "LANDED_COST");
      break;
    }

    case "GATE_ENTRY": {
      const ge = await fetchOne("GATE_ENTRY", id);
      if (!ge) return;
      addNode(nodes, seen, ge, "GATE_ENTRY", true);

      const { csnIds, poIds } = await fetchGateEntryLineRefs(id);
      const [csns, pos] = await Promise.all([
        csnIds.length ? fetchMany("CSN", { column: "id", value: csnIds }) : Promise.resolve([]),
        poIds.length ? fetchMany("PO", { column: "id", value: poIds }) : Promise.resolve([]),
      ]);
      addMany(nodes, seen, csns, "CSN");
      addMany(nodes, seen, pos, "PO");

      const grns = await fetchMany("GRN", { column: "gate_entry_id", value: id });
      addMany(nodes, seen, grns, "GRN");

      const grnIds = grns.map((row) => String(row.id ?? "")).filter(Boolean);
      if (grnIds.length) {
        const [qaRows, ivIds, lcRows, rtvRows] = await Promise.all([
          fetchMany("QA", { column: "grn_id", value: grnIds }),
          fetchIvIdsForGrns(grnIds),
          fetchMany("LANDED_COST", { column: "grn_id", value: grnIds }),
          fetchMany("RTV", { column: "grn_id", value: grnIds }),
        ]);
        addMany(nodes, seen, qaRows, "QA");
        if (ivIds.length) {
          addMany(nodes, seen, await fetchMany("IV", { column: "id", value: ivIds }), "IV");
        }
        addMany(nodes, seen, lcRows, "LANDED_COST");
        addMany(nodes, seen, rtvRows, "RTV");
        const rtvIds = rtvRows.map((row) => String(row.id ?? "")).filter(Boolean);
        if (rtvIds.length) {
          addMany(nodes, seen, await fetchMany("DEBIT_NOTE", { column: "rtv_id", value: rtvIds }), "DEBIT_NOTE");
        }
      }
      break;
    }

    case "GRN": {
      const grn = await fetchOne("GRN", id);
      if (!grn) return;
      addNode(nodes, seen, grn, "GRN", true);

      const [ge, po, sto, csns] = await Promise.all([
        grn.gate_entry_id ? fetchOne("GATE_ENTRY", String(grn.gate_entry_id)) : Promise.resolve(null),
        grn.po_id ? fetchOne("PO", String(grn.po_id)) : Promise.resolve(null),
        grn.sto_id ? fetchOne("STO", String(grn.sto_id)) : Promise.resolve(null),
        fetchMany("CSN", { column: "grn_id", value: id }),
      ]);
      if (ge) addNode(nodes, seen, ge, "GATE_ENTRY", false);
      if (po) addNode(nodes, seen, po, "PO", false);
      if (sto) addNode(nodes, seen, sto, "STO", false);
      addMany(nodes, seen, csns, "CSN");

      const [qaRows, ivIds, lcRows, rtvRows] = await Promise.all([
        fetchMany("QA", { column: "grn_id", value: id }),
        fetchIvIdsForGrns([id]),
        fetchMany("LANDED_COST", { column: "grn_id", value: id }),
        fetchMany("RTV", { column: "grn_id", value: id }),
      ]);
      addMany(nodes, seen, qaRows, "QA");
      if (ivIds.length) {
        addMany(nodes, seen, await fetchMany("IV", { column: "id", value: ivIds }), "IV");
      }
      addMany(nodes, seen, lcRows, "LANDED_COST");
      addMany(nodes, seen, rtvRows, "RTV");
      const rtvIds = rtvRows.map((row) => String(row.id ?? "")).filter(Boolean);
      if (rtvIds.length) {
        addMany(nodes, seen, await fetchMany("DEBIT_NOTE", { column: "rtv_id", value: rtvIds }), "DEBIT_NOTE");
      }
      break;
    }

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
            grn.po_id ? fetchOne("PO", String(grn.po_id)) : Promise.resolve(null),
            fetchMany("CSN", { column: "grn_id", value: String(grn.id) }),
          ]);
          if (ge) addNode(nodes, seen, ge, "GATE_ENTRY", false);
          if (po) addNode(nodes, seen, po, "PO", false);
          addMany(nodes, seen, csns, "CSN");
        }
      }
      break;
    }

    case "IV": {
      const iv = await fetchOne("IV", id);
      if (!iv) return;
      addNode(nodes, seen, iv, "IV", true);

      if (iv.po_id) {
        const po = await fetchOne("PO", String(iv.po_id));
        if (po) addNode(nodes, seen, po, "PO", false);
      }

      const grnIds = await fetchGrnIdsForIv(id);
      if (grnIds.length) {
        const grns = await fetchMany("GRN", { column: "id", value: grnIds });
        addMany(nodes, seen, grns, "GRN");
        const geIds = grns.map((row) => String(row.gate_entry_id ?? "")).filter(Boolean);
        if (geIds.length) {
          addMany(nodes, seen, await fetchMany("GATE_ENTRY", { column: "id", value: geIds }), "GATE_ENTRY");
        }
        addMany(nodes, seen, await fetchMany("CSN", { column: "grn_id", value: grnIds }), "CSN");
      }
      break;
    }

    case "LANDED_COST": {
      const lc = await fetchOne("LANDED_COST", id);
      if (!lc) return;
      addNode(nodes, seen, lc, "LANDED_COST", true);

      const [grn, csn, po] = await Promise.all([
        lc.grn_id ? fetchOne("GRN", String(lc.grn_id)) : Promise.resolve(null),
        lc.csn_id ? fetchOne("CSN", String(lc.csn_id)) : Promise.resolve(null),
        lc.po_id ? fetchOne("PO", String(lc.po_id)) : Promise.resolve(null),
      ]);
      if (po) addNode(nodes, seen, po, "PO", false);
      if (csn) addNode(nodes, seen, csn, "CSN", false);
      if (grn) {
        addNode(nodes, seen, grn, "GRN", false);
        const ge = grn.gate_entry_id ? await fetchOne("GATE_ENTRY", String(grn.gate_entry_id)) : null;
        if (ge) addNode(nodes, seen, ge, "GATE_ENTRY", false);

        const [qaRows, ivIds, rtvRows] = await Promise.all([
          fetchMany("QA", { column: "grn_id", value: String(grn.id) }),
          fetchIvIdsForGrns([String(grn.id)]),
          fetchMany("RTV", { column: "grn_id", value: String(grn.id) }),
        ]);
        addMany(nodes, seen, qaRows, "QA");
        if (ivIds.length) {
          addMany(nodes, seen, await fetchMany("IV", { column: "id", value: ivIds }), "IV");
        }
        addMany(nodes, seen, rtvRows, "RTV");
        const rtvIds = rtvRows.map((row) => String(row.id ?? "")).filter(Boolean);
        if (rtvIds.length) {
          addMany(nodes, seen, await fetchMany("DEBIT_NOTE", { column: "rtv_id", value: rtvIds }), "DEBIT_NOTE");
        }
      }
      break;
    }

    case "RTV": {
      const rtv = await fetchOne("RTV", id);
      if (!rtv) return;
      addNode(nodes, seen, rtv, "RTV", true);

      const [grn, po, debitNotes] = await Promise.all([
        rtv.grn_id ? fetchOne("GRN", String(rtv.grn_id)) : Promise.resolve(null),
        rtv.po_id ? fetchOne("PO", String(rtv.po_id)) : Promise.resolve(null),
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

    case "DEBIT_NOTE": {
      const debitNote = await fetchOne("DEBIT_NOTE", id);
      if (!debitNote) return;
      addNode(nodes, seen, debitNote, "DEBIT_NOTE", true);

      if (debitNote.rtv_id) {
        const rtv = await fetchOne("RTV", String(debitNote.rtv_id));
        if (rtv) {
          addNode(nodes, seen, rtv, "RTV", false);
          const [grn, po] = await Promise.all([
            rtv.grn_id ? fetchOne("GRN", String(rtv.grn_id)) : Promise.resolve(null),
            rtv.po_id ? fetchOne("PO", String(rtv.po_id)) : Promise.resolve(null),
          ]);
          if (po) addNode(nodes, seen, po, "PO", false);
          if (grn) {
            addNode(nodes, seen, grn, "GRN", false);
            const [ge, csns] = await Promise.all([
              grn.gate_entry_id ? fetchOne("GATE_ENTRY", String(grn.gate_entry_id)) : Promise.resolve(null),
              fetchMany("CSN", { column: "grn_id", value: String(grn.id) }),
            ]);
            if (ge) addNode(nodes, seen, ge, "GATE_ENTRY", false);
            addMany(nodes, seen, csns, "CSN");
          }
        }
      }
      break;
    }

    case "STO": {
      const sto = await fetchOne("STO", id);
      if (!sto) return;
      addNode(nodes, seen, sto, "STO", true);

      const [relatedCsn, csns, grns] = await Promise.all([
        sto.related_csn_id ? fetchOne("CSN", String(sto.related_csn_id)) : Promise.resolve(null),
        fetchMany("CSN", { column: "sto_id", value: id }),
        fetchMany("GRN", { column: "sto_id", value: id }),
      ]);
      if (relatedCsn) addNode(nodes, seen, relatedCsn, "CSN", false);
      addMany(nodes, seen, csns, "CSN");
      addMany(nodes, seen, grns, "GRN");

      const geIds = grns.map((row) => String(row.gate_entry_id ?? "")).filter(Boolean);
      const grnIds = grns.map((row) => String(row.id ?? "")).filter(Boolean);
      if (geIds.length) {
        addMany(nodes, seen, await fetchMany("GATE_ENTRY", { column: "id", value: geIds }), "GATE_ENTRY");
      }
      if (grnIds.length) {
        addMany(nodes, seen, await fetchMany("QA", { column: "grn_id", value: grnIds }), "QA");
      }
      break;
    }

    case "SO": {
      const so = await fetchOne("SO", id);
      if (!so) return;
      addNode(nodes, seen, so, "SO", true);
      addMany(nodes, seen, await fetchMany("SALES_INVOICE", { column: "so_id", value: id }), "SALES_INVOICE");
      break;
    }

    case "SALES_INVOICE": {
      const salesInvoice = await fetchOne("SALES_INVOICE", id);
      if (!salesInvoice) return;
      addNode(nodes, seen, salesInvoice, "SALES_INVOICE", true);
      if (salesInvoice.so_id) {
        const so = await fetchOne("SO", String(salesInvoice.so_id));
        if (so) addNode(nodes, seen, so, "SO", false);
      }
      break;
    }

    case "PID": {
      const pid = await fetchOne("PID", id);
      if (!pid) return;
      addNode(nodes, seen, pid, "PID", true);
      break;
    }

    default:
      break;
  }
}
