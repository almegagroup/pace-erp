/*
 * PIDocumentPrintPage — MI21, §119.4/§119.15. Companion page (no menu_master row, no separate
 * TX code — reached from the Detail page's "Print Count Sheet" button, same ACL resource as
 * IN01 itself). PID number resolves via route param; shows Material+SLoc+Batch with a BLANK
 * count field (book qty deliberately NOT shown — counting on paper should not be biased by the
 * expected number) for the floor team to fill in by hand before MI04 data entry.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { getPIDocument } from "../procurementApi.js";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB");
}

export default function PIDocumentPrintPage() {
  const { id = "" } = useParams();
  const detailQuery = useQuery({
    queryKey: ["procurement", "pi-document-print", id],
    queryFn: () => getPIDocument(id),
    enabled: Boolean(id),
  });
  const detail = detailQuery.data ?? null;
  const items = useMemo(() => (Array.isArray(detail?.items) ? detail.items : []), [detail]);

  if (detailQuery.isLoading || !detail) {
    return (
      <div className="p-6 text-sm text-slate-500">
        {detailQuery.isLoading ? "Loading count sheet..." : "PI document is unavailable."}
      </div>
    );
  }

  return (
    <div className="p-6 print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <div className="text-sm text-slate-500">Physical count sheet — for floor counting, book quantity intentionally hidden.</div>
        <button
          type="button"
          onClick={() => window.print()}
          className="border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900"
        >
          Print
        </button>
      </div>

      <div className="mb-4">
        <div className="text-lg font-semibold text-slate-900">Physical Inventory Count Sheet</div>
        <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-700 md:grid-cols-4">
          <div><span className="font-semibold">PID #:</span> {detail.document_number}</div>
          <div><span className="font-semibold">Company:</span> {detail.company_name ?? detail.company_code ?? "—"}</div>
          <div><span className="font-semibold">Count Date:</span> {formatDate(detail.count_date)}</div>
          <div><span className="font-semibold">Mode:</span> {detail.mode}</div>
        </div>
      </div>

      {/* thead {display:table-header-group} makes this repeat on every printed page —
          the "Header Freeze" requirement (§119.15). */}
      <table className="w-full border-collapse text-sm">
        <thead className="print-repeat-header">
          <tr className="border-b-2 border-slate-900">
            <th className="border border-slate-400 px-2 py-1 text-left">Line</th>
            <th className="border border-slate-400 px-2 py-1 text-left">Material</th>
            <th className="border border-slate-400 px-2 py-1 text-left">Batch</th>
            <th className="border border-slate-400 px-2 py-1 text-left">Location</th>
            <th className="border border-slate-400 px-2 py-1 text-left">Stock Type</th>
            <th className="border border-slate-400 px-2 py-1 text-left">UoM</th>
            <th className="border border-slate-400 px-2 py-1 text-left">Physical Count (fill in)</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id}>
              <td className="border border-slate-300 px-2 py-2">{row.line_number}</td>
              <td className="border border-slate-300 px-2 py-2">{row.material_name ? `${row.material_name} (${row.material_pace_code ?? "—"})` : "—"}</td>
              <td className="border border-slate-300 px-2 py-2">{row.batch_number ?? "—"}</td>
              <td className="border border-slate-300 px-2 py-2">{row.storage_location_code ?? "—"}</td>
              <td className="border border-slate-300 px-2 py-2">{row.stock_type}</td>
              <td className="border border-slate-300 px-2 py-2">{row.base_uom_code}</td>
              <td className="border border-slate-300 px-2 py-2">&nbsp;</td>
            </tr>
          ))}
        </tbody>
      </table>

      <style>{`
        @media print {
          .print-repeat-header { display: table-header-group; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
