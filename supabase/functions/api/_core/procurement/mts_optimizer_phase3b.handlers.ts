/* PO22 Phase 3B — company-scoped evidence and manual selection API.
 * No solver, recommendation, stock posting, transfer or purchase creation.
 */
import type { ContextResolution } from "../../_pipeline/context.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { errorResponse, okResponse } from "../response.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { readOptimizerAsOfStockBalances, readOptimizerLifecycleIdentities, readOptimizerMaterialUoms } from "./mts_optimizer_phase3b_source.reader.ts";
import { readOptimizerRequirementDemandEvidence } from "./mts_optimizer_phase3c_source.reader.ts";

type JsonRecord = Record<string, unknown>;
type ReqHandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const RESOURCE_INPUT = "PROC_MTS_OPTIMIZER_INPUT";
const RESOURCE_SELECTION = "PROC_MTS_OPTIMIZER_SELECTION";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLAN_MONTH = /^\d{4}-\d{2}$/;
const MAX_IDS_PER_SOURCE_READ = 500;
const MAX_SELECTION_ROWS_PER_SAVE = 1200;
const text = (value: unknown) => String(value ?? "").trim();

function fail(req: Request, ctx: ReqHandlerContext, code: string, status: number, message: string): Response {
  return errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
}
async function resolveCompany(ctx: ReqHandlerContext, raw: unknown): Promise<string> {
  const companyId = text(raw);
  if (!companyId) return "";
  await assertCompanyScope(ctx, companyId);
  return companyId;
}
async function requireInputView(req: Request, ctx: ReqHandlerContext, companyId: string): Promise<Response | null> {
  return await canMaintainCompanyResource(ctx, companyId, RESOURCE_INPUT, "VIEW")
    ? null : fail(req, ctx, "MTS_OPTIMIZER_FORBIDDEN", 403, "You do not have access to optimizer source evidence for this company.");
}
async function requireSelectionWrite(req: Request, ctx: ReqHandlerContext, companyId: string): Promise<Response | null> {
  return await canMaintainCompanyResource(ctx, companyId, RESOURCE_SELECTION, "WRITE")
    ? null : fail(req, ctx, "MTS_OPTIMIZER_FORBIDDEN", 403, "You cannot change optimizer new-buy selection for this company.");
}
function parseIds(url: URL, key: string): string[] | null {
  const ids = [...new Set(url.searchParams.getAll(key).flatMap((value) => value.split(",")).map(text).filter(Boolean))];
  return ids.length > MAX_IDS_PER_SOURCE_READ || ids.some((id) => !UUID.test(id)) ? null : ids;
}
function handleError(req: Request, ctx: ReqHandlerContext, error: unknown, fallback: string, message: string): Response {
  const code = error instanceof Error ? error.message : fallback;
  if (code === "COMPANY_SCOPE_VIOLATION") return fail(req, ctx, code, 403, "Company is outside your scope.");
  console.error(`[mts_optimizer_phase3b] ${fallback}`, code);
  return fail(req, ctx, fallback, 500, message);
}

