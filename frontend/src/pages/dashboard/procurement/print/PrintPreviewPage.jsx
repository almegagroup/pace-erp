/*
 * File-Path: frontend/src/pages/dashboard/procurement/print/PrintPreviewPage.jsx
 * Domain: PROCUREMENT
 * Purpose: PO19 "Print PO/STO" — renders the actual printable PO/STO copy
 *          (or copies, page-break-separated for bulk print) with real data.
 *          §118.2-118.6 of the feasibility doc.
 * Authority: Frontend
 */

import React, { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { openRoute, getActiveScreenContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import { getPurchaseOrder, getSTO, createPrintLog, listPorts } from "../procurementApi.js";
import { MASTER_PICKER_FETCH_LIMIT, useMaterialOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";

const SHIPMENT_MODE_LABELS = {
  FCL: "Sea — FCL (Full Container Load)",
  LCL: "Sea — LCL (Less than Container Load)",
  AIR: "Air Freight",
  COURIER: "Courier / Express",
};
const IMPORT_TRADE_TYPE_LABELS = {
  DIRECT_IMPORT: "Direct Import",
  HIGH_SEA_SALE: "High Sea Sale (HSS)",
  BONDED_WAREHOUSE: "Bonded Warehouse Import",
  EPCG_ADVANCE_AUTH: "EPCG / Advance Authorization",
};
const CUSTOMS_MOVEMENT_TYPE_LABELS = {
  DPD: "DPD — Direct Port Delivery",
  CFS: "CFS — Container Freight Station",
  ICD: "ICD — Inland Container Depot",
};
const DELIVERY_FALLBACK = "Delivery dates will be informed accordingly";

function fmtDate(value) {
  if (!value) return "--";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtNumber(value, digits = 3) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(digits) : "0.000";
}

function joinTruthy(parts, sep = " / ") {
  return parts.filter(Boolean).join(sep) || null;
}

function stripLeadingCode(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const pipeIndex = text.indexOf("|");
  if (pipeIndex >= 0) {
    const rhs = text.slice(pipeIndex + 1).trim();
    return rhs || text;
  }
  return text.replace(/^[A-Z]{1,5}-?\d{1,6}\s+[—|-]?\s*/i, "").trim() || text;
}

// Approval log rows carry actioned_by_display in "CODE | Full Name" format
// (attachUserDisplayFields in po.handlers.ts/sto.handlers.ts) — the QR only
// encodes the code portion (§118.4 "Approver ID").
function resolveApproverCode(approvalLog) {
  const approvedRows = Array.isArray(approvalLog)
    ? approvalLog.filter((row) => String(row?.action || "").toUpperCase() === "APPROVED")
    : [];
  if (approvedRows.length === 0) return null;
  const latest = approvedRows.reduce((a, b) => (
    new Date(b?.actioned_at || 0) > new Date(a?.actioned_at || 0) ? b : a
  ));
  const display = String(latest?.actioned_by_display || "").trim();
  if (!display) return null;
  return display.split("|")[0].trim() || null;
}

// §118.4: DOC/DATE/CPTY(counterpart code)/APPR(approver code)/BUYER(issuer's
// own code) — from is always the masthead/issuing party, to is always the
// counterpart, for both PO (Buyer vs Vendor) and STO (Sending vs Receiving).
function buildQrPayload({ docNumber, date, counterpartCode, approverCode, issuerCode }) {
  return [
    `DOC:${docNumber || "--"}`,
    `DATE:${date || "--"}`,
    `CPTY:${counterpartCode || "--"}`,
    `APPR:${approverCode || "--"}`,
    `BUYER:${issuerCode || "--"}`,
  ].join("|");
}

function QrCodeBox({ payload }) {
  const [dataUrl, setDataUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(payload, { margin: 0, width: 72, errorCorrectionLevel: "M" })
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => { if (!cancelled) setDataUrl(null); });
    return () => { cancelled = true; };
  }, [payload]);

  if (!dataUrl) return <div className="qr-box qr-box-empty" />;
  return <img className="qr-box" src={dataUrl} alt="" width={72} height={72} />;
}

function CompanyIdBlock({ company }) {
  if (!company) return null;
  const mobiles = joinTruthy([company.mobile_number_1, company.mobile_number_2]);
  const emails = joinTruthy([company.email_1, company.email_2]);
  return (
    <table className="brand-ids">
      <tbody>
        <tr><td className="k">GSTIN</td><td className="v">{company.gst_number || "--"}</td></tr>
        {company.cin_number ? <tr><td className="k">CIN</td><td className="v">{company.cin_number}</td></tr> : null}
        {mobiles ? <tr><td className="k">Mobile</td><td className="v">{mobiles}</td></tr> : null}
        {emails ? <tr><td className="k">Email</td><td className="v">{emails}</td></tr> : null}
      </tbody>
    </table>
  );
}

function VendorPartyBlock({ vendor }) {
  return (
    <div className="party-block">
      <p className="party-label">Vendor</p>
      <p className="party-name">{vendor?.vendor_name || "--"}</p>
      <p className="party-line">GSTIN: {vendor?.gst_number || "--"}</p>
      <p className="party-line">{vendor?.registered_address || "--"}</p>
      <p className="party-line">
        {joinTruthy([vendor?.primary_contact_name, vendor?.primary_contact_phone], " — ") || "--"}
      </p>
      <p className="party-line muted">{vendor?.primary_email || "--"}</p>
    </div>
  );
}

function CompanyPartyBlock({ label, company }) {
  const mobiles = joinTruthy([company?.mobile_number_1, company?.mobile_number_2]);
  const emails = joinTruthy([company?.email_1, company?.email_2]);
  return (
    <div className="party-block">
      <p className="party-label">{label}</p>
      <p className="party-name">{company?.company_name || "--"}</p>
      <p className="party-line">GSTIN: {company?.gst_number || "--"}</p>
      <p className="party-line">{company?.full_address || "--"}</p>
      {mobiles ? <p className="party-line">{mobiles}</p> : null}
      {emails ? <p className="party-line muted">{emails}</p> : null}
    </div>
  );
}

function POCopy({ po, from, to, portsById }) {
  const line = po?.lines?.[0] ?? null;
  const revised = Array.isArray(po?.amendment_log) && po.amendment_log.length > 0;
  const cancelled = String(po?.status || "").toUpperCase() === "CANCELLED";
  const isImport = String(po?.vendor_type || "").toUpperCase() === "IMPORT";
  const portName = isImport ? portsById?.[po?.destination_port_id] : null;
  const materialLabel = stripLeadingCode(line?.material_display) || "--";
  const paymentTermLabel = stripLeadingCode(line?.payment_term_display) || "--";
  const qrPayload = buildQrPayload({
    docNumber: po?.po_number,
    date: fmtDate(po?.po_date),
    counterpartCode: to?.vendor_code,
    approverCode: resolveApproverCode(po?.approval_log),
    issuerCode: from?.company_code,
  });

  return (
    <div className="paper">
      {cancelled ? <div className="watermark cancelled">CANCELLED</div> : revised ? <div className="watermark revised">REVISED</div> : null}

      <div className="masthead">
        <div>
          <p className="brand-name">{from?.company_name || "--"}</p>
          <p className="brand-meta">{from?.full_address || ""}</p>
        </div>
        <div className="masthead-right">
          <QrCodeBox payload={qrPayload} />
          <CompanyIdBlock company={from} />
        </div>
      </div>

      <div className="parties">
        <VendorPartyBlock vendor={to} />
        <div className="party-block doc-info">
          <p className="doc-title">Purchase Order</p>
          <table className="doc-id-table">
            <tbody>
              <tr><td className="k">PO No.</td><td className="v">{po?.po_number}</td></tr>
              <tr><td className="k">PO Date</td><td className="v">{fmtDate(po?.po_date)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <table className="items">
        <thead>
          <tr>
            <th style={{ width: "8%" }}>Sr.</th>
            <th>Material</th>
            <th className="num" style={{ width: "12%" }}>Qty</th>
            <th style={{ width: "8%" }}>UOM</th>
            <th className="num" style={{ width: "13%" }}>Rate</th>
            <th className="num" style={{ width: "15%" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1</td>
            <td>{materialLabel}</td>
            <td className="num">{fmtNumber(line?.ordered_qty)}</td>
            <td>{line?.po_uom_code || "--"}</td>
            <td className="num">{fmtNumber(line?.unit_rate, 2)}</td>
            <td className="num">{fmtNumber(line?.total_value, 2)}</td>
          </tr>
        </tbody>
      </table>

      <div className="foot-grid">
        <div className="terms">
          <p className="h">Terms</p>
          <div className="row"><span className="lbl">Payment</span><span>{paymentTermLabel}</span></div>
          <div className="row"><span className="lbl">Delivery</span><span>{po?.expected_delivery_date ? fmtDate(po.expected_delivery_date) : DELIVERY_FALLBACK}</span></div>
          <div className="row"><span className="lbl">Freight</span><span>{po?.freight_term || "--"}</span></div>
          <div className="row"><span className="lbl">GST</span><span>{po?.gst_terms === "INCLUSIVE" ? "Inclusive" : po?.gst_terms === "EXCLUSIVE" ? "Exclusive" : "--"}</span></div>
          {po?.has_rebate ? (
            <div className="row"><span className="lbl">Rebate</span><span>{fmtNumber(po?.rebate_rate, 2)} {po?.rebate_rate_uom_basis === "PO_UOM" ? "/ PO UOM" : "/ Base UOM"}{po?.rebate_remarks ? ` — ${po.rebate_remarks}` : ""}</span></div>
          ) : null}
          {po?.remarks ? <div className="row"><span className="lbl">Remarks</span><span>{po.remarks}</span></div> : null}
        </div>
        {isImport ? (
          <div className="terms">
            <p className="h">Import Detail</p>
            <div className="row"><span className="lbl">Port</span><span>{portName || "--"}</span></div>
            <div className="row"><span className="lbl">Shipment</span><span>{SHIPMENT_MODE_LABELS[po?.shipment_mode] || po?.shipment_mode || "--"}</span></div>
            <div className="row"><span className="lbl">Trade Type</span><span>{IMPORT_TRADE_TYPE_LABELS[po?.import_trade_type] || po?.import_trade_type || "--"}</span></div>
            <div className="row"><span className="lbl">Movement</span><span>{CUSTOMS_MOVEMENT_TYPE_LABELS[po?.customs_movement_type] || po?.customs_movement_type || "--"}</span></div>
          </div>
        ) : null}
      </div>
      <div className="foot-grid" style={{ marginTop: "4px" }}>
        <div />
        <div className="sign"><div className="sign-box"><div className="sign-role">Authorised Signatory</div></div></div>
      </div>

      <div className="std-notes">
        <ol>
          <li>COA [Test Certificate] is Mandatory Along with the Invoice/Document set.</li>
          <li>Packaging items should be recyclable.</li>
          <li>Vehicles should be with active PUC certificate.</li>
          <li>Material transaction should be as per consignee&apos;s health &amp; safety norms.</li>
        </ol>
      </div>
    </div>
  );
}

function STOCopy({ sto, from, to, materialMap }) {
  const lines = Array.isArray(sto?.lines) ? sto.lines : [];
  const revised = Array.isArray(sto?.amendment_log) && sto.amendment_log.length > 0;
  const cancelled = String(sto?.status || "").toUpperCase() === "CANCELLED";
  const qrPayload = buildQrPayload({
    docNumber: sto?.sto_number,
    date: fmtDate(sto?.sto_date),
    counterpartCode: to?.company_code,
    approverCode: resolveApproverCode(sto?.approval_log),
    issuerCode: from?.company_code,
  });

  return (
    <div className="paper">
      {cancelled ? <div className="watermark cancelled">CANCELLED</div> : revised ? <div className="watermark revised">REVISED</div> : null}

      <div className="masthead">
        <div>
          <p className="brand-name">{from?.company_name || "--"}</p>
          <p className="brand-meta">{from?.full_address || ""}</p>
        </div>
        <div className="masthead-right">
          <QrCodeBox payload={qrPayload} />
          <CompanyIdBlock company={from} />
        </div>
      </div>

      <div className="parties">
        <CompanyPartyBlock label="Receiving Company" company={to} />
        <div className="party-block doc-info">
          <p className="doc-title">Stock Transfer Order</p>
          <table className="doc-id-table">
            <tbody>
              <tr><td className="k">STO No.</td><td className="v">{sto?.sto_number}</td></tr>
              <tr><td className="k">STO Date</td><td className="v">{fmtDate(sto?.sto_date)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <table className="items">
        <thead>
          <tr>
            <th style={{ width: "8%" }}>Sr.</th>
            <th>Material</th>
            <th className="num" style={{ width: "14%" }}>Qty</th>
            <th style={{ width: "10%" }}>UOM</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr><td colSpan={4}>--</td></tr>
          ) : lines.map((line, index) => {
            const material = materialMap?.get(String(line.material_id));
            const materialLabel = material
              ? joinTruthy([material.material_code, material.material_name], " — ")
              : line.material_id || "--";
            return (
              <tr key={line.id || index}>
                <td>{index + 1}</td>
                <td>{materialLabel}</td>
                <td className="num">{fmtNumber(line.quantity)}</td>
                <td>{line.uom_code || "--"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="foot-grid">
        <div className="terms">
          <p className="h">Movement</p>
          <div className="row"><span className="lbl">Delivery</span><span>{DELIVERY_FALLBACK}</span></div>
          {sto?.remarks ? <div className="row"><span className="lbl">Remarks</span><span>{sto.remarks}</span></div> : null}
        </div>
      </div>
      <div className="foot-grid" style={{ marginTop: "4px" }}>
        <div />
        <div className="sign"><div className="sign-box"><div className="sign-role">Authorised Signatory</div></div></div>
      </div>

      <div className="std-notes">
        <ol>
          <li>COA [Test Certificate] is Mandatory Along with the Invoice/Document set.</li>
          <li>Packaging items should be recyclable.</li>
          <li>Vehicles should be with active PUC certificate.</li>
          <li>Material transaction should be as per consignee&apos;s health &amp; safety norms.</li>
        </ol>
      </div>
    </div>
  );
}

export default function PrintPreviewPage() {
  const screenContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const groupNumber = screenContext.group_number || "";
  const kind = screenContext.kind || "";
  const selectedIds = useMemo(
    () => (Array.isArray(screenContext.selectedIds) ? screenContext.selectedIds.filter(Boolean) : []),
    [screenContext.selectedIds],
  );
  const [printContext] = useState(() => screenContext);

  const [documents, setDocuments] = useState([]);
  const [portsById, setPortsById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [logged, setLogged] = useState(false);

  const materialQuery = useMaterialOptionsQuery({ limit: MASTER_PICKER_FETCH_LIMIT, offset: 0 }, { enabled: kind === "STO" });
  const materialMap = useMemo(
    () => new Map((materialQuery.materials ?? []).map((entry) => [String(entry.id), entry])),
    [materialQuery.materials],
  );

  useEffect(() => {
    if (!selectedIds.length) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const effectiveKind = printContext?.kind || kind;
        const fetcher = effectiveKind === "PO_GROUP" ? getPurchaseOrder : getSTO;
        const results = await Promise.all(selectedIds.map((id) => fetcher(id)));
        const portsResponse = effectiveKind === "PO_GROUP" ? await listPorts({ is_active: "all" }) : null;
        if (cancelled) return;
        setDocuments(results);
        if (portsResponse?.data) {
          const map = {};
          portsResponse.data.forEach((p) => { map[p.id] = `${p.port_code || ""} ${p.port_name || ""}`.trim(); });
          setPortsById(map);
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || "Failed to load documents.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [groupNumber, kind, printContext, selectedIds]);

  useEffect(() => {
    if (loading || logged || documents.length === 0 || !groupNumber || !kind || selectedIds.length === 0) return;
    createPrintLog({
      group_number: groupNumber,
      document_kind: kind,
      document_ids: selectedIds,
    }).catch(() => {});
    setLogged(true);
  }, [documents.length, groupNumber, kind, loading, logged, selectedIds]);

  useEffect(() => {
    if (groupNumber) {
      document.title = groupNumber;
    }
    return () => { document.title = "PACE ERP"; };
  }, [groupNumber]);

  if (!selectedIds.length) {
    return (
      <div className="p-6 text-sm text-slate-600">
        No print selection found.{" "}
        <button type="button" className="text-sky-600 underline" onClick={() => openRoute("/dashboard/procurement/print")}>
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="print-preview-shell">
      <style>{PREVIEW_CSS}</style>
      <div className="toolbar no-print">
        <button type="button" onClick={() => {
          try {
            popScreen();
          } catch {
            openRoute("/dashboard/procurement/print");
          }
        }}>Back</button>
        <button type="button" onClick={() => window.print()}>Download / Print</button>
      </div>

      {loading ? <p className="p-6 text-sm text-slate-600">Loading…</p> : null}
      {error ? <p className="p-6 text-sm text-rose-600">{error}</p> : null}

      {documents.map((doc, index) =>
        kind === "PO_GROUP" ? (
          <POCopy
            key={doc.id || index}
            po={doc}
            from={printContext?.from}
            to={printContext?.to}
            portsById={portsById}
          />
        ) : (
          <STOCopy key={doc.id || index} sto={doc} from={printContext?.from} to={printContext?.to} materialMap={materialMap} />
        ),
      )}
    </div>
  );
}

const PREVIEW_CSS = `
  .print-preview-shell { background:#eef0f2; min-height:100vh; padding:20px; }
  .toolbar { display:flex; gap:10px; margin:0 auto 16px; max-width:840px; }
  .toolbar button { border:1px solid #0284c7; background:#0284c7; color:#fff; padding:8px 14px; font-size:13px; font-weight:600; cursor:pointer; }
  .toolbar button:first-child { background:#fff; color:#0284c7; }

  .paper { position:relative; background:#fdfbf9; color:#22201e; width:794px; margin:0 auto 24px; padding:38px 48px 36px; box-shadow:0 1px 3px rgba(0,0,0,.1),0 12px 32px rgba(0,0,0,.16); font-family:Georgia, "Times New Roman", serif; }
  .watermark { position:absolute; top:42%; left:50%; transform:translate(-50%,-50%) rotate(-28deg); font-size:74px; font-weight:800; letter-spacing:.06em; white-space:nowrap; pointer-events:none; z-index:5; font-family:Arial, sans-serif; }
  .watermark.cancelled { color:rgba(180,30,30,.28); }
  .watermark.revised { color:rgba(30,90,160,.28); }

  .masthead { display:grid; grid-template-columns:1.35fr 1fr; gap:20px; align-items:end; padding-bottom:12px; border-bottom:2.5px solid #7a2a2a; break-inside:avoid; page-break-inside:avoid; }
  .masthead-right { display:flex; align-items:flex-start; justify-content:flex-end; gap:10px; }
  .qr-box { width:72px; height:72px; flex:0 0 auto; image-rendering:pixelated; }
  .qr-box-empty { background:#f1ede9; }
  .brand-name { font-size:19px; line-height:1.18; font-weight:700; color:#7a2a2a; margin:0 0 5px; max-width:430px; }
  .brand-meta { font-family:Arial, sans-serif; font-size:10.5px; color:#8a8078; line-height:1.55; max-width:380px; }
  .brand-ids { width:100%; border-collapse:collapse; font-family:Arial, sans-serif; font-size:11px; }
  .brand-ids td { padding:1.5px 0; }
  .brand-ids td.k { color:#8a8078; text-transform:uppercase; letter-spacing:.05em; font-size:9px; font-weight:700; padding-right:10px; white-space:nowrap; vertical-align:top; }
  .brand-ids td.v { font-weight:600; text-align:right; }

  .parties { display:grid; grid-template-columns:1fr 1fr; gap:28px; margin:20px 0; break-inside:avoid; page-break-inside:avoid; }
  .party-label { font-family:Arial, sans-serif; font-size:9.5px; font-weight:700; letter-spacing:.11em; text-transform:uppercase; color:#7a2a2a; margin:0 0 6px; }
  .party-name { font-size:14.5px; font-weight:700; margin:0 0 4px; }
  .party-line { font-family:Arial, sans-serif; font-size:11.5px; line-height:1.55; margin:0; }
  .party-line.muted { color:#8a8078; }
  .party-block { border-top:1px solid #ddd5d1; padding-top:10px; }
  .doc-info { text-align:right; }
  .doc-title { font-size:13.5px; font-weight:700; letter-spacing:.09em; text-transform:uppercase; margin:0 0 8px; }
  .doc-id-table { margin-left:auto; font-family:Arial, sans-serif; font-size:11.5px; border-collapse:collapse; }
  .doc-id-table td { padding:1.5px 0; }
  .doc-id-table td.k { color:#8a8078; padding-right:14px; text-align:right; }
  .doc-id-table td.v { font-weight:600; text-align:right; }

  table.items { width:100%; border-collapse:collapse; margin:6px 0 18px; font-family:Arial, sans-serif; font-size:11.5px; break-inside:avoid; page-break-inside:avoid; }
  table.items th { background:#f3e8e6; font-size:10px; font-weight:700; text-transform:uppercase; text-align:left; padding:7px 10px; border-top:1px solid #b8ada7; border-bottom:1px solid #b8ada7; }
  table.items th.num, table.items td.num { text-align:right; }
  table.items td { padding:8px 10px; border-bottom:1px solid #ddd5d1; vertical-align:top; }
  table.items tr { break-inside:avoid; page-break-inside:avoid; }

  .foot-grid { display:grid; grid-template-columns:1.3fr 1fr; gap:28px; margin-top:14px; break-inside:avoid; page-break-inside:avoid; }
  .terms { font-family:Arial, sans-serif; font-size:10.5px; line-height:1.75; color:#8a8078; }
  .terms .h { font-weight:700; color:#22201e; font-size:10px; text-transform:uppercase; letter-spacing:.08em; margin-bottom:5px; }
  .terms .row { display:flex; gap:6px; }
  .terms .row .lbl { color:#22201e; font-weight:600; min-width:78px; }
  .sign { font-family:Arial, sans-serif; font-size:11px; text-align:right; }
  .sign-box { margin-top:40px; border-top:1px solid #22201e; padding-top:6px; display:inline-block; min-width:190px; }
  .sign-role { color:#8a8078; font-size:10px; }

  .std-notes { margin-top:22px; padding-top:12px; border-top:1px dashed #b8ada7; font-family:Arial, sans-serif; font-size:9.5px; color:#8a8078; }
  .std-notes ol { margin:0; padding-left:16px; }

  @page { size:A4; margin:0; }
  @media print {
    body { background:#fff; }
    .no-print { display:none !important; }
    .print-preview-shell { background:#fff; padding:0; }
    .paper { width:794px; margin:0 auto; box-shadow:none; break-after:page; page-break-after:always; }
  }
`;
