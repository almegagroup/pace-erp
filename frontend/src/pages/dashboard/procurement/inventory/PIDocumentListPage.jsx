import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listStorageLocations } from "../../om/omApi.js";
import {
  createPIDocument,
  listPIDocuments,
} from "../procurementApi.js";

const STATUS_OPTIONS = ["", "OPEN", "COUNTED", "POSTED"];
const MODE_OPTIONS = ["LOCATION_WISE", "ITEM_WISE"];

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "COUNTED":
      return "bg-amber-100 text-amber-800";
    case "POSTED":
      return "bg-emerald-100 text-emerald-800";
    case "OPEN":
    default:
      return "bg-sky-100 text-sky-800";
  }
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB");
}

function normalizeLocationRows(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  return Array.isArray(payload) ? payload : [];
}

export default function PIDocumentListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const selectedCompanyId = runtimeContext?.selectedCompanyId || "";
  const [rows, setRows] = useState([]);
  const [storageLocations, setStorageLocations] = useState([]);
  const [filters, setFilters] = useState({ plant_id: "", status: "" });
  const [form, setForm] = useState({
    mode: "LOCATION_WISE",
    plant_id: "",
    storage_location_id: "",
    count_date: new Date().toISOString().slice(0, 10),
    posting_date: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setForm((current) => ({
      ...current,
      posting_date: current.posting_date || current.count_date,
    }));
  }, []);

  useEffect(() => {
    setForm((current) => {
      if (!current.count_date) {
        return current;
      }
      const postingDate = current.posting_date || current.count_date;
      return postingDate === current.posting_date
        ? current
        : { ...current, posting_date: current.count_date };
    });
  }, [form.count_date]);

  async function loadDocuments(nextFilters = filters) {
    setLoading(true);
    setError("");
    try {
      const result = await listPIDocuments({
        plant_id: nextFilters.plant_id || undefined,
        status: nextFilters.status || undefined,
      });
      setRows(Array.isArray(result?.items) ? result.items : []);
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : "PI_DOCUMENT_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDocuments(filters);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;

    async function loadLocations() {
      if (!form.plant_id.trim()) {
        setStorageLocations([]);
        setForm((current) => ({ ...current, storage_location_id: "" }));
        return;
      }
      try {
        const result = await listStorageLocations({
          company_id: selectedCompanyId || undefined,
          plant_id: form.plant_id.trim(),
          is_active: true,
        });
        if (!active) return;
        setStorageLocations(normalizeLocationRows(result));
      } catch {
        if (!active) return;
        setStorageLocations([]);
      }
    }

    void loadLocations();
    return () => {
      active = false;
    };
  }, [form.plant_id, selectedCompanyId]);

  const locationOptions = useMemo(
    () =>
      storageLocations.map((row) => ({
        value: row.id,
        label: `${row.code ?? row.storage_location_code ?? row.name ?? row.storage_location_name ?? row.id}`,
      })),
    [storageLocations],
  );

  const metrics = useMemo(
    () => [
      {
        label: "Documents",
        value: rows.length,
        caption: "Physical inventory documents in the current filter.",
        tone: "sky",
      },
      {
        label: "Open",
        value: rows.filter((row) => String(row.status).toUpperCase() === "OPEN").length,
        caption: "Documents still collecting counts.",
        tone: "amber",
      },
      {
        label: "Posted",
        value: rows.filter((row) => String(row.status).toUpperCase() === "POSTED").length,
        caption: "Documents already posted to stock ledger.",
        tone: "emerald",
      },
    ],
    [rows],
  );

  async function handleCreateDocument() {
    if (!form.plant_id.trim() || !form.storage_location_id || !form.count_date || !form.posting_date) {
      setError("Plant, storage location, count date, and posting date are required.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await createPIDocument({
        mode: form.mode,
        plant_id: form.plant_id.trim(),
        storage_location_id: form.storage_location_id,
        count_date: form.count_date,
        posting_date: form.posting_date,
        notes: form.notes.trim() || null,
      });
      setNotice(`Physical inventory document ${created.document_number || "created"} is ready.`);
      await loadDocuments(filters);
      if (created?.id) {
        openScreen(OPERATION_SCREENS.PROC_PI_DETAIL.screen_code);
        navigate(`/dashboard/procurement/physical-inventory/${encodeURIComponent(created.id)}`);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PI_DOCUMENT_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  async function applyFilters(patch) {
    const next = { ...filters, ...patch };
    setFilters(next);
    await loadDocuments(next);
  }

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_PI_DETAIL.screen_code);
    navigate(`/dashboard/procurement/physical-inventory/${encodeURIComponent(row.id)}`);
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement Inventory"
      title="Physical Inventory Documents"
      notices={[
        ...(error ? [{ key: "pi-list-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "pi-list-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void loadDocuments(filters),
        },
        {
          key: "create",
          label: saving ? "Creating..." : "Create PI Document",
          tone: "primary",
          onClick: () => void handleCreateDocument(),
          disabled: saving,
        },
      ]}
      filterSection={{
        eyebrow: "Summary",
        title: "Register and create",
        children: (
          <div className="grid gap-3 xl:grid-cols-3">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded border border-slate-200 bg-white px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{metric.label}</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{metric.value}</div>
                <div className="mt-1 text-sm text-slate-500">{metric.caption}</div>
              </div>
            ))}
          </div>
        ),
      }}
      listSection={{
        eyebrow: "PI Register",
        title: loading ? "Loading physical inventory documents" : `${rows.length} document row${rows.length === 1 ? "" : "s"}`,
        children: (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
            <div className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <ErpDenseFormRow label="Plant Filter">
                  <input
                    value={filters.plant_id}
                    onChange={(event) => void applyFilters({ plant_id: event.target.value })}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    placeholder="Plant ID"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Status Filter">
                  <select
                    value={filters.status}
                    onChange={(event) => void applyFilters({ status: event.target.value })}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    {STATUS_OPTIONS.map((entry) => (
                      <option key={entry || "ALL"} value={entry}>
                        {entry || "ALL"}
                      </option>
                    ))}
                  </select>
                </ErpDenseFormRow>
              </div>
              <ErpDenseGrid
                columns={[
                  { key: "document_number", label: "Document #", width: "140px" },
                  { key: "mode", label: "Mode", width: "130px" },
                  { key: "plant_id", label: "Plant", width: "120px" },
                  { key: "storage_location_id", label: "Storage Location", width: "160px" },
                  { key: "count_date", label: "Count Date", width: "110px", render: (row) => formatDate(row.count_date) },
                  { key: "posting_date", label: "Posting Date", width: "110px", render: (row) => formatDate(row.posting_date) },
                  { key: "item_count", label: "Items", width: "70px" },
                  { key: "counted_count", label: "Counted", width: "80px", render: (row) => `${row.counted_count ?? 0}/${row.item_count ?? 0}` },
                  {
                    key: "status",
                    label: "Status",
                    width: "100px",
                    render: (row) => (
                      <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusTone(row.status)}`}>
                        {row.status}
                      </span>
                    ),
                  },
                ]}
                rows={rows}
                rowKey={(row) => row.id}
                onRowActivate={openDetail}
                getRowProps={(row) => ({
                  onDoubleClick: () => openDetail(row),
                  className: "cursor-pointer hover:bg-sky-50",
                })}
                emptyMessage={loading ? "Loading physical inventory documents..." : "No physical inventory documents found."}
                maxHeight="460px"
              />
            </div>

            <div className="rounded border border-slate-200 bg-white p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Create</div>
              <div className="mt-1 text-lg font-semibold text-slate-900">New PI document</div>
              <div className="mt-4 grid gap-3">
                <ErpDenseFormRow label="Mode" required>
                  <select
                    value={form.mode}
                    onChange={(event) => setForm((current) => ({ ...current, mode: event.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    {MODE_OPTIONS.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Plant ID" required>
                  <input
                    value={form.plant_id}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        plant_id: event.target.value,
                        storage_location_id: "",
                      }))
                    }
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    placeholder="Plant ID"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Storage Location" required>
                  <select
                    value={form.storage_location_id}
                    onChange={(event) => setForm((current) => ({ ...current, storage_location_id: event.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    <option value="">Select storage location</option>
                    {locationOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Count Date" required>
                  <input
                    type="date"
                    value={form.count_date}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        count_date: event.target.value,
                        posting_date:
                          current.posting_date === current.count_date
                            ? event.target.value
                            : current.posting_date,
                      }))
                    }
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Posting Date" required>
                  <input
                    type="date"
                    value={form.posting_date}
                    onChange={(event) => setForm((current) => ({ ...current, posting_date: event.target.value }))}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Notes">
                  <textarea
                    value={form.notes}
                    onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                    className="min-h-[84px] w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                  Posting date defaults from count date, but stays independently editable for backdated year-end posting.
                </div>
              </div>
            </div>
          </div>
        ),
      }}
    />
  );
}