/** Read-only source identities and as-of ledger balance evidence. */
export async function getMtsOptimizerLifecycleEvidenceHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await resolveCompany(ctx, url.searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "MTS_OPTIMIZER_COMPANY_REQUIRED", 400, "company_id is required.");
    const denied = await requireInputView(req, ctx, companyId);
    if (denied) return denied;
    const poLineIds = parseIds(url, "po_line_id");
    const materialIds = parseIds(url, "material_id");
    const ledgerIds = parseIds(url, "stock_ledger_id");
    if (!poLineIds || !materialIds || !ledgerIds || (poLineIds.length + materialIds.length + ledgerIds.length) === 0) {
      return fail(req, ctx, "MTS_OPTIMIZER_INVALID_SOURCE_IDS", 400, "Supply at least one valid source UUID; at most 500 IDs per source type.");
    }
    const cmStart = text(url.searchParams.get("cm_start"));
    const asOf = text(url.searchParams.get("as_of"));
    if ((cmStart || asOf) && (!ISO_DATE.test(cmStart) || !ISO_DATE.test(asOf))) {
      return fail(req, ctx, "MTS_OPTIMIZER_INVALID_AS_OF", 400, "cm_start and as_of must both be ISO dates.");
    }
    const [identities, balances, materialUoms] = await Promise.all([
      readOptimizerLifecycleIdentities(companyId, poLineIds, materialIds, ledgerIds),
      cmStart && asOf ? readOptimizerAsOfStockBalances(companyId, cmStart, asOf, materialIds) : Promise.resolve([]),
      readOptimizerMaterialUoms(materialIds),
    ]);
    return okResponse({
      company_id: companyId,
      identities,
      material_uoms: materialUoms,
      as_of_stock_balances: balances,
      balance_basis: balances.length > 0 ? "Ledger-backed get_stock_history closing balance at start of as_of date; events remain provenance, not balances." : null,
      warnings: ["This endpoint exposes evidence only. It never calculates allocation, executable Store instruction, purchase quantity, or a recommendation."],
    }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_OPTIMIZER_SOURCE_READ_FAILED", "Could not read optimizer source evidence.");
  }
}

/**
 * Read-only PO21 → formulation demand evidence.  This remains separate from
 * the approved PO22 report and returns no allocation, purchase, transfer or
 * Store instruction.
 */
export async function getMtsOptimizerRequirementDemandEvidenceHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await resolveCompany(ctx, url.searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "MTS_OPTIMIZER_COMPANY_REQUIRED", 400, "company_id is required.");
    const denied = await requireInputView(req, ctx, companyId);
    if (denied) return denied;
    const planMonthParam = text(url.searchParams.get("plan_month"));
    const asOf = text(url.searchParams.get("as_of"));
    if (!PLAN_MONTH.test(planMonthParam) || !ISO_DATE.test(asOf)) {
      return fail(req, ctx, "MTS_OPTIMIZER_INVALID_DEMAND_PERIOD", 400, "plan_month must be YYYY-MM and as_of must be YYYY-MM-DD.");
    }
    const demandAtRaw = text(url.searchParams.get("demand_at"));
    const demandAt = demandAtRaw && Number.isFinite(Date.parse(demandAtRaw)) ? new Date(demandAtRaw).toISOString() : null;
    if (demandAtRaw && !demandAt) return fail(req, ctx, "MTS_OPTIMIZER_INVALID_DEMAND_AT", 400, "demand_at must be an ISO date-time.");
    const evidence = await readOptimizerRequirementDemandEvidence(companyId, `${planMonthParam}-01`, asOf, demandAt);
    return okResponse({
      ...evidence,
      warnings: [
        "This endpoint exposes immutable PO21/formulation demand evidence only.",
        "It does not allocate a group member, post Store stock, calculate a purchase quantity, or create a PO.",
      ],
    }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_OPTIMIZER_DEMAND_SOURCE_READ_FAILED", "Could not read optimizer demand source evidence.");
  }
}

/** Current and historical manual new-buy decisions.  Missing rows remain UNKNOWN in the pure resolver. */
export async function getMtsOptimizerSelectionsHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const url = new URL(req.url);
    const companyId = await resolveCompany(ctx, url.searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "MTS_OPTIMIZER_COMPANY_REQUIRED", 400, "company_id is required.");
    const denied = await requireInputView(req, ctx, companyId);
    if (denied) return denied;
    const { data, error } = await serviceRoleClient.schema("erp_planning").from("mts_optimizer_material_selection")
      .select("id,material_id,selection_month,version_no,is_current,is_selected_for_new_purchase,source_system,source_ref,save_batch_id,created_by,created_at")
      .eq("company_id", companyId).order("selection_month", { ascending: true }).order("material_id", { ascending: true }).order("version_no", { ascending: false }).range(0, 4999);
    if (error) throw new Error("MTS_OPTIMIZER_SELECTION_READ_FAILED");
    return okResponse({ company_id: companyId, rows: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_OPTIMIZER_SELECTION_READ_FAILED", "Could not read optimizer material selections.");
  }
}

