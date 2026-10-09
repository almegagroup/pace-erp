/* VDC-only Truck + Dispatch Date upload/review, §6 point 19. */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DrawerBase from "../../../../components/layer/DrawerBase.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import { downloadCsvFile } from "../../../../shared/downloadTabularFile.js";
import { listVdcTruckDispatchPending, postVdcTruckDispatch } from "../procurementApi.js";

export default function VdcTruckDispatchUploadDrawer({ companyId, onClose, onSaved }) {
  const [edits, setEdits] = useState({});
  const [posting, setPosting] = useState(false);
  const [notice, setNotice] = useState("");
  const query = useQuery({
    queryKey: ["procurement", "vdc-truck-dispatch", companyId],
    queryFn: () => listVdcTruckDispatchPending(companyId),
    enabled: Boolean(companyId),
  });
  const sourceRows = useMemo(() => Array.isArray(query.data?.items) ? query.data.items : [], [query.data]);
  const rows = useMemo(() => sourceRows.map((row) => ({
    ...row,
    truck_number: edits[row.dc_id]?.truck_number ?? row.truck_number ?? "",
    dispatch_date: edits[row.dc_id]?.dispatch_date ?? row.dispatch_date ?? "",
  })), [edits, sourceRows]);

  function setField(row, field, value) {
    // An FO is one physical dispatch event: an edit must follow every SKU/DO
    // row carrying that FO, not just the cell the user happened to change.
    const sameEvent = sourceRows.filter((candidate) => row.fo_number
      ? candidate.fo_number === row.fo_number
      : candidate.dc_id === row.dc_id);
    setEdits((current) => {
      const next = { ...current };
      for (const candidate of sameEvent) {
        next[candidate.dc_id] = { ...(next[candidate.dc_id] ?? {}), [field]: value };
      }
      return next;
    });
  }

  function downloadTemplate() {
    downloadCsvFile({
      fileName: `vdc_truck_dispatch_pending_${companyId}.csv`,
      columns: [
        { key: "fo_number", label: "FO Number" }, { key: "ship_to", label: "Ship-To Address" },
        { key: "sku", label: "SKU" }, { key: "storage_location", label: "Storage Location" },
        { key: "truck_number", label: "Truck Number" }, { key: "dispatch_date", label: "Dispatch Date" },
      ],
      rows,
    });
  }

  async function post() {
    const byDcId = new Map();
    for (const row of rows) {
      if (String(row.truck_number || "").trim() && String(row.dispatch_date || "").trim()) {
        byDcId.set(row.dc_id, { dc_id: row.dc_id, truck_number: row.truck_number, dispatch_date: row.dispatch_date });
      }
    }
    if (!byDcId.size) { setNotice("Enter both Truck Number and Dispatch Date for at least one pending FO before posting."); return; }
    setPosting(true); setNotice("");
    try {
      const result = await postVdcTruckDispatch([...byDcId.values()]);
      const outcomes = Array.isArray(result?.results) ? result.results : [];
      const failed = outcomes.filter((row) => !row.ok);
      setNotice(failed.length ? `${outcomes.length - failed.length} posted; ${failed.length} remain pending.` : `${outcomes.length} VDC delivery order(s) posted.`);
      await query.refetch(); onSaved?.();
    } catch (error) { setNotice(error instanceof Error ? error.message : "VDC_UPLOAD_POST_FAILED"); }
    finally { setPosting(false); }
  }

  return <DrawerBase visible title="Truck and Dispatch Date Upload — VDC" onEscape={onClose} onClose={onClose} width="min(1480px, calc(100vw - 24px))"
    actions={<div className="flex gap-2"><button type="button" onClick={downloadTemplate} disabled={!rows.length} className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50">Download Prefilled Template</button><button type="button" onClick={() => void post()} disabled={posting || !rows.length} className="border border-sky-700 bg-sky-100 px-3 py-2 text-xs font-semibold text-sky-950 disabled:opacity-50">{posting ? "Posting…" : "Post PGI"}</button><button type="button" onClick={onClose} className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold">Close</button></div>}>
    <div className="grid gap-3">
      <p className="text-xs text-slate-600">Only pending VDC Invoice-only rows appear. Leaving either Truck Number or Dispatch Date blank keeps that FO pending. A value entered for one FO row is propagated to every row of that FO.</p>
      {query.error ? <p className="border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">{query.error instanceof Error ? query.error.message : "VDC_UPLOAD_PENDING_FAILED"}</p> : null}
      {notice ? <p className={`border px-3 py-2 text-xs font-semibold ${notice.includes("remain pending") || notice.includes("FAILED") ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>{notice}</p> : null}
      <ErpDenseGrid cellNavigate rows={rows} rowKey={(row) => `${row.dc_id}-${row.storage_location_id}-${row.sku}`} emptyMessage={query.isLoading ? "Loading pending VDC rows…" : "No pending VDC Invoice-only rows."}
        columns={[
          { key: "fo_number", label: "FO Number", width: "145px", render: (row) => row.fo_number || "—" },
          { key: "ship_to", label: "Ship-To Address", width: "220px", render: (row) => row.ship_to || "—" },
          { key: "sku", label: "SKU", width: "190px", render: (row) => row.sku || "—" },
          { key: "storage_location", label: "Storage Location", width: "165px", render: (row) => row.storage_location || "—" },
          { key: "lr_date", label: "LR Date", width: "115px", render: (row) => row.lr_date || "—" },
          { key: "truck_number", label: "Truck Number", width: "160px", render: (row) => <input aria-label={`Truck Number ${row.dc_number}`} value={row.truck_number} onChange={(event) => setField(row, "truck_number", event.target.value)} className="h-7 w-full border border-slate-300 bg-white px-2 text-xs" /> },
          { key: "dispatch_date", label: "Dispatch Date", width: "160px", render: (row) => <input aria-label={`Dispatch Date ${row.dc_number}`} type="date" value={row.dispatch_date} onChange={(event) => setField(row, "dispatch_date", event.target.value)} className="h-7 w-full border border-slate-300 bg-white px-2 text-xs" /> },
        ]} />
    </div>
  </DrawerBase>;
}
