/*
 * File-ID: 27.FE-FG-STOCK-BREAKDOWN
 * File-Path: frontend/src/pages/dashboard/production/FgStockBreakdownPage.jsx
 * Gate: 27.23
 * Purpose: Read-only FG stock breakdown by production batch and Packing PO.
 */

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import { useMenu } from "../../../context/useMenu.js";
import { listMaterials } from "../om/omApi.js";
import { getFgStockBreakdown } from "./prodApi.js";

function materialLabel(material) {
  return [material?.pace_code || material?.external_code, material?.material_name].filter(Boolean).join(" - ");
}
function companyLabel(company) {
  return [company?.company_code, company?.company_name].filter(Boolean).join(" - ");
}

export function FgStockBreakdownTable({ batches }) {
  if (!batches?.length) {
    return <p className="text-sm text-slate-400 py-4 text-center">No FG stock receipt rows found.</p>;
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead className="bg-slate-50">
          <tr>
            <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Batch Number</th>
            <th className="text-right py-2 px-3 text-[10px] uppercase text-slate-500">Batch Qty</th>
            <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Packing PO</th>
            <th className="text-left py-2 px-3 text-[10px] uppercase text-slate-500">Type</th>
            <th className="text-right py-2 px-3 text-[10px] uppercase text-slate-500">Packs</th>
            <th className="text-right py-2 px-3 text-[10px] uppercase text-slate-500">Fill Qty</th>
            <th className="text-right py-2 px-3 text-[10px] uppercase text-slate-500">Receipt Qty</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <React.Fragment key={batch.batch_number}>
              <tr className="border-t bg-slate-50/70">
                <td className="py-2 px-3 font-mono font-semibold">{batch.batch_number}</td>
                <td className="py-2 px-3 text-right font-mono font-semibold">{Number(batch.quantity ?? 0).toFixed(3)}</td>
                <td className="py-2 px-3" colSpan={5}></td>
              </tr>
              {(batch.packing_orders ?? []).map((po, index) => (
                <tr key={`${batch.batch_number}-${po.po_number}-${index}`} className="border-t border-slate-100">
                  <td className="py-2 px-3"></td>
                  <td className="py-2 px-3"></td>
                  <td className="py-2 px-3 font-mono">{po.po_number}</td>
                  <td className="py-2 px-3">{[po.source_po_type, po.po_type].filter(Boolean).join(" / ") || "-"}</td>
                  <td className="py-2 px-3 text-right font-mono">{po.num_packs ?? "-"}</td>
                  <td className="py-2 px-3 text-right font-mono">{po.fill_qty_per_pack ?? "-"}</td>
                  <td className="py-2 px-3 text-right font-mono">{Number(po.quantity ?? 0).toFixed(3)}</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FgStockBreakdownPage() {
  const [companyId, setCompanyId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const { runtimeContext } = useMenu();
  const materialsQ = useQuery({
    queryKey: ["om-materials", "FG", "fg-stock-breakdown"],
    queryFn: () => listMaterials({ material_type: "FG", limit: 500 }),
    select: (data) => data?.data ?? [],
  });
  const companies = runtimeContext?.availableCompanies ?? [];
  const effectiveCompanyId = companyId || (companies.length === 1 ? companies[0].id : "");
  const reportQ = useQuery({
    queryKey: ["fg-stock-breakdown", effectiveCompanyId, materialId],
    queryFn: () => getFgStockBreakdown({ company_id: effectiveCompanyId, material_id: materialId }),
    enabled: Boolean(effectiveCompanyId && materialId),
  });

  return (
    <ErpScreenScaffold title="FG Stock Breakdown" subtitle="Read-only FG stock by batch and Packing PO">
      <ErpSectionCard title="Filters">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs text-slate-500">
            Company
            <select className="mt-1 h-9 w-full border border-slate-300 rounded px-2 text-sm" value={effectiveCompanyId} onChange={(event) => setCompanyId(event.target.value)} disabled={companies.length <= 1}>
              <option value="">-- Select --</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{companyLabel(company)}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            FG Material
            <ErpComboboxField
              value={materialId}
              onChange={setMaterialId}
              options={(materialsQ.data ?? []).map((material) => ({ value: material.id, label: materialLabel(material) }))}
              placeholder="-- Select FG material --"
            />
          </label>
        </div>
      </ErpSectionCard>
      <ErpSectionCard title={reportQ.data?.material ? materialLabel(reportQ.data.material) : "Breakdown"}>
        {reportQ.isFetching ? <p className="text-sm text-slate-400 py-4 text-center">Loading...</p> : <FgStockBreakdownTable batches={reportQ.data?.batches ?? []} />}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
