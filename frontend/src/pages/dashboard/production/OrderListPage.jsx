/*
 * File-ID: 27.FE-PR13
 * File-Path: frontend/src/pages/dashboard/production/OrderListPage.jsx
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Combined production order list plus minimal INT completion action.
 * Authority: Frontend
 */

import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ModalBase from "../../../components/layer/ModalBase.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { completeIntProcessOrder, getProcessOrder, listPackingOrders, listProcessOrders } from "./prodApi.js";

const PROCESS_STATUS_COLORS = {
  STANDARD: "bg-slate-100 text-slate-700",
  QA_APPROVED: "bg-sky-100 text-sky-700",
  QA_REJECTED: "bg-rose-100 text-rose-700",
  BATCH_STARTED: "bg-amber-100 text-amber-800",
  FINAL: "bg-purple-100 text-purple-700",
  VERIFIED: "bg-emerald-100 text-emerald-700",
  REVERSED: "bg-slate-100 text-slate-500",
  CANCELLED: "bg-slate-100 text-slate-500",
};

const ALL_PROCESS_STATUSES = ["STANDARD", "QA_APPROVED", "QA_REJECTED", "BATCH_STARTED", "FINAL", "VERIFIED", "REVERSED", "CANCELLED"];
const TABS = ["Process Orders", "Packing Orders"];

function companyLabel(company) {
  return [company.company_code, company.company_name].filter(Boolean).join(" - ");
}

