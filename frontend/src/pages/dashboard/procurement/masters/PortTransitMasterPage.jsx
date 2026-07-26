/*
 * File-ID: 26.4
 * File-Path: frontend/src/pages/dashboard/procurement/masters/PortTransitMasterPage.jsx
 * Gate: 26
 * Domain: PROCUREMENT
 * Purpose: Port Transit Master page for L2_MANAGER+ users.
 * Authority: Frontend
 */

import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import {
  deleteTransitTime,
  listPorts,
  listTransitTimes,
  upsertTransitTime,
} from "../procurementApi.js";
import { useCompaniesQuery } from "../../../../hooks/queries/useProcurementMasterQueries.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";

const TRANSIT_MODE_OPTIONS = ["ROAD", "RAIL", "MULTI-MODAL"];
const EMPTY_FORM = { port_id: "", company_id: "", transit_days: "", mode: "ROAD", remarks: "" };

const ERROR_MESSAGES = {
  PROCUREMENT_INVALID_TRANSIT:      "Port, company, transit days, and mode are required.",
  PROCUREMENT_PORT_NOT_FOUND:       "Selected port not found.",
  PROCUREMENT_COMPANY_NOT_FOUND:    "Selected company not found.",
  PROCUREMENT_TRANSIT_UPSERT_FAILED:"Failed to save transit time. Please try again.",
  PROCUREMENT_TRANSIT_DELETE_FAILED:"Failed to delete transit time. Please try again.",
  PROCUREMENT_TRANSIT_LIST_FAILED:  "Failed to load transit times. Please refresh.",
  MANAGER_OR_SA_REQUIRED:           "Manager or Super Admin access required.",
};

function friendlyError(code) {
  return ERROR_MESSAGES[code] ?? code;
}

export default function PortTransitMasterPage() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef(null);
  const companiesQuery = useCompaniesQuery();
  const transitQuery = useQuery({
    queryKey: ["procurement", "port-transit-master"],
    queryFn: async () => {
      const [transitData, portData] = await Promise.all([
        listTransitTimes(),
        listPorts({ is_active: "true", port_role: "DISCHARGE" }),
      ]);
      return {
        rows: Array.isArray(transitData) ? transitData : [],
        ports: Array.isArray(portData) ? portData : [],
      };
    },
  });
  const rows = transitQuery.data?.rows ?? [];
  const ports = transitQuery.data?.ports ?? [];
  const companies = Array.isArray(companiesQuery.data) ? companiesQuery.data : [];
  const loading = transitQuery.isLoading || companiesQuery.isLoading;

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void Promise.all([transitQuery.refetch(), companiesQuery.refetch()]),
    },
  });

  const portMap = Object.fromEntries(ports.map((p) => [p.id, p]));
  const companyMap = Object.fromEntries(companies.map((c) => [c.id, c]));

  function flash(msg, isError = false) {
    clearTimeout(noticeTimer.current);
    if (isError) { setError(msg); setNotice(""); }
    else {
      setNotice(msg); setError("");
      noticeTimer.current = setTimeout(() => setNotice(""), 4000);
    }
  }

  useEffect(() => {
    const nextError =
      transitQuery.error?.message ||
      companiesQuery.error?.message ||
      "";
    if (nextError) {
      flash(friendlyError(nextError), true);
    }
    return () => clearTimeout(noticeTimer.current);
  }, [companiesQuery.error, transitQuery.error]);

  async function handleUpsert() {
    if (!form.port_id || !form.company_id || form.transit_days === "" || !form.mode) {
      flash(friendlyError("PROCUREMENT_INVALID_TRANSIT"), true);
      return;
    }
    setSaving(true);
    try {
      await upsertTransitTime({
        port_id: form.port_id,
        company_id: form.company_id,
        transit_days: Number(form.transit_days),
        mode: form.mode,
        remarks: form.remarks.trim() || null,
      });
      setForm(EMPTY_FORM);
      flash("Transit time saved.");
      await Promise.all([transitQuery.refetch(), companiesQuery.refetch()]);
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_TRANSIT_UPSERT_FAILED"), true);
    } finally { setSaving(false); }
  }

  async function handleDelete(row) {
    setSaving(true);
    try {
      await deleteTransitTime(row.id);
      flash("Transit time deleted.");
      await Promise.all([transitQuery.refetch(), companiesQuery.refetch()]);
    } catch (err) {
      flash(friendlyError(err instanceof Error ? err.message : "PROCUREMENT_TRANSIT_DELETE_FAILED"), true);
    } finally { setSaving(false); }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Masters"
      title="Port Transit Master"
      actions={[{
        key: "refresh", label: loading ? "Refreshing..." : "Refresh",
        tone: "neutral",
        onClick: () => void Promise.all([transitQuery.refetch(), companiesQuery.refetch()]),
        disabled: loading,
      }]}
      notices={[
        ...(error  ? [{ key: "err", tone: "error",   message: error  }] : []),
        ...(notice ? [{ key: "ok",  tone: "success",  message: notice }] : []),
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_320px]">
        <ErpSectionCard eyebrow="Transit Register" title="Port ↔ Company transit times">
          <div className="overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  {["Port","Company","Mode","Transit Days","Remarks",""].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">Loading...</td></tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">No transit times found.</td></tr>
                )}
                {rows.map((row) => {
                  const port = portMap[row.port_id];
                  const company = companyMap[row.company_id];
                  return (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs font-semibold text-slate-800">{port?.port_code ?? "—"}</span>
                        {port && <span className="ml-1 text-slate-500">{port.port_name}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs font-semibold text-slate-700">{company?.company_code ?? "—"}</span>
                        {company && <span className="ml-1 text-xs text-slate-500">{company.company_name}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{row.mode ?? "—"}</span>
                      </td>
                      <td className="px-3 py-2 text-center font-semibold text-slate-900">{row.transit_days}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{row.remarks || "—"}</td>
                      <td className="px-3 py-2">
                        <button type="button" disabled={saving} onClick={() => void handleDelete(row)}
                          className="border border-rose-400 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-700 disabled:opacity-50">
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            To update an existing row, save again with the same Port + Company — it will overwrite.
          </p>
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Add / Update" title="Transit time entry">
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Port <span className="text-rose-500">*</span>
              <select
                value={form.port_id}
                onChange={(e) => setForm((f) => ({ ...f, port_id: e.target.value }))}
                className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
              >
                <option value="">— Select port —</option>
                {ports.map((p) => (
                  <option key={p.id} value={p.id}>{p.port_code} — {p.port_name}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Company <span className="text-rose-500">*</span>
              <select
                value={form.company_id}
                onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value }))}
                className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
              >
                <option value="">— Select company —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.company_code} — {c.company_name}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Mode <span className="text-rose-500">*</span>
              <select
                value={form.mode}
                onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}
                className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
              >
                {TRANSIT_MODE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>

            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Transit Days <span className="text-rose-500">*</span>
              <input
                type="number" min="0"
                value={form.transit_days}
                onChange={(e) => setForm((f) => ({ ...f, transit_days: e.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>

            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Remarks
              <input
                value={form.remarks}
                onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>

            <button type="button" disabled={saving} onClick={() => void handleUpsert()}
              className="border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:opacity-50">
              {saving ? "Saving..." : "Save Transit Time"}
            </button>
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
