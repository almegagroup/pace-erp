import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listSTOs } from "../procurementApi.js";

const LIMIT = 50;

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "DISPATCHED":
      return "bg-sky-100 text-sky-800";
    case "RECEIVED":
      return "bg-emerald-100 text-emerald-800";
    case "CLOSED":
      return "bg-slate-200 text-slate-800";
    case "CANCELLED":
      return "bg-rose-100 text-rose-800";
    case "CREATED":
    default:
      return "bg-amber-100 text-amber-800";
  }
}

function typeTone(stoType) {
  switch (String(stoType || "").toUpperCase()) {
    case "INTER_PLANT":
      return "bg-violet-100 text-violet-800";
    case "CONSIGNMENT_DISTRIBUTION":
    default:
      return "bg-sky-100 text-sky-800";
  }
}

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

export default function STOListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState("OUTBOUND");
  const [status, setStatus] = useState("");
  const [stoType, setStoType] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);

  const companies = runtimeContext?.availableCompanies ?? [];
  const selectedCompanyId = runtimeContext?.selectedCompanyId || "";
  const companyMap = useMemo(
    () => new Map(companies.map((entry) => [entry.id, entry])),
    [companies]
  );

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await listSTOs({
          company_id: selectedCompanyId || undefined,
          status: status || undefined,
          sto_type: stoType || undefined,
          limit: 200,
        });
        if (!active) {
          return;
        }
        setRows(Array.isArray(response?.items) ? response.items : []);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setRows([]);
        setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_STO_LIST_FAILED");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [refreshToken, selectedCompanyId, status, stoType]);

  useEffect(() => {
    setPage(1);
  }, [search, status, stoType, viewMode]);

  const filteredRows = useMemo(() => {
    const companyScopedRows = rows.filter((row) =>
      viewMode === "OUTBOUND"
        ? String(row.sending_company_id || "") === selectedCompanyId
        : String(row.receiving_company_id || "") === selectedCompanyId
    );
    const needle = normalizeSearch(search);
    if (!needle) {
      return companyScopedRows;
    }
    return companyScopedRows.filter((row) => {
      const sendingCompany = companyMap.get(row.sending_company_id);
      const receivingCompany = companyMap.get(row.receiving_company_id);
      const haystack = [
        row.sto_number,
        row.sto_type,
        row.status,
        sendingCompany?.company_name,
        receivingCompany?.company_name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [companyMap, rows, search, selectedCompanyId, viewMode]);

  const total = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((safePage - 1) * LIMIT, safePage * LIMIT);
  const startIndex = total === 0 ? 0 : (safePage - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(safePage * LIMIT, total);

  function openCreate() {
    openScreen(OPERATION_SCREENS.PROC_STO_CREATE.screen_code);
    navigate("/dashboard/procurement/stos/create");
  }

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_STO_DETAIL.screen_code);
    navigate(`/dashboard/procurement/stos/${encodeURIComponent(row.id)}`);
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Stock Transfers"
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => setRefreshToken((value) => value + 1),
        },
        {
          key: "create",
          label: "Create STO",
          tone: "primary",
          onClick: openCreate,
        },
      ]}
      notices={error ? [{ key: "sto-list-error", tone: "error", message: error }] : []}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Outbound and inbound company transfers",
        children: (
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              {[
                { key: "OUTBOUND", label: "MY OUTBOUND" },
                { key: "INBOUND", label: "MY INBOUND" },
              ].map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setViewMode(entry.key)}
                  className={`border px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] ${
                    viewMode === entry.key
                      ? "border-sky-700 bg-sky-100 text-sky-950"
                      : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_180px_220px]">
              <QuickFilterInput
                label="Search"
                value={search}
                onChange={setSearch}
                primaryFocus
                placeholder="Search STO number or company"
              />
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Status
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">ALL</option>
                  {["CREATED", "DISPATCHED", "RECEIVED", "CLOSED", "CANCELLED"].map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                STO Type
                <select
                  value={stoType}
                  onChange={(event) => setStoType(event.target.value)}
                  className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">ALL</option>
                  {["CONSIGNMENT_DISTRIBUTION", "INTER_PLANT"].map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "STO Register",
        title: loading ? "Loading stock transfers" : `${total} stock transfer row${total === 1 ? "" : "s"}`,
        children: (
          <div className="grid gap-3">
            <ErpPaginationStrip
              page={safePage}
              setPage={setPage}
              totalPages={totalPages}
              startIndex={startIndex}
              endIndex={endIndex}
              totalItems={total}
            />
            <ErpDenseGrid
              columns={[
                { key: "sto_number", label: "STO Number", width: "140px" },
                {
                  key: "sto_type",
                  label: "Type",
                  width: "180px",
                  render: (row) => (
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${typeTone(row.sto_type)}`}>
                      {row.sto_type}
                    </span>
                  ),
                },
                {
                  key: "sending_company",
                  label: "Sending Company",
                  render: (row) =>
                    companyMap.get(row.sending_company_id)?.company_name ||
                    row.sending_company_id ||
                    "—",
                },
                {
                  key: "receiving_company",
                  label: "Receiving Company",
                  render: (row) =>
                    companyMap.get(row.receiving_company_id)?.company_name ||
                    row.receiving_company_id ||
                    "—",
                },
                {
                  key: "status",
                  label: "Status",
                  width: "130px",
                  render: (row) => (
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusTone(row.status)}`}>
                      {row.status}
                    </span>
                  ),
                },
                { key: "dispatch_qty", label: "Total Qty", width: "100px", render: (row) => row.total_qty || row.dispatch_qty || "—" },
                { key: "created_at", label: "Created", width: "140px" },
              ]}
              rows={pageRows}
              rowKey={(row) => row.id}
              onRowActivate={openDetail}
              getRowProps={(row) => ({
                onDoubleClick: () => openDetail(row),
                className: "cursor-pointer hover:bg-sky-50",
              })}
              emptyMessage={loading ? "Loading stock transfers..." : "No stock transfer matched the current filter."}
            />
          </div>
        ),
      }}
    />
  );
}
