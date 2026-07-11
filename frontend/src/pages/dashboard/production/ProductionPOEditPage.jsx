/*
 * File-ID: 27.FE-PR10
 * File-Path: frontend/src/pages/dashboard/production/ProductionPOEditPage.jsx
 * Gate: 27
 * Phase: 27
 * Domain: PRODUCTION
 * Purpose: Edit Process PO machine and planned quantities only for PR10.
 * Authority: Frontend
 */

import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { useCompaniesForOmQuery } from "../../../hooks/queries/useOmMasterQueries.js";
import { editProcessOrder, getProcessOrder, listProcessOrders } from "./prodApi.js";
import { listMachines } from "../om/omApi.js";

const EDITABLE_STATUSES = ["QA_APPROVED", "BATCH_STARTED"];

function companyLabel(company) {
  return [company.company_code, company.company_name].filter(Boolean).join(" - ");
}

function machineLabel(machine) {
  return [machine.machine_code, machine.machine_name].filter(Boolean).join(" - ");
}

function orderLabel(order) {
  return [order.po_number, order.material?.material_name, order.po_type].filter(Boolean).join(" - ");
}

export default function ProductionPOEditPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [notice, setNotice] = useState({ msg: "", tone: "success" });
  const [saving, setSaving] = useState(false);
  const [machineId, setMachineId] = useState("");
  const [lineDrafts, setLineDrafts] = useState([]);

  const companiesQ = useCompaniesForOmQuery();
  const companyOptions = useMemo(
    () => (companiesQ.data ?? []).map((company) => ({ value: company.id, label: companyLabel(company) || "Company" })),
    [companiesQ.data],
  );

  const ordersQ = useQuery({
    queryKey: ["production-edit-orders", companyId],
    queryFn: () => listProcessOrders({
      company_id: companyId || undefined,
      po_type_in: "MTO,HPS,MTS,INT",
      per_page: 100,
    }),
    enabled: Boolean(companyId),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const orderOptions = useMemo(
    () => (ordersQ.data ?? []).map((order) => ({ value: order.id, label: orderLabel(order) || order.po_number || "Process PO" })),
    [ordersQ.data],
  );

  const detailQ = useQuery({
    queryKey: ["production-edit-detail", orderId],
    queryFn: () => getProcessOrder(orderId),
    enabled: Boolean(orderId),
  });

  const machinesQ = useQuery({
    queryKey: ["production-edit-machines", detailQ.data?.company_id],
    queryFn: () => listMachines({ company_id: detailQ.data.company_id, active: true }),
    enabled: Boolean(detailQ.data?.company_id),
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const machineOptions = useMemo(
    () => (machinesQ.data ?? []).map((machine) => ({ value: machine.id, label: machineLabel(machine) || "Machine" })),
    [machinesQ.data],
  );

  const po = detailQ.data ?? null;
  const canEdit = Boolean(po && EDITABLE_STATUSES.includes(po.status));

  useEffect(() => {
    if (!po) {
      setMachineId("");
      setLineDrafts([]);
      return;
    }
    setMachineId(po.machine_id || "");
    setLineDrafts((po.lines ?? []).map((line) => ({
      id: line.id,
      materialLabel: [line.material?.pace_code, line.material?.material_name].filter(Boolean).join(" - ") || "Material",
      planned_qty: String(line.planned_qty ?? 0),
    })));
  }, [po]);

  function toast(msg, tone = "success") {
    setNotice({ msg, tone });
    setTimeout(() => setNotice({ msg: "", tone: "success" }), 3500);
  }

  async function handleSave() {
    if (!po || !canEdit) return;
    setSaving(true);
    try {
      await editProcessOrder(po.id, {
        machine_id: machineId || undefined,
        lines: lineDrafts.map((line) => ({
          id: line.id,
          planned_qty: Number(line.planned_qty || 0),
        })),
      });
      toast("Process PO updated.");
      qc.invalidateQueries({ queryKey: ["process-orders"] });
      qc.invalidateQueries({ queryKey: ["production-edit-detail", po.id] });
    } catch (error) {
      toast(error.message || "Edit failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      title="Production PO Edit - PR10"
      subtitle="Machine and planned quantity edit only"
      notice={notice.msg ? { message: notice.msg, tone: notice.tone } : null}
    >
      <ErpSectionCard title="Select Process PO">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Company</label>
            <ErpComboboxField
              value={companyId}
              onChange={(value) => {
                setCompanyId(value);
                setOrderId("");
              }}
              options={companyOptions}
              placeholder="-- Select company --"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Process PO</label>
            <ErpComboboxField
              value={orderId}
              onChange={setOrderId}
              options={orderOptions}
              placeholder="-- Select process PO --"
              emptyStateLabel={ordersQ.isLoading ? "Loading process orders..." : "No process orders for this company"}
              disabled={!companyId}
            />
          </div>
        </div>
      </ErpSectionCard>

      {po && (
        <ErpSectionCard title="PR10 Edit">
          <div className="mb-4 grid gap-4 md:grid-cols-3 text-sm">
            <div>
              <span className="block text-xs text-slate-400">PO #</span>
              <p className="font-mono font-semibold text-sky-700">{po.po_number || "--"}</p>
            </div>
            <div>
              <span className="block text-xs text-slate-400">Type</span>
              <p>{po.po_type || "--"}</p>
            </div>
            <div>
              <span className="block text-xs text-slate-400">Status</span>
              <p>{po.status || "--"}</p>
            </div>
          </div>

          {!canEdit ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This Process PO is blocked for PR10 edit. Only `QA_APPROVED` and `BATCH_STARTED` are allowed.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="max-w-md flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">Machine</label>
                <ErpComboboxField
                  value={machineId}
                  onChange={setMachineId}
                  options={machineOptions}
                  placeholder="-- Select machine --"
                  emptyStateLabel={machinesQ.isLoading ? "Loading machines..." : "No active machines for this company"}
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <th className="border-b px-3 py-2 text-left">Material</th>
                      <th className="border-b px-3 py-2 text-right">Planned Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineDrafts.map((line) => (
                      <tr key={line.id} className="border-b border-slate-100">
                        <td className="px-3 py-2">{line.materialLabel}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min="0.001"
                            step="0.001"
                            className="w-28 rounded border border-slate-300 px-2 py-1 text-right font-mono text-sm"
                            value={line.planned_qty}
                            onChange={(event) => setLineDrafts((current) => current.map((entry) => (
                              entry.id === line.id ? { ...entry, planned_qty: event.target.value } : entry
                            )))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save PR10 Edit"}
                </button>
              </div>
            </div>
          )}
        </ErpSectionCard>
      )}
    </ErpScreenScaffold>
  );
}
