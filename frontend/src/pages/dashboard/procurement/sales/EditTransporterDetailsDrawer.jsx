/*
 * File-Path: frontend/src/pages/dashboard/procurement/sales/EditTransporterDetailsDrawer.jsx
 * Domain: PROCUREMENT / Sales
 * Purpose: "Edit Transporter Details" — additive to DOListPage.jsx (SO03),
 *          per FG-STO-MTS-DISPATCH-DESIGN-DOC.md §6 point 16. VDC-only,
 *          pre-PGI: user enters an FO Number, edits Transporter/LR Number/
 *          LR Date/Truck Number/Dispatch Date, Save. Never triggers PGI —
 *          that only happens from the Truck+Dispatch Date Upload page's
 *          Post action (§6 point 19, Phase 5).
 * Authority: Frontend
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import { findDoByFoNumber, editTransporterDetails, listTransporters } from "../procurementApi.js";

export default function EditTransporterDetailsDrawer({ companyId, onClose, onSaved }) {
  const [foNumber, setFoNumber] = useState("");
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [found, setFound] = useState(null);
  const [transporterId, setTransporterId] = useState("");
  const [lrNumber, setLrNumber] = useState("");
  const [lrDate, setLrDate] = useState("");
  const [truckNumber, setTruckNumber] = useState("");
  const [dispatchDate, setDispatchDate] = useState("");
  const [saving, setSaving] = useState(false);

  const transporterQuery = useQuery({
    queryKey: ["procurement", "transporters", companyId],
    queryFn: () => listTransporters({ company_id: companyId, is_active: "true", limit: 500 }),
    enabled: Boolean(companyId),
  });
  const transporters = Array.isArray(transporterQuery.data)
    ? transporterQuery.data
    : (transporterQuery.data?.items ?? transporterQuery.data?.data ?? []);

  async function handleFind() {
    if (!foNumber.trim()) { setError("Enter an FO Number first."); return; }
    setLooking(true); setError(""); setNotice(""); setFound(null);
    try {
      const result = await findDoByFoNumber({ company_id: companyId, fo_number: foNumber.trim() });
      const data = result?.data ?? result;
      setFound(data);
      setTransporterId(data.transporter_id || "");
      setLrNumber(data.lr_number || "");
      setLrDate(data.lr_date || "");
      setTruckNumber(data.truck_number || "");
      setDispatchDate(data.dispatch_date || "");
    } catch (findError) {
      setError(findError instanceof Error ? findError.message : "DO_BULK_FO_LOOKUP_FAILED");
    } finally {
      setLooking(false);
    }
  }

  async function handleSave() {
    if (!found?.dc_id) return;
    setSaving(true); setError(""); setNotice("");
    try {
      await editTransporterDetails({
        dc_id: found.dc_id,
        transporter_id: transporterId || undefined,
        lr_number: lrNumber || undefined,
        lr_date: lrDate || undefined,
        truck_number: truckNumber || undefined,
        dispatch_date: dispatchDate || undefined,
      });
      setNotice("Dispatch details updated.");
      onSaved?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "DO_BULK_EDIT_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DrawerBase
      visible
      title="Edit Transporter Details"
      onEscape={onClose}
      onClose={onClose}
      width="min(480px, calc(100vw - 24px))"
      actions={
        <button type="button" onClick={onClose} className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em] text-sky-950">Done</button>
      }
    >
      <div className="grid gap-3 text-sm">
        {error ? <div className="border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">{error}</div> : null}
        {notice ? <div className="border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">{notice}</div> : null}

        <div className="flex items-center gap-2">
          <input
            value={foNumber}
            onChange={(event) => setFoNumber(event.target.value)}
            placeholder="FO Number"
            className="h-9 flex-1 border border-slate-300 bg-[#fffef7] px-2"
          />
          <button type="button" disabled={looking} onClick={() => void handleFind()} className="border border-sky-700 bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-950 disabled:opacity-50">
            {looking ? "Finding…" : "Find"}
          </button>
        </div>

        {found ? (
          <div className="grid gap-2 border border-slate-300 bg-slate-50 p-3">
            <p className="text-xs text-slate-600">DO {found.dc_number} — Status {found.status}</p>
            <label className="grid gap-1 text-xs text-slate-600">Transporter
              <select value={transporterId} onChange={(event) => setTransporterId(event.target.value)} className="h-8 border border-slate-300 bg-white px-2">
                <option value="">{found.transporter_display || "Select transporter"}</option>
                {transporters.map((transporter) => <option key={transporter.id} value={transporter.id}>{transporter.transporter_code} — {transporter.transporter_name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-slate-600">LR Number
              <input value={lrNumber} onChange={(event) => setLrNumber(event.target.value)} className="h-8 border border-slate-300 bg-white px-2" />
            </label>
            <label className="grid gap-1 text-xs text-slate-600">LR Date
              <input type="date" value={lrDate} onChange={(event) => setLrDate(event.target.value)} className="h-8 border border-slate-300 bg-white px-2" />
            </label>
            <label className="grid gap-1 text-xs text-slate-600">Truck Number
              <input value={truckNumber} onChange={(event) => setTruckNumber(event.target.value)} className="h-8 border border-slate-300 bg-white px-2" />
            </label>
            <label className="grid gap-1 text-xs text-slate-600">Dispatch Date
              <input type="date" value={dispatchDate} onChange={(event) => setDispatchDate(event.target.value)} className="h-8 border border-slate-300 bg-white px-2" />
            </label>
            <button type="button" disabled={saving} onClick={() => void handleSave()} className="mt-1 border border-sky-700 bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-950 disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        ) : null}
      </div>
    </DrawerBase>
  );
}
