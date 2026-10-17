/*
 * File-Path: frontend/src/pages/dashboard/procurement/planning/HistoricalOperationsImportPage.jsx
 * Domain: PROCUREMENT / HISTORICAL OPERATIONS
 * Purpose: POTMP — controlled, auditable staging page for historical
 *          Production and FG Dispatch facts. This page never connects to
 *          Google Sheets and never posts inventory or GL movements.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { pushToast } from "../../../../store/uiToast.js";
import {
  commitHistoricalOperationsImport,
  commitHistoricalProcurementImport,
  dryRunHistoricalOperationsImport,
  dryRunHistoricalProcurementImport,
  getHistoricalProcurementEvidence,
} from "../procurementApi.js";
import { importSummary, prepareHistoricalImport } from "./historicalImportPayload.js";

const INPUT_CLASS = "h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500";
const GRID_PROPS = { cellNavigate: true, columnFilter: true, searchBar: true, stickyFirstColumn: true, fitColumnWidths: true };

function errorText(error) {
  return error instanceof Error ? error.message : String(error ?? "Request failed");
}

export default function HistoricalOperationsImportPage() {
  const { runtimeContext } = useMenu();
  const [companyIdInput, setCompanyId] = useState("");
  const companyId = companyIdInput || resolveDefaultTransactionCompanyId(runtimeContext);
  const [recordKind, setRecordKind] = useState("PRODUCTION");
  const [sourceSystem, setSourceSystem] = useState("GOOGLE_SHEETS");
  const [sourceFileKey, setSourceFileKey] = useState("");
  const [sourceFileName, setSourceFileName] = useState("");
  const [sourceSheetName, setSourceSheetName] = useState("");
  const [sourceExtractedAt, setSourceExtractedAt] = useState("");
  const [rowsText, setRowsText] = useState("[]");
  const [review, setReview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [evidence, setEvidence] = useState(null);

  const prepared = useMemo(() => prepareHistoricalImport({
    companyId, recordKind, sourceSystem, sourceFileKey, sourceFileName, sourceSheetName, sourceExtractedAt, rowsText,
  }), [companyId, recordKind, rowsText, sourceExtractedAt, sourceFileKey, sourceFileName, sourceSheetName, sourceSystem]);
  const payloadSignature = prepared.payload ? JSON.stringify(prepared.payload) : "";
  useEffect(() => {
    setReview(null);
    setConfirmed(false);
  }, [payloadSignature]);
  const isCurrentReview = Boolean(review && review.signature === payloadSignature);
  const result = isCurrentReview ? review.result : null;
  const issues = Array.isArray(result?.issues) ? result.issues : [];
  const committable = result?.committable === true && isCurrentReview;

  async function runDryRun() {
    if (!prepared.payload) {
      setRequestError(prepared.error);
      return;
    }
    setBusy(true); setRequestError(""); setConfirmed(false);
    try {
      const next = prepared.api === "procurement"
        ? await dryRunHistoricalProcurementImport(prepared.payload)
        : await dryRunHistoricalOperationsImport(prepared.payload);
      setReview({ signature: payloadSignature, result: next });
      pushToast({ message: next.committable ? "Dry-run passed. Review and confirm the import." : "Dry-run found rows requiring correction.", tone: next.committable ? "success" : "warning" });
    } catch (error) {
      setReview(null); setRequestError(errorText(error));
    } finally { setBusy(false); }
  }

  async function runCommit() {
    if (!committable || !confirmed || !prepared.payload) return;
    if (!window.confirm(`Commit ${prepared.rowCount} ${recordKind} historical row(s) for the selected company? This creates analytical history only; it does not post stock, operational PO, CSN, GRN, invoice or GL.`)) return;
    setBusy(true); setRequestError("");
    try {
      const next = prepared.api === "procurement"
        ? await commitHistoricalProcurementImport(prepared.payload)
        : await commitHistoricalOperationsImport(prepared.payload);
      setReview({ signature: payloadSignature, result: next });
      setConfirmed(false);
      pushToast({ message: "Historical import committed.", tone: "success" });
    } catch (error) {
      setRequestError(errorText(error));
    } finally { setBusy(false); }
  }

  async function loadPlanningEvidence() {
    if (!companyId) return;
    setBusy(true); setRequestError("");
    try {
      const next = await getHistoricalProcurementEvidence({ company_id: companyId });
      setEvidence(next);
    } catch (error) {
      setEvidence(null); setRequestError(errorText(error));
    } finally { setBusy(false); }
  }

  const issueColumns = [
    { key: "severity", label: "Severity", width: "100px", render: (row) => String(row.severity ?? "—") },
    { key: "code", label: "Code", width: "220px", render: (row) => String(row.code ?? "—") },
    { key: "source_row_number", label: "Source Row", width: "100px", align: "right", render: (row) => String(row.source_row_number ?? row.row_number ?? "—") },
    { key: "message", label: "Message", minWidth: "400px", render: (row) => String(row.message ?? row.detail ?? "—") },
  ];
  const evidenceColumns = [
    { key: "source", label: "Source", width: "120px", render: (row) => String(row.source ?? "—") },
    { key: "external_po_number", label: "PO", width: "150px", render: (row) => String(row.external_po_number ?? "—") },
    { key: "order_date", label: "Order date", width: "120px", render: (row) => String(row.order_date ?? "—") },
    { key: "supplier_name", label: "Historical supplier", minWidth: "220px", render: (row) => String(row.supplier_name ?? "—") },
    { key: "supply_type", label: "Supply", width: "100px", render: (row) => String(row.supply_type ?? "—") },
    { key: "historical_payment_days", label: "Historical payment days", width: "150px", align: "right", render: (row) => String(row.historical_payment_days ?? "—") },
    { key: "reconciliation", label: "Reconciliation", minWidth: "240px", render: (row) => String(row.reconciliation ?? "—") },
  ];
  const summary = importSummary(result);

  return (
    <ErpScreenScaffold eyebrow="Procurement · POTMP" title="Historical Operations Import" error={requestError}>
      <div className="grid gap-3">
        <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Controlled analytical import only. Paste approved JSON extracted into TXT; this screen has no browser access to Google Sheets and cannot create stock, inventory, operational PO, CSN, GRN, invoice or GL. Production / FG Dispatch retain the 30-Sep-2026 cutoff. Historical procurement uses 01-Sep-2024 through 31-Aug-2026 and retains outside-window parent records only as labelled dependencies.
        </p>
        <ErpSectionCard title="Source and scope">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <TransactionCompanySelector runtimeContext={runtimeContext} value={companyId} onChange={setCompanyId} label="Company" />
            <label className="grid gap-1 text-sm"><span>Import type</span><select value={recordKind} onChange={(event) => setRecordKind(event.target.value)} className={INPUT_CLASS}>
              <optgroup label="Historical operations"><option value="PRODUCTION">Production</option><option value="FG_DISPATCH">FG Dispatch</option></optgroup>
              <optgroup label="Historical procurement"><option value="PURCHASE_ORDER">Historical Purchase Orders / headers</option><option value="PURCHASE_ORDER_LINE">Historical PO Lines</option><option value="CONSIGNMENT_MOVEMENT">Historical Consignment Movements</option><option value="PRODUCT_REFERENCE_SNAPSHOT">Product Database Reference Snapshot</option></optgroup>
            </select></label>
            <label className="grid gap-1 text-sm"><span>Source system</span><input value={sourceSystem} onChange={(event) => setSourceSystem(event.target.value)} className={INPUT_CLASS} /></label>
            <label className="grid gap-1 text-sm"><span>Source file key *</span><input value={sourceFileKey} onChange={(event) => setSourceFileKey(event.target.value)} className={INPUT_CLASS} placeholder="Approved immutable source identifier" /></label>
            <label className="grid gap-1 text-sm"><span>Source file name</span><input value={sourceFileName} onChange={(event) => setSourceFileName(event.target.value)} className={INPUT_CLASS} /></label>
            <label className="grid gap-1 text-sm"><span>Source sheet name *</span><input value={sourceSheetName} onChange={(event) => setSourceSheetName(event.target.value)} className={INPUT_CLASS} /></label>
            {recordKind === "PRODUCT_REFERENCE_SNAPSHOT" ? <label className="grid gap-1 text-sm"><span>Source extracted at *</span><input type="datetime-local" value={sourceExtractedAt} onChange={(event) => setSourceExtractedAt(event.target.value)} className={INPUT_CLASS} /><span className="text-xs text-slate-500">Product_Data_Base is an undated/current reference snapshot, never historical proof.</span></label> : null}
          </div>
        </ErpSectionCard>
        <ErpSectionCard title="Rows (JSON array from reviewed TXT)">
          <textarea value={rowsText} onChange={(event) => setRowsText(event.target.value)} className="min-h-64 w-full border border-slate-300 bg-white p-3 font-mono text-xs outline-none focus:border-sky-500" spellCheck="false" aria-label="Historical import rows JSON" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy} onClick={runDryRun} className="h-8 border border-sky-700 bg-sky-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Working…" : "Dry-run validation"}</button>
            <button type="button" disabled={busy} onClick={() => { setReview(null); setConfirmed(false); setRequestError(""); }} className="h-8 border border-slate-300 bg-white px-3 text-sm disabled:opacity-50">Clear review</button>
            {prepared.error ? <span className="text-sm text-rose-700">{prepared.error}</span> : <span className="text-sm text-slate-600">{prepared.rowCount} row(s) ready for validation. {prepared.api === "procurement" ? "Procurement batches are limited to 500 combined records; import headers, then lines, then movements." : "Production / FG Dispatch batches are limited to 2,000 rows."}</span>}
          </div>
        </ErpSectionCard>
        {result ? <ErpSectionCard title="Dry-run / commit result">
          {!isCurrentReview ? <p className="mb-2 text-sm text-amber-800">The source payload changed after this review. Run dry-run again before committing.</p> : null}
          <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <ResultCell label="Rows submitted" value={summary.submitted} />
            <ResultCell label="Stored" value={summary.stored} />
            <ResultCell label="Validated" value={summary.validated} />
            <ResultCell label="Unmapped / quarantined" value={`${summary.unmapped} / ${summary.quarantined}`} />
            <ResultCell label="Warnings / errors" value={`${summary.warnings} / ${summary.errors}`} />
            <ResultCell label="Status" value={result.committed ? "Committed" : result.committable ? "Ready to commit" : "Correction required"} />
          </div>
          <div className="mb-3 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <ResultCell label="Batch ID" value={result.batch_id ?? "—"} />
            <ResultCell label="Checksum" value={result.checksum ?? "—"} />
            <ResultCell label="Commit status" value={result.status ?? (result.committed ? "COMMITTED" : "DRY_RUN")} />
            <ResultCell label="Quantity records by UOM" value={Object.entries(summary.quantitiesByUom).map(([uom, count]) => `${uom}: ${count}`).join(", ") || "—"} />
          </div>
          {result.reconciliation ? <pre className="mb-3 overflow-auto border border-slate-200 bg-slate-50 p-2 text-xs">{JSON.stringify(result.reconciliation, null, 2)}</pre> : null}
          {issues.length ? <ErpDenseGrid {...GRID_PROPS} rows={issues} columns={issueColumns} emptyMessage="No issues." /> : <p className="mb-3 text-sm text-emerald-800">No validation issues returned.</p>}
          {!result.committed ? <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={!committable || busy} onChange={(event) => setConfirmed(event.target.checked)} /> I reviewed this exact dry-run and approve the analytical import.</label><button type="button" disabled={!committable || !confirmed || busy} onClick={runCommit} className="h-8 border border-emerald-700 bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50">Commit import</button></div> : null}
        </ErpSectionCard> : null}
        <ErpSectionCard title="Procurement planning evidence">
          <p className="mb-2 text-sm text-slate-700">Read-only reconciliation of ERP live PO/CSN activity, historical procurement observations and Product Database defaults. Exact live PO matches are labelled <strong>ERP_LIVE</strong> and take precedence; historical quantities never become current open supply, in-transit stock or commitments.</p>
          <button type="button" disabled={!companyId || busy} onClick={loadPlanningEvidence} className="h-8 border border-slate-700 bg-white px-3 text-sm font-semibold disabled:opacity-50">Load planning evidence</button>
          {evidence ? <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <ResultCell label="Historical / live-preferred rows" value={`${evidence.rows?.length ?? 0} / ${evidence.reconciliation?.live_preferred_exact_po_matches ?? 0}`} />
            <ResultCell label="Reference defaults" value={String(evidence.reference_defaults?.length ?? 0)} />
            <ResultCell label="Supply impact" value={evidence.reconciliation?.live_supply_affected ? "Unexpected" : "None"} />
          </div> : null}
          {evidence?.truncated ? <p className="mt-2 text-sm text-amber-800">Only the first 500 matching evidence/reference rows are shown. Apply company/vendor/material filters through the planning reader for a complete review.</p> : null}
          {evidence?.rows?.length ? <div className="mt-3"><ErpDenseGrid {...GRID_PROPS} rows={evidence.rows} columns={evidenceColumns} emptyMessage="No evidence rows." /></div> : evidence ? <p className="mt-3 text-sm text-slate-600">No historical procurement evidence is stored for this company and filter.</p> : null}
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}

function ResultCell({ label, value }) {
  return <div className="border border-slate-200 bg-slate-50 px-3 py-2"><div className="text-xs uppercase tracking-wide text-slate-500">{label}</div><div className="font-semibold text-slate-900">{value}</div></div>;
}