/** Append-only manual selection; it gates tentative new buys only. */
export async function saveMtsOptimizerSelectionsHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({} as JsonRecord)) as JsonRecord;
    const companyId = await resolveCompany(ctx, body.company_id);
    if (!companyId) return fail(req, ctx, "MTS_OPTIMIZER_COMPANY_REQUIRED", 400, "company_id is required.");
    const denied = await requireSelectionWrite(req, ctx, companyId);
    if (denied) return denied;
    // Migration imports are a controlled server-side operation, never a
    // caller-selectable API mode.  Interactive users can only create ERP
    // entry evidence through this route.
    const sourceSystem = text(body.source_system) || "ERP_ENTRY";
    const inputRows = Array.isArray(body.rows) ? body.rows as JsonRecord[] : [];
    if (!inputRows.length || inputRows.length > MAX_SELECTION_ROWS_PER_SAVE || sourceSystem !== "ERP_ENTRY") {
      return fail(req, ctx, "MTS_OPTIMIZER_SELECTION_INVALID_INPUT", 400, "Provide 1–1200 valid selection rows.");
    }
    const unique = new Set<string>();
    const rows = inputRows.map((row) => {
      const materialId = text(row.material_id);
      const month = text(row.selection_month);
      if (!UUID.test(materialId) || !ISO_DATE.test(month) || !month.endsWith("-01") || typeof row.is_selected_for_new_purchase !== "boolean") {
        throw new Error("MTS_OPTIMIZER_SELECTION_INVALID_INPUT");
      }
      const key = `${materialId}|${month}`;
      if (unique.has(key)) throw new Error("MTS_OPTIMIZER_SELECTION_INVALID_INPUT");
      unique.add(key);
      return { material_id: materialId, selection_month: month, is_selected_for_new_purchase: row.is_selected_for_new_purchase, source_ref: row.source_ref && typeof row.source_ref === "object" ? row.source_ref : null };
    });
    const { data, error } = await serviceRoleClient.schema("erp_planning").rpc("save_mts_optimizer_material_selection", {
      p_company_id: companyId, p_actor: ctx.auth_user_id, p_rows: rows, p_source_system: sourceSystem,
    });
    if (error) throw new Error("MTS_OPTIMIZER_SELECTION_SAVE_FAILED");
    return okResponse({ company_id: companyId, result: data }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "MTS_OPTIMIZER_SELECTION_SAVE_FAILED";
    if (code === "MTS_OPTIMIZER_SELECTION_INVALID_INPUT") return fail(req, ctx, code, 400, "Selection rows must use unique material/month, a first-of-month date, and a boolean decision.");
    return handleError(req, ctx, error, "MTS_OPTIMIZER_SELECTION_SAVE_FAILED", "Could not save optimizer material selections.");
  }
}

/** Immutable snapshot metadata only; input capture stays server-side until all source adapters are verified. */
export async function listMtsOptimizerSnapshotsHandler(req: Request, ctx: ReqHandlerContext): Promise<Response> {
  try {
    const companyId = await resolveCompany(ctx, new URL(req.url).searchParams.get("company_id"));
    if (!companyId) return fail(req, ctx, "MTS_OPTIMIZER_COMPANY_REQUIRED", 400, "company_id is required.");
    const denied = await requireInputView(req, ctx, companyId);
    if (denied) return denied;
    const { data, error } = await serviceRoleClient.schema("erp_planning").from("mts_optimizer_input_snapshot")
      .select("id,as_of_date,captured_at,source_contract_version,source_fingerprint,sha256_supply_fingerprint,sha256_business_fingerprint,blocker_count,created_by,created_at")
      .eq("company_id", companyId).order("as_of_date", { ascending: false }).order("created_at", { ascending: false }).range(0, 499);
    if (error) throw new Error("MTS_OPTIMIZER_SNAPSHOT_READ_FAILED");
    return okResponse({ company_id: companyId, rows: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    return handleError(req, ctx, error, "MTS_OPTIMIZER_SNAPSHOT_READ_FAILED", "Could not read optimizer input snapshots.");
  }
}
