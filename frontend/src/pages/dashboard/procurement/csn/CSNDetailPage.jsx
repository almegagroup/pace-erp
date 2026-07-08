import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { popScreen } from "../../../../navigation/screenStackEngine.js";
import {
  getCSN,
  listCSNs,
  listPorts,
  listTransporters,
  updateCSN,
} from "../procurementApi.js";

const STATUS_LABELS = {
  ORD: "Ordered",
  TRN: "In Transit",
  GED: "GE Done",
  GRD: "GRN Done",
  CAN: "Cancelled",
  KOF: "Knocked Off",
};

function buildForm(detail) {
  return {
    dispatch_qty: detail?.dispatch_qty ?? "",
    port_of_loading_id: detail?.port_of_loading_id ?? "",
    port_of_discharge_id: detail?.port_of_discharge_id ?? "",
    vessel_name: detail?.vessel_name ?? "",
    voyage_number: detail?.voyage_number ?? "",
    bl_number: detail?.bl_number ?? "",
    boe_number: detail?.boe_number ?? "",
    cha_id: detail?.cha_id ?? "",
    cha_name_freetext: detail?.cha_name_freetext ?? "",
    scheduled_eta_to_port: detail?.scheduled_eta_to_port ?? "",
    etd: detail?.etd ?? "",
    bl_date: detail?.bl_date ?? "",
    eta_at_port: detail?.eta_at_port ?? "",
    ata_at_port: detail?.ata_at_port ?? "",
    post_clearance_lr_date: detail?.post_clearance_lr_date ?? "",
    transporter_id: detail?.transporter_id ?? "",
    transporter_name_freetext: detail?.transporter_name_freetext ?? "",
    lr_number_port_to_plant: detail?.lr_number_port_to_plant ?? "",
    vehicle_number_port_to_plant: detail?.vehicle_number_port_to_plant ?? "",
    lc_opened_date: detail?.lc_opened_date ?? "",
    lc_number: detail?.lc_number ?? "",
    vessel_booking_confirmed_date: detail?.vessel_booking_confirmed_date ?? "",
    lr_date: detail?.lr_date ?? "",
    lr_number: detail?.lr_number ?? "",
    vehicle_number: detail?.vehicle_number ?? "",
    domestic_transporter_id: detail?.domestic_transporter_id ?? "",
    domestic_transporter_freetext: detail?.domestic_transporter_freetext ?? "",
    vendor_indent_number: detail?.vendor_indent_number ?? "",
    gate_entry_date: detail?.gate_entry_date ?? "",
    grn_date: detail?.grn_date ?? "",
    received_qty: detail?.received_qty ?? "",
    invoice_number: detail?.invoice_number ?? "",
    remarks: detail?.remarks ?? "",
    transit_days_snapshot: detail?.transit_days_snapshot ?? "",
  };
}

function buildTransporterDisplay(detail) {
  const code = detail?.transporter_code;
  const name = detail?.transporter_name;
  if (code && name) return `${code} — ${name}`;
  if (name) return name;
  return "";
}

