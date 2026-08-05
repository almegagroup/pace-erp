/*
 * File-Path: frontend/src/pages/dashboard/procurement/print/PrintGroupPage.jsx
 * Domain: PROCUREMENT
 * Purpose: PO19 "Print PO/STO" — landing page with company filter + visible
 *          group list, then Group Number prompt before opening step flow.
 * Authority: Frontend
 */

import React, { useEffect, useMemo, useState } from "react";
import ErpScreenScaffold, { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import ErpCompanySelector from "../../../../components/inputs/ErpCompanySelector.jsx";
import { buildTransactionCompanyList } from "../../../../components/inputs/transactionCompanyRuntime.js";
import { openRouteWithContext } from "../../../../navigation/screenStackEngine.js";
import { listPrintGroups, lookupPrintGroup } from "../procurementApi.js";

function fmtDate(value) {
  if (!value) return "--";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function PrintGroupPage() {
  const { runtimeContext } = useMenu();
  const companies = useMemo(() => buildTransactionCompanyList(runtimeContext), [runtimeContext]);
  const [companyFilter, setCompanyFilter] = useState("*");
  const [rows, setRows] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [printPromptOpen, setPrintPromptOpen] = useState(false);
  const [groupNumberInput, setGroupNumberInput] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoadingList(true);
    setError("");
    (async () => {
      try {
        const response = await listPrintGroups(companyFilter === "*" ? undefined : { company_id: companyFilter });
        if (!cancelled) {
          setRows(response?.data ?? response ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || "Unable to load Group Number list.");
          setRows([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingList(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyFilter]);

  async function handleLookup() {
    const trimmed = groupNumberInput.trim();
    if (!trimmed) {
      setError("Enter a Group Number.");
      return;
    }
    setLookupLoading(true);
    setError("");
    try {
      const response = await lookupPrintGroup(trimmed);
      const data = response?.data ?? response;
      setPrintPromptOpen(false);
      openRouteWithContext(`/dashboard/procurement/print/group/${encodeURIComponent(trimmed)}`, {
        groupNumber: trimmed,
        result: data,
        group_number: trimmed,
      });
    } catch (err) {
      setError(err?.message || "Group Number not found.");
    } finally {
      setLookupLoading(false);
    }
  }

  return (
    <ErpScreenScaffold title="Print PO/STO" subtitle="Review available Group Numbers by company, then open the print flow from the Group Number prompt">
      <ErpSectionCard eyebrow="PO19" title="Group Number Details">
        <div className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-[280px]">
              <ErpCompanySelector
                companies={companies}
                value={companyFilter}
                onChange={setCompanyFilter}
                mode="all"
                label="Company"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setPrintPromptOpen(true);
                setError("");
              }}
              className="h-9 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white"
            >
              Print
            </button>
          </div>

          <p className="text-sm text-slate-700">
            `All` shows every accessible company&apos;s Group Number summary. Choosing a company filters the list before the user enters a Group Number for print.
          </p>

          {loadingList ? (
            <p className="text-sm text-slate-500">Loading Group Number details...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">No Group Number details were found for the selected company filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-300 bg-slate-100 text-left text-xs font-semibold uppercase text-slate-600">
                    <th className="px-2 py-2">Group Number</th>
                    <th className="px-2 py-2">Type</th>
                    <th className="px-2 py-2">Company</th>
                    <th className="px-2 py-2">From</th>
                    <th className="px-2 py-2">To</th>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Number of PO/STO</th>
                    <th className="px-2 py-2">State</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.kind}-${row.group_number}`} className="border-b border-slate-200">
                      <td className="px-2 py-2 font-semibold text-slate-900">{row.group_number}</td>
                      <td className="px-2 py-2">{row.kind === "PO_GROUP" ? "PO" : "STO"}</td>
                      <td className="px-2 py-2">{row.company_name || "--"}</td>
                      <td className="px-2 py-2">{row.from_name || "--"}</td>
                      <td className="px-2 py-2">{row.to_name || "--"}</td>
                      <td className="px-2 py-2">{fmtDate(row.date)}</td>
                      <td className="px-2 py-2">{row.count ?? 0}</td>
                      <td className="px-2 py-2">
                        {row.revised ? (
                          <span className="border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-semibold uppercase text-amber-700">
                            Revise
                          </span>
                        ) : (
                          <span className="text-slate-400">--</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </ErpSectionCard>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {printPromptOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md border border-slate-300 bg-white p-5 shadow-lg">
            <h3 className="text-base font-semibold text-slate-900">Enter Group Number</h3>
            <p className="mt-1 text-sm text-slate-600">
              Enter the Group Number. PO or STO will be derived automatically from the shared series.
            </p>
            <label className="mt-4 grid gap-1 text-xs font-semibold text-slate-700">
              Group Number
              <input
                value={groupNumberInput}
                onChange={(event) => setGroupNumberInput(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleLookup()}
                placeholder="e.g. 9700000004"
                className="h-9 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPrintPromptOpen(false)}
                className="h-9 border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLookup}
                disabled={lookupLoading}
                className="h-9 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                {lookupLoading ? "Looking up..." : "Enter"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ErpScreenScaffold>
  );
}
