import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import { listPendingSalesReturnGenealogy, listPendingSalesReturnStrokes } from "../procurement/procurementApi.js";

export default function SalesReturnPendingButton({ companyId, kind }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const isStroke = kind === "STROKE";
  const query = useQuery({
    queryKey: ["so05-pending-production", kind, companyId],
    queryFn: () => isStroke
      ? listPendingSalesReturnStrokes({ company_id: companyId })
      : listPendingSalesReturnGenealogy({ company_id: companyId, kind }),
    enabled: !!companyId,
    select: (data) => Array.isArray(data) ? data : data?.data ?? [],
  });
  const data = query.data ?? [];
  const pendingCount = data.length;
  // All-column search — business owner, 2026-09-26: "wherever ErpDenseGrid
  // is used, an all-column search bar must be there too". Matches any
  // column's own displayed value, not just a hand-picked subset.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((row) =>
      Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(q)));
  }, [data, search]);
  const columns = isStroke
    ? [{ key: "source", label: "Source" }, { key: "po_type", label: "PO Type" }, { key: "stroke_number", label: "Stroke" }, { key: "material_code", label: "Prodshade" }, { key: "material_name", label: "Description" }]
    : [{ key: "source", label: "Source" }, { key: "po_type", label: "PO Type" }, { key: "stroke_number", label: "Stroke" }, { key: "batch_number", label: "Batch" }, { key: "material_code", label: kind === "PACKING" ? "SKU" : "Prodshade" }, { key: "material_name", label: "Description" }, { key: "quantity", label: "Quantity", align: "right" }, { key: "uom_code", label: "UOM" }];
  const label = isStroke ? "Pending Strokes" : "Pending Entries";
  return <>
    <button
      type="button"
      disabled={!companyId || query.isLoading || pendingCount === 0}
      onClick={() => setOpen(true)}
      className={`relative px-3 py-1.5 text-sm border disabled:opacity-50 ${
        pendingCount > 0
          ? "border-rose-500 bg-rose-50 text-rose-800 hover:bg-rose-100"
          : "border-slate-400 bg-white text-slate-800 hover:bg-slate-50"
      }`}
    >
      {pendingCount > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-1.5 -right-1.5 h-3 w-3 rounded-full bg-rose-600 ring-2 ring-white"
        />
      )}
      {label}{pendingCount ? ` (${pendingCount})` : ""}
    </button>
    {open && <div className="fixed inset-0 z-[100] bg-slate-950/40 flex items-center justify-center p-6" role="dialog" aria-modal="true"><div className="bg-white shadow-xl border border-slate-300 w-full max-w-5xl max-h-[80vh] overflow-auto"><div className="sticky top-0 bg-white border-b p-3 flex items-center justify-between"><div><h2 className="font-semibold">{label}</h2><p className="text-xs text-slate-500">SO05 entries disappear automatically after the matching master/genealogy record is saved.</p></div><button onClick={() => setOpen(false)} className="border rounded px-3 py-1">Close</button></div><div className="p-3 space-y-2"><QuickFilterInput value={search} onChange={setSearch} placeholder="Search any column…" /><ErpDenseGrid rows={filtered} columns={columns} rowKey={(row, index) => `${row.material_id}-${row.po_type}-${row.stroke_number}-${row.batch_number}-${index}`} emptyMessage={search ? "No rows match the search." : "No pending entries."} /></div></div></div>}
  </>;
}