function TransporterSearchField({ value, displayValue, onChange }) {
  const [search, setSearch] = useState(displayValue || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    setSearch(displayValue || "");
  }, [displayValue]);

  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        if (!value) setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [value]);

  function handleInput(e) {
    const q = e.target.value;
    setSearch(q);
    setOpen(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await listTransporters({ search: q, limit: 20 });
        setResults(Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []);
      } catch {
        setResults([]);
      }
    }, 300);
  }

  function handleSelect(row) {
    const label = `${row.transporter_code} — ${row.transporter_name}`;
    setSearch(label);
    setOpen(false);
    onChange(row.id, row.transporter_name);
  }

  function handleClear() {
    setSearch("");
    setResults([]);
    setOpen(false);
    onChange("", "");
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-1">
        <input
          value={search}
          onChange={handleInput}
          onFocus={() => { setOpen(true); if (!search) handleInput({ target: { value: "" } }); }}
          placeholder="Search transporter..."
          className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
        />
        {value ? (
          <button type="button" onClick={handleClear} className="h-8 px-2 border border-slate-300 bg-white text-slate-500 hover:bg-slate-50 text-xs">✕</button>
        ) : null}
      </div>
      {open && results.length > 0 ? (
        <ul className="absolute z-30 left-0 right-0 top-full mt-0.5 border border-slate-300 bg-white shadow-lg max-h-48 overflow-y-auto">
          {results.map((row) => (
            <li
              key={row.id}
              onMouseDown={() => handleSelect(row)}
              className="cursor-pointer px-3 py-1.5 text-sm hover:bg-sky-50"
            >
              {row.transporter_code} — {row.transporter_name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function toPayload(form) {
  const payload = {};
  Object.entries(form).forEach(([key, value]) => {
    payload[key] = value === "" ? null : value;
  });
  return payload;
}

function getTone(value) {
  switch (String(value || "").toUpperCase()) {
    case "TRN":
      return "amber";
    case "GED":
      return "emerald";
    case "GRD":
    case "CAN":
    case "KOF":
      return "slate";
    case "IMPORT":
      return "sky";
    case "DOMESTIC":
      return "emerald";
    default:
      return "slate";
  }
}

function getStatusLabel(value) {
  return STATUS_LABELS[String(value || "").toUpperCase()] || value || "—";
}

function getCsnDisplayLabel(row) {
  if (!row) {
    return "—";
  }
  const prefix = row.mother_csn_id && !row.sto_id ? "Sub-CSN" : "CSN";
  const number = row.csn_number || row.id || "";
  return `${prefix}-${number}`;
}

export default function CSNDetailPage() {
  const { id = "" } = useParams();
  const { runtimeContext } = useMenu();
  const [detail, setDetail] = useState(null);
  const [relatedCsns, setRelatedCsns] = useState([]);
  const [form, setForm] = useState(buildForm(null));
  const [loadingPorts, setLoadingPorts] = useState([]);
  const [dischargePorts, setDischargePorts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [domesticTransporterDisplay, setDomesticTransporterDisplay] = useState("");
  const [importTransporterDisplay, setImportTransporterDisplay] = useState("");

  const subCsns = useMemo(
    () => relatedCsns.filter((row) => row.mother_csn_id === detail?.id),
    [detail?.id, relatedCsns]
  );
  const motherCsn = useMemo(
    () =>
      detail?.mother_csn_id
        ? relatedCsns.find((row) => row.id === detail.mother_csn_id) ?? null
        : null,
    [detail?.mother_csn_id, relatedCsns]
  );

  const loadDetail = useCallback(async () => {
    if (!id) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const fetched = await getCSN(id);
      const data = fetched?.data ?? fetched;
      setDetail(data);
      setForm(buildForm(data));
      setDomesticTransporterDisplay(buildTransporterDisplay(data));
      setImportTransporterDisplay(buildTransporterDisplay(data));

      const scopedCompanyId = data?.company_id || runtimeContext?.selectedCompanyId || "";
      const siblingRows = data?.po_id
        ? await listCSNs({
            company_id: scopedCompanyId,
            po_id: data.po_id,
            limit: 200,
            offset: 0,
          })
        : { data: [] };
      setRelatedCsns(Array.isArray(siblingRows?.data) ? siblingRows.data : []);
    } catch (loadError) {
      setDetail(null);
      setRelatedCsns([]);
      setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_CSN_DETAIL_FAILED");
    } finally {
      setLoading(false);
    }
  }, [id, runtimeContext?.selectedCompanyId]);

  useEffect(() => {
    void loadDetail();
    listPorts({ is_active: "true", port_role: "LOADING" }).then((data) => {
      setLoadingPorts(Array.isArray(data) ? data : []);
    }).catch(() => {});
    listPorts({ is_active: "true", port_role: "DISCHARGE" }).then((data) => {
      setDischargePorts(Array.isArray(data) ? data : []);
    }).catch(() => {});
  }, [loadDetail]);

  function patchField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    if (!detail?.id || !detail?.company_id) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updateCSN(detail.id, {
        company_id: detail.company_id,
        ...toPayload(form),
      });
      setNotice("CSN detail updated.");
      await loadDetail();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PROCUREMENT_CSN_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement"
      title="Consignment Detail"
      notices={[
        ...(error ? [{ key: "csn-detail-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "csn-detail-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "save", label: saving ? "Saving..." : "Save CSN", tone: "primary", onClick: () => void handleSave(), disabled: saving || loading || !detail },
      ]}
    >
      {loading || !detail ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading consignment detail..." : "Consignment detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            Use the CSN Tracker expanded row for split-dispatch, Sub-CSN, and bulk field-edit work. This detail screen stays available for document review and lifecycle follow-up.
          </div>

          {detail.mother_csn_id ? (
            <div className="border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              Sub CSN of {getCsnDisplayLabel(motherCsn) || detail.mother_csn_id}
            </div>
          ) : null}

          <ErpSectionCard eyebrow="Header" title={getCsnDisplayLabel(detail)}>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <ErpFieldPreview label="CSN Type" value={detail.csn_type} tone={getTone(detail.csn_type)} />
              <ErpFieldPreview label="Status" value={getStatusLabel(detail.status)} tone={getTone(detail.status)} />
              <ErpFieldPreview
                label={detail.sto_id ? "Linked STO" : "Linked PO"}
                value={
                  detail.sto_id ? (
                    <Link
                      to={`/dashboard/procurement/stos/${encodeURIComponent(detail.sto_id)}`}
                      className="text-sky-700 underline underline-offset-2"
                    >
                      {detail.sto_number || detail.sto_id}
                    </Link>
                  ) : detail.po_id ? (
                    <Link
                      to={`/dashboard/procurement/purchase-orders/${encodeURIComponent(detail.po_id)}`}
                      className="text-sky-700 underline underline-offset-2"
                    >
                      {detail.po_number || detail.po_id}
                    </Link>
                  ) : "—"
                }
              />
              <ErpFieldPreview
                label="Linked GE"
                value={
                  Array.isArray(detail.gate_entries) && detail.gate_entries.length > 0
                    ? detail.gate_entries.map((entry) => entry.ge_number || entry.id).join(", ")
                    : "—"
                }
              />
              <ErpFieldPreview label="Linked GRN" value={detail.grn?.grn_number || detail.grn?.id || "—"} />
              <ErpFieldPreview label="ETA Plant" value={detail.eta_to_plant_calculated || "—"} />
            </div>
          </ErpSectionCard>

          {detail.csn_type === "IMPORT" ? (
            <ErpSectionCard eyebrow="Import Fields" title="Import leg planning">
              <div className="grid gap-3 lg:grid-cols-2">
                <ErpDenseFormRow label="Port Of Loading">
                  <select value={form.port_of_loading_id} onChange={(event) => patchField("port_of_loading_id", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500">
                    <option value="">— Select —</option>
                    {loadingPorts.map((p) => <option key={p.id} value={p.id}>{p.port_code} — {p.port_name}</option>)}
                  </select>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Discharge Port">
                  <select value={form.port_of_discharge_id} onChange={(event) => patchField("port_of_discharge_id", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500">
                    <option value="">— Select —</option>
                    {dischargePorts.map((p) => <option key={p.id} value={p.id}>{p.port_code} — {p.port_name}</option>)}
                  </select>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Vessel Name">
                  <input value={form.vessel_name} onChange={(event) => patchField("vessel_name", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="BL Number">
                  <input value={form.bl_number} onChange={(event) => patchField("bl_number", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="ETD Origin">
                  <input type="date" value={form.etd || ""} onChange={(event) => patchField("etd", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="ETA Destination Port">
                  <input type="date" value={form.eta_at_port || ""} onChange={(event) => patchField("eta_at_port", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Scheduled ETA Port">
                  <input type="date" value={form.scheduled_eta_to_port || ""} onChange={(event) => patchField("scheduled_eta_to_port", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Transit Days (Port→Plant)">
                  <div className="grid gap-1">
                    <input
                      type="number" min="0"
                      value={form.transit_days_snapshot}
                      onChange={(event) => patchField("transit_days_snapshot", event.target.value === "" ? "" : Number(event.target.value))}
                      placeholder="Auto-filled when port is set"
                      className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
                    />
                    <span className="text-[10px] text-slate-400">Frozen at port assignment. Edit only to correct this specific shipment.</span>
                  </div>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="LC Required">
                  <div className="text-sm text-slate-700">{detail.lc_required ? "Yes" : "No"}</div>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="LC Number">
                  <input value={form.lc_number} onChange={(event) => patchField("lc_number", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="LC Opened Date">
                  <input type="date" value={form.lc_opened_date || ""} onChange={(event) => patchField("lc_opened_date", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
              </div>
            </ErpSectionCard>
          ) : null}

          {detail.csn_type === "DOMESTIC" ? (
            <ErpSectionCard eyebrow="Domestic Fields" title="Domestic dispatch">
              <div className="grid gap-3 lg:grid-cols-2">
                <ErpDenseFormRow label="LR Date">
                  <input type="date" value={form.lr_date || ""} onChange={(event) => patchField("lr_date", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="LR Number">
                  <input value={form.lr_number} onChange={(event) => patchField("lr_number", event.target.value)} className="h-8 w-full border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500" />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Transporter">
                  <TransporterSearchField
                    value={form.domestic_transporter_id}
                    displayValue={domesticTransporterDisplay}
                    onChange={(id, name) => {
                      patchField("domestic_transporter_id", id);
                      patchField("domestic_transporter_freetext", name);
                    }}
                  />
                </ErpDenseFormRow>
              </div>
            </ErpSectionCard>
          ) : null}

          <ErpSectionCard eyebrow="Sub CSNs" title="Split dispatch references">
            <div className="grid gap-3">
              <div className="border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                Sub-CSN creation, reconciliation, and deletion now happen from the CSN Tracker row so the full working flow stays in one surface.
              </div>
              <ErpDenseGrid
                columns={[
                  { key: "csn_number", label: "Sub CSN", width: "140px" },
                  { key: "dispatch_qty", label: "Dispatch Qty", width: "120px" },
                  { key: "status", label: "Status", width: "120px" },
                  {
                    key: "gate_entry_id",
                    label: "Linked GE",
                    width: "140px",
                    render: (row) => row.gate_entry_id || "—",
                  },
                  {
                    key: "actions",
                    label: "Tracker",
                    width: "180px",
                    render: () => "Manage from Tracker",
                  },
                ]}
                rows={subCsns}
                rowKey={(row) => row.id}
                emptyMessage="No sub CSNs linked to this record."
              />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Receiving" title="Gate entry and GRN linkage">
            <ErpDenseGrid
              columns={[
                { key: "id", label: "Gate Entry Line", width: "150px" },
                { key: "gate_entry_id", label: "Gate Entry", width: "150px" },
                { key: "received_qty", label: "Received Qty", width: "120px" },
                { key: "net_weight_received", label: "Net Weight", width: "120px" },
              ]}
              rows={detail.gate_entry_lines ?? []}
              rowKey={(row) => row.id}
              emptyMessage="No gate entry lines linked yet."
            />
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
