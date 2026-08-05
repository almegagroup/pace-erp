/*
 * File-Path: frontend/src/pages/dashboard/procurement/print/PrintGroupPage.jsx
 * Domain: PROCUREMENT
 * Purpose: PO19 "Print PO/STO" â€” landing page + Group Number entry flow.
 * Authority: Frontend
 */

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { lookupPrintGroup } from "../procurementApi.js";

export default function PrintGroupPage() {
  const navigate = useNavigate();
  const [entryOpen, setEntryOpen] = useState(false);
  const [groupNumberInput, setGroupNumberInput] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLookup() {
    const trimmed = groupNumberInput.trim();
    const selectedType = documentType.trim();
    if (!selectedType) {
      setError("Select PO or STO first.");
      return;
    }
    if (!trimmed) {
      setError("Enter a Group Number.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await lookupPrintGroup(trimmed);
      const data = response?.data ?? response;
      if (selectedType === "PO" && data?.kind !== "PO_GROUP") {
        setError("This Group Number does not belong to a PO group.");
        return;
      }
      if (selectedType === "STO" && data?.kind !== "STO") {
        setError("This Group Number does not belong to an STO.");
        return;
      }
      openScreen(OPERATION_SCREENS.PROC_PO_STO_PRINT_DETAIL.screen_code);
      navigate(`/dashboard/procurement/print/group/${encodeURIComponent(trimmed)}`, {
        state: {
          result: data,
          group_number: trimmed,
        },
      });
    } catch (err) {
      setError(err?.message || "Group Number not found.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ErpScreenScaffold title="Print PO/STO" subtitle="Open a Group Number, confirm the matching documents, then preview for print or download">
      <ErpSectionCard eyebrow="PO19" title="Print Flow">
        <div className="grid gap-3 text-sm text-slate-700">
          <p>Start the PO19 flow from here. Enter the Group Number, choose whether the set belongs to a PO or STO flow, confirm the matching documents, then move to preview.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setEntryOpen(true);
                setError("");
              }}
              className="h-9 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white"
            >
              Enter Group Number
            </button>
          </div>
        </div>
      </ErpSectionCard>

      {entryOpen ? (
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
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              PO / STO
              <select
                value={documentType}
                onChange={(event) => setDocumentType(event.target.value)}
                className="h-9 w-40 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">Select</option>
                <option value="PO">PO</option>
                <option value="STO">STO</option>
              </select>
            </label>
            <button
              type="button"
              onClick={handleLookup}
              disabled={loading}
              className="h-9 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              {loading ? "Looking up..." : "Confirm"}
            </button>
          </div>
          {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
        </ErpSectionCard>
      ) : null}
    </ErpScreenScaffold>
  );
}
