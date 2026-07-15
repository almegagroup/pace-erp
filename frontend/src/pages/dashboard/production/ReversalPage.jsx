/*
 * File-ID: 27.FE-PR15
 * File-Path: frontend/src/pages/dashboard/production/ReversalPage.jsx
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Process PO reversal page for PR15.
 * Authority: Frontend
 */

import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { useCompaniesForOmQuery } from "../../../hooks/queries/useOmMasterQueries.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { getPackingOrder, getProcessOrder, listPackingOrders, listProcessOrders, reversePackingOrder, reverseProcessOrder } from "./prodApi.js";

const REVERSAL_TABS = ["Process PO", "Packing PO"];

function companyLabel(company) {
  return [company.company_code, company.company_name].filter(Boolean).join(" - ");
}

function orderLabel(order) {
  return [order.po_number, order.material?.material_name, order.po_type].filter(Boolean).join(" - ");
}

function packingOrderLabel(order) {
  return [order.po_number, order.material?.material_name, order.po_type].filter(Boolean).join(" - ");
}

function PackingReversalTab() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [saving, setSaving] = useState(false);

  const companiesQ = useCompaniesForOmQuery();
  const companyOptions = useMemo(
    () => (companiesQ.data ?? []).map((company) => ({ value: company.id, label: companyLabel(company) || "Company" })),
    [companiesQ.data],
  );

  const ordersQ = useQuery({
    queryKey: ["packing-reversal-orders", companyId],
    queryFn: () => listPackingOrders({ company_id: companyId || undefined, per_page: 100 }),
    enabled: Boolean(companyId),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const orderOptions = useMemo(
    () => (ordersQ.data ?? []).map((order) => ({ value: order.id, label: packingOrderLabel(order) || order.po_number || "Packing PO" })),
    [ordersQ.data],
  );

  const detailQ = useQuery({
    queryKey: ["packing-reversal-detail", orderId],
    queryFn: () => getPackingOrder(orderId),
    enabled: Boolean(orderId),
  });
  const po = detailQ.data ?? null;

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  async function handleReverse() {
    if (!po) return;
    const confirmed = await openActionConfirm({
      eyebrow: "Packing PO",
      title: "Reverse this Packing PO?",
      message: "This will cancel open reservations and reverse any posted stock.",
      confirmLabel: "Reverse",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await reversePackingOrder(po.id);
      toast("Packing PO reversed.");
      qc.invalidateQueries({ queryKey: ["pack-orders"] });
      qc.invalidateQueries({ queryKey: ["packing-reversal-detail", po.id] });
      detailQ.refetch();
    } catch (error) {
      toast(error.message || "Reversal failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  const canReverse = Boolean(po && po.status !== "REVERSED");

  return (
    <div className="flex flex-col gap-4">
      {notice.msg ? (
        <div className={`rounded px-3 py-2 text-sm ${notice.tone === "error" ? "border border-rose-200 bg-rose-50 text-rose-700" : "border border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {notice.msg}
        </div>
      ) : null}

      <ErpSectionCard title="Select Packing PO">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Company</label>
            <ErpComboboxField
              value={companyId}
              onChange={(value) => { setCompanyId(value); setOrderId(""); }}
              options={companyOptions}
              placeholder="-- Select company --"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Packing PO</label>
            <ErpComboboxField
              value={orderId}
              onChange={setOrderId}
              options={orderOptions}
              placeholder="-- Select packing PO --"
              emptyStateLabel={ordersQ.isLoading ? "Loading packing orders..." : "No packing orders for this company"}
              disabled={!companyId}
            />
          </div>
        </div>
      </ErpSectionCard>

      {po && (
        <ErpSectionCard title="PR15 Reverse">
          <div className="grid gap-3 md:grid-cols-4 text-sm">
            <div><span className="block text-xs text-slate-400">PO #</span><p className="font-mono font-semibold text-sky-700">{po.po_number || "--"}</p></div>
            <div><span className="block text-xs text-slate-400">Status</span><p>{po.status || "--"}</p></div>
            <div><span className="block text-xs text-slate-400">Type</span><p>{po.source_po_type || "--"} / {po.po_type || "--"}</p></div>
            <div><span className="block text-xs text-slate-400">SFG Batch</span><p className="font-mono">{po.batch_number || "--"}</p></div>
          </div>

          <div className="mt-4">
            <button
              onClick={handleReverse}
              disabled={!canReverse || saving}
              className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
            >
              {saving ? "Reversing..." : "Reverse"}
            </button>
          </div>
        </ErpSectionCard>
      )}
    </div>
  );
}

function ProcessReversalTab() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const companiesQ = useCompaniesForOmQuery();
  const companyOptions = useMemo(
    () => (companiesQ.data ?? []).map((company) => ({ value: company.id, label: companyLabel(company) || "Company" })),
    [companiesQ.data],
  );

  const ordersQ = useQuery({
    queryKey: ["production-reversal-orders", companyId],
    queryFn: () => listProcessOrders({ company_id: companyId || undefined, per_page: 100 }),
    enabled: Boolean(companyId),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const orderOptions = useMemo(
    () => (ordersQ.data ?? []).map((order) => ({ value: order.id, label: orderLabel(order) || order.po_number || "Process PO" })),
    [ordersQ.data],
  );

  const detailQ = useQuery({
    queryKey: ["production-reversal-detail", orderId],
    queryFn: () => getProcessOrder(orderId),
    enabled: Boolean(orderId),
  });
  const po = detailQ.data ?? null;

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  async function handleReverse() {
    if (!po || !reason.trim()) return;
    setSaving(true);
    try {
      const response = await reverseProcessOrder(po.id, { reason: reason.trim() });
      setResult(response);
      toast("Process PO reversed.");
      qc.invalidateQueries({ queryKey: ["process-orders"] });
      qc.invalidateQueries({ queryKey: ["production-reversal-detail", po.id] });
    } catch (error) {
      toast(error.message || "Reversal failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  const canConfirm = Boolean(po && !["STANDARD", "REVERSED", "CANCELLED"].includes(po.status) && reason.trim());

  return (
    <div className="flex flex-col gap-4">
      {notice.msg ? (
        <div className={`rounded px-3 py-2 text-sm ${notice.tone === "error" ? "border border-rose-200 bg-rose-50 text-rose-700" : "border border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {notice.msg}
        </div>
      ) : null}
      <ErpSectionCard title="Select Process PO">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Company</label>
            <ErpComboboxField
              value={companyId}
              onChange={(value) => {
                setCompanyId(value);
                setOrderId("");
                setResult(null);
              }}
              options={companyOptions}
              placeholder="-- Select company --"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Process PO</label>
            <ErpComboboxField
              value={orderId}
              onChange={(value) => {
                setOrderId(value);
                setResult(null);
              }}
              options={orderOptions}
              placeholder="-- Select process PO --"
              emptyStateLabel={ordersQ.isLoading ? "Loading process orders..." : "No process orders for this company"}
              disabled={!companyId}
            />
          </div>
        </div>
      </ErpSectionCard>

      {po && (
        <ErpSectionCard title="PR15 Reverse">
          <div className="grid gap-3 md:grid-cols-2 text-sm">
            <div><span className="block text-xs text-slate-400">PO #</span><p className="font-mono font-semibold text-sky-700">{po.po_number || "--"}</p></div>
            <div><span className="block text-xs text-slate-400">Status</span><p>{po.status || "--"}</p></div>
            <div><span className="block text-xs text-slate-400">Type</span><p>{po.po_type || "--"}</p></div>
            <div><span className="block text-xs text-slate-400">Batch #</span><p className="font-mono">{po.batch_number || "--"}</p></div>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <label className="text-xs font-medium text-slate-600">Reason <span className="text-rose-500">*</span></label>
            <textarea
              rows={3}
              className="rounded border border-slate-300 px-2 py-1.5 text-sm resize-none"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason is mandatory before Confirm is enabled"
            />
          </div>

          <div className="mt-4">
            <button
              onClick={handleReverse}
              disabled={!canConfirm || saving}
              className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
            >
              {saving ? "Reversing..." : "Confirm"}
            </button>
          </div>

          {result && (
            <div className="mt-4 flex flex-col gap-3 rounded border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm">
                <span className="font-medium text-slate-600">Result Status:</span> {result.status || "--"}
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Reversed Movements</div>
                {Array.isArray(result.ledger_entries) && result.ledger_entries.length > 0 ? (
                  <ul className="list-disc pl-5 text-sm text-slate-700">
                    {result.ledger_entries.map((entry, index) => (
                      <li key={`${entry.movement}-${index}`}>
                        {entry.movement} {entry.direction ? `(${entry.direction})` : ""} {entry.stock_document_id ? `- ${entry.stock_document_id}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No ledger entries were returned.</p>
                )}
              </div>
            </div>
          )}
        </ErpSectionCard>
      )}
    </div>
  );
}

export default function ReversalPage() {
  const [activeTab, setActiveTab] = useState(0);
  return (
    <ErpScreenScaffold
      title="Reversal - PR15"
      subtitle="CORS reversal for Process PO and Packing PO"
    >
      <ErpSectionCard>
        <div className="mb-4 flex gap-0 border-b border-slate-200">
          {REVERSAL_TABS.map((tab, index) => (
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
        {activeTab === 0 ? <ProcessReversalTab /> : <PackingReversalTab />}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