function StatusChips({ selected, onToggle, statuses, colors }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {statuses.map((status) => (
        <button
          key={status}
          onClick={() => onToggle(status)}
          className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
            selected === status
              ? `${colors[status] ?? "bg-slate-100 text-slate-700"} border-transparent shadow-sm`
              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
          }`}
        >
          {status.replace(/_/g, " ")}
        </button>
      ))}
    </div>
  );
}

export default function OrderListPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const [companyId, setCompanyId] = useState("");
  const [search, setSearch] = useState("");
  const [processStatus, setProcessStatus] = useState("");
  const [packingStatus, setPackingStatus] = useState("");
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [intModalOrderId, setIntModalOrderId] = useState("");
  const [intLineDrafts, setIntLineDrafts] = useState([]);
  const [actualOutputQty, setActualOutputQty] = useState("");
  const [savingInt, setSavingInt] = useState(false);

  const { runtimeContext } = useMenu();
  const companies = runtimeContext?.availableCompanies ?? [];
  const companyOptions = useMemo(
    () => companies.map((company) => ({ value: company.id, label: companyLabel(company) || "Company" })),
    [companies],
  );

  const processQ = useQuery({
    queryKey: ["process-orders", companyId, processStatus, search],
    queryFn: () => listProcessOrders({
      company_id: companyId || undefined,
      status: processStatus || undefined,
      per_page: 100,
    }),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
    enabled: activeTab === 0,
  });

  const packingQ = useQuery({
    queryKey: ["packing-orders", companyId, packingStatus, search],
    queryFn: () => listPackingOrders({
      company_id: companyId || undefined,
      status: packingStatus || undefined,
      search: search || undefined,
    }),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
    enabled: activeTab === 1,
  });

  const intDetailQ = useQuery({
    queryKey: ["int-complete-detail", intModalOrderId],
    queryFn: () => getProcessOrder(intModalOrderId),
    enabled: Boolean(intModalOrderId),
  });

  useEffect(() => {
    if (!intDetailQ.data) {
      setIntLineDrafts([]);
      setActualOutputQty("");
      return;
    }
    setIntLineDrafts((intDetailQ.data.lines ?? []).map((line) => ({
      id: line.id,
      materialLabel: [line.material?.pace_code, line.material?.material_name].filter(Boolean).join(" - ") || "Material",
      actual_qty: String(line.planned_qty ?? 0),
    })));
    setActualOutputQty(String(intDetailQ.data.planned_qty ?? 0));
  }, [intDetailQ.data]);

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  const processOrders = (processQ.data ?? []).filter((order) => {
    const haystack = [order.po_number, order.material?.material_name, order.material?.pace_code, order.batch_number].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });
  const packingOrders = packingQ.data ?? [];

  async function handleCompleteInt() {
    if (!intDetailQ.data) return;
    setSavingInt(true);
    try {
      await completeIntProcessOrder(intDetailQ.data.id, {
        lines: intLineDrafts.map((line) => ({ id: line.id, actual_qty: Number(line.actual_qty || 0) })),
        actual_output_qty: Number(actualOutputQty || 0),
      });
      toast("INT Process PO completed.");
      setIntModalOrderId("");
      qc.invalidateQueries({ queryKey: ["process-orders"] });
    } catch (error) {
      toast(error.message || "INT completion failed.", "error");
    } finally {
      setSavingInt(false);
    }
  }

  return (
    <ErpScreenScaffold
      title="Order List - PR13"
      subtitle="Combined production order list"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Filters">
        <div className="flex flex-wrap gap-3">
          <div className="flex min-w-[240px] flex-col gap-1">
            <label className="text-xs text-slate-500">Company</label>
            <ErpComboboxField
              value={companyId}
              onChange={setCompanyId}
              options={companyOptions}
              placeholder="-- Select company --"
            />
          </div>
          <div className="flex min-w-[240px] flex-col gap-1">
            <label className="text-xs text-slate-500">Search</label>
            <input
              className="rounded border border-slate-300 px-2 py-1 text-sm"
              placeholder="PO number, batch, prodshade..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
      </ErpSectionCard>

      <ErpSectionCard>
        <div className="mb-4 flex gap-0 border-b border-slate-200">
          {TABS.map((tab, index) => (
            <button
              key={tab}
              onClick={() => setActiveTab(index)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === index ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 0 && (
          <>
            <div className="mb-4">
              <p className="mb-1.5 text-xs text-slate-500">Quick filter by status:</p>
              <StatusChips
                selected={processStatus}
                onToggle={(status) => setProcessStatus((current) => current === status ? "" : status)}
                statuses={ALL_PROCESS_STATUSES}
                colors={PROCESS_STATUS_COLORS}
              />
            </div>
            {processQ.isLoading ? (
              <p className="py-4 text-center text-sm text-slate-500">Loading...</p>
            ) : processOrders.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">No process orders found.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <th className="border-b px-3 py-2 text-left">PO Number</th>
                    <th className="border-b px-3 py-2 text-left">Type</th>
                    <th className="border-b px-3 py-2 text-left">Prodshade</th>
                    <th className="border-b px-3 py-2 text-right">Planned Qty</th>
                    <th className="border-b px-3 py-2 text-left">Batch #</th>
                    <th className="border-b px-3 py-2 text-left">Status</th>
                    <th className="border-b px-3 py-2 text-left">Created</th>
                    <th className="border-b px-3 py-2 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {processOrders.map((order) => (
                    <tr key={order.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono font-semibold text-sky-700">{order.po_number || "--"}</td>
                      <td className="px-3 py-2">{order.po_type || "--"}</td>
                      <td className="px-3 py-2">{[order.material?.pace_code, order.material?.material_name].filter(Boolean).join(" - ") || "--"}</td>
                      <td className="px-3 py-2 text-right font-mono">{Number(order.planned_qty || 0).toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono text-slate-500">{order.batch_number || "--"}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PROCESS_STATUS_COLORS[order.status] ?? ""}`}>
                          {order.status?.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-400">{order.created_at?.slice(0, 10) || "--"}</td>
                      <td className="px-3 py-2">
                        {order.po_type === "INT" && order.status === "STANDARD" ? (
                          <button
                            onClick={() => setIntModalOrderId(order.id)}
                            className="text-sm font-medium text-emerald-700 hover:underline"
                          >
                            Complete
                          </button>
                        ) : (
                          <span className="text-slate-300">--</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {activeTab === 1 && (
          <>
            <div className="mb-4">
              <p className="mb-1.5 text-xs text-slate-500">Quick filter by status:</p>
              <StatusChips
                selected={packingStatus}
                onToggle={(status) => setPackingStatus((current) => current === status ? "" : status)}
                statuses={["STANDARD", "FINAL", "VERIFIED", "REVERSED", "CANCELLED"]}
                colors={PROCESS_STATUS_COLORS}
              />
            </div>
            {packingQ.isLoading ? (
              <p className="py-4 text-center text-sm text-slate-500">Loading...</p>
            ) : packingOrders.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">No packing orders found.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <th className="border-b px-3 py-2 text-left">PO Number</th>
                    <th className="border-b px-3 py-2 text-left">Planned Qty</th>
                    <th className="border-b px-3 py-2 text-left">Status</th>
                    <th className="border-b px-3 py-2 text-left">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {packingOrders.map((order) => (
                    <tr key={order.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono font-semibold text-sky-700">{order.po_number || "--"}</td>
                      <td className="px-3 py-2 font-mono">{Number(order.planned_qty_kg || 0).toLocaleString()}</td>
                      <td className="px-3 py-2">{order.status || "--"}</td>
                      <td className="px-3 py-2 text-xs text-slate-400">{order.created_at?.slice(0, 10) || "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </ErpSectionCard>

      <ModalBase
        visible={Boolean(intModalOrderId)}
        title={intDetailQ.data ? `Complete INT - ${intDetailQ.data.po_number}` : "Complete INT"}
        onClose={() => setIntModalOrderId("")}
      >
        <div className="flex flex-col gap-4 p-4">
          {intDetailQ.isLoading ? (
            <p className="text-sm text-slate-400">Loading...</p>
          ) : intDetailQ.data ? (
            <>
              <div className="grid gap-3 md:grid-cols-2 text-sm">
                <div><span className="block text-xs text-slate-400">PO #</span><p className="font-mono font-semibold text-sky-700">{intDetailQ.data.po_number || "--"}</p></div>
                <div><span className="block text-xs text-slate-400">Prodshade</span><p>{[intDetailQ.data.material?.pace_code, intDetailQ.data.material?.material_name].filter(Boolean).join(" - ") || "--"}</p></div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <th className="border-b px-3 py-2 text-left">Material</th>
                      <th className="border-b px-3 py-2 text-right">Actual Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {intLineDrafts.map((line) => (
                      <tr key={line.id} className="border-b border-slate-100">
                        <td className="px-3 py-2">{line.materialLabel}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            className="w-28 rounded border border-slate-300 px-2 py-1 text-right font-mono text-sm"
                            value={line.actual_qty}
                            onChange={(event) => setIntLineDrafts((current) => current.map((entry) => (
                              entry.id === line.id ? { ...entry, actual_qty: event.target.value } : entry
                            )))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Actual Output Qty</label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  className="max-w-[180px] rounded border border-slate-300 px-2 py-1 text-right font-mono text-sm"
                  value={actualOutputQty}
                  onChange={(event) => setActualOutputQty(event.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCompleteInt}
                  disabled={savingInt}
                  className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                >
                  {savingInt ? "Completing..." : "Complete INT"}
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">No INT detail loaded.</p>
          )}
        </div>
      </ModalBase>
    </ErpScreenScaffold>
  );
}
