/*
 * File-Path: frontend/src/pages/dashboard/procurement/print/PrintGroupPage.jsx
 * Domain: PROCUREMENT
 * Purpose: PO19 "Print PO/STO" — Group Number entry (Page 1) -> summary +
 *          checkbox list of printable documents (Page 2) -> for PO groups
 *          only, a vendor-contact verification modal -> Preview.
 *          §118.6 of the feasibility doc.
 * Authority: Frontend
 */

import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { lookupPrintGroup } from "../procurementApi.js";

function fmtDate(value) {
  if (!value) return "--";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function PrintGroupPage() {
  const navigate = useNavigate();
  const [groupNumberInput, setGroupNumberInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [vendorConfirmed, setVendorConfirmed] = useState(false);

  const documents = result?.documents ?? [];
  const allSelected = documents.length > 0 && selectedIds.size === documents.length;

  async function handleLookup() {
    const trimmed = groupNumberInput.trim();
    if (!trimmed) {
      setError("Enter a Group Number.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    setSelectedIds(new Set());
    try {
      const response = await lookupPrintGroup(trimmed);
      const data = response?.data ?? response;
      setResult(data);
      setSelectedIds(new Set((data?.documents ?? []).map((d) => d.id)));
    } catch (err) {
      setError(err?.message || "Group Number not found.");
    } finally {
      setLoading(false);
    }
  }

  function toggleRow(id) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((current) => {
      if (current.size === documents.length) return new Set();
      return new Set(documents.map((d) => d.id));
    });
  }

  function goToPreview() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    navigate("/dashboard/procurement/print/preview", {
      state: {
        kind: result.kind,
        group_number: result.group_number,
        from: result.from,
        to: result.to,
        selectedIds: ids,
      },
    });
  }

  function handlePrintClick() {
    if (selectedIds.size === 0) return;
    if (result?.kind === "PO_GROUP") {
      setVendorConfirmed(false);
      setShowVendorModal(true);
      return;
    }
    goToPreview();
  }

  const dateLabel = useMemo(() => fmtDate(result?.date), [result?.date]);

  return (
    <ErpScreenScaffold title="Print PO/STO" subtitle="Bulk print, download, or reprint PO/STO copies by Group Number">
      <ErpSectionCard eyebrow="Step 1" title="Enter Group Number">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Group Number
            <input
              value={groupNumberInput}
              onChange={(event) => setGroupNumberInput(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && handleLookup()}
              placeholder="e.g. 9700000004"
              className="h-9 w-64 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
            />
          </label>
          <button
            type="button"
            onClick={handleLookup}
            disabled={loading}
            className="h-9 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? "Looking up..." : "Find"}
          </button>
        </div>
        {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
      </ErpSectionCard>

      {result ? (
        <ErpSectionCard eyebrow="Step 2" title="Documents under this Group Number">
          <div className="mb-4 grid grid-cols-2 gap-3 border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-5">
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500">Group Number</div>
              <div className="font-semibold text-slate-900">{result.group_number}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500">From</div>
              <div className="font-semibold text-slate-900">{result.from?.company_name ?? result.from?.vendor_name ?? "--"}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500">To</div>
              <div className="font-semibold text-slate-900">{result.to?.company_name ?? result.to?.vendor_name ?? "--"}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500">Date</div>
              <div className="font-semibold text-slate-900">{dateLabel}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500">Number of PO/STO</div>
              <div className="font-semibold text-slate-900">{result.count}</div>
            </div>
          </div>

          {documents.length === 0 ? (
            <p className="text-sm text-slate-500">No Confirmed or Cancelled documents found for this Group Number yet.</p>
          ) : (
            <>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-300 bg-slate-100 text-left text-xs font-semibold uppercase text-slate-600">
                    <th className="w-10 px-2 py-2">
                      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                    </th>
                    <th className="px-2 py-2">Document No.</th>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id} className="border-b border-slate-200">
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(doc.id)}
                          onChange={() => toggleRow(doc.id)}
                        />
                      </td>
                      <td className="px-2 py-2 font-semibold text-slate-900">{doc.document_number}</td>
                      <td className="px-2 py-2">{fmtDate(doc.document_date)}</td>
                      <td className="px-2 py-2">{doc.status}</td>
                      <td className="px-2 py-2">
                        {doc.revised ? (
                          <span className="border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-semibold uppercase text-amber-700">
                            Revise
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={handlePrintClick}
                  disabled={selectedIds.size === 0}
                  className="h-9 border border-sky-600 bg-sky-600 px-5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Print ({selectedIds.size})
                </button>
              </div>
            </>
          )}
        </ErpSectionCard>
      ) : null}

      {showVendorModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md border border-slate-300 bg-white p-5 shadow-lg">
            <h3 className="text-base font-semibold text-slate-900">Confirm Vendor Contact</h3>
            <p className="mt-1 text-sm text-slate-600">
              Verify this is the correct vendor before generating the copy.
            </p>
            <div className="mt-3 grid gap-1 border border-slate-200 bg-slate-50 p-3 text-sm">
              <div><span className="font-semibold">Vendor:</span> {result?.to?.vendor_name ?? "--"}</div>
              <div><span className="font-semibold">Contact:</span> {result?.to?.primary_contact_name ?? "--"} {result?.to?.primary_contact_phone ? `(${result.to.primary_contact_phone})` : ""}</div>
              <div><span className="font-semibold">Email:</span> {result?.to?.primary_email ?? "--"}</div>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={vendorConfirmed}
                onChange={(event) => setVendorConfirmed(event.target.checked)}
              />
              I confirm this is correct
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowVendorModal(false)}
                className="h-9 border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!vendorConfirmed}
                onClick={() => {
                  setShowVendorModal(false);
                  goToPreview();
                }}
                className="h-9 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ErpScreenScaffold>
  );
}
