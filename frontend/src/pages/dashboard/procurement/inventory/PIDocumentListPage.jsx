import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { resolveDefaultTransactionCompanyId } from "../../../../components/inputs/transactionCompanyRuntime.js";
import ErpScreenScaffold, {
  ErpFieldPreview,
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listPIDocuments } from "../procurementApi.js";
import { getPIStatusMeta } from "./piStatusPresentation.js";

const STATUS_OPTIONS = ["", "OPEN", "COUNTED", "PENDING_APPROVAL", "POSTED", "CANCELLED"];

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB");
}

export default function PIDocumentListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const [companyId, setCompanyId] = useState("");
  const effectiveCompanyId = companyId || resolveDefaultTransactionCompanyId(runtimeContext);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ status: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void loadDocuments(filters),
    },
  });

  async function loadDocuments(nextFilters = filters) {
    setLoading(true);
    setError("");
    try {
      const result = await listPIDocuments({
        company_id: effectiveCompanyId || undefined,
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
  }, [effectiveCompanyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const metrics = useMemo(
    () => [
      { label: "Documents", value: rows.length, caption: "Physical inventory documents in the current filter.", tone: "sky" },
      { label: "Open", value: rows.filter((row) => String(row.status).toUpperCase() === "OPEN").length, caption: "Still collecting counts.", tone: "amber" },
      { label: "Pending Approval", value: rows.filter((row) => String(row.status).toUpperCase() === "PENDING_APPROVAL").length, caption: "Submitted, awaiting Post.", tone: "sky" },
      { label: "Posted", value: rows.filter((row) => String(row.status).toUpperCase() === "POSTED").length, caption: "Posted to stock ledger.", tone: "emerald" },
    ],
    [rows],
  );

  async function applyFilters(patch) {
    const next = { ...filters, ...patch };
    setFilters(next);
    await loadDocuments(next);
  }

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_PI_DETAIL.screen_code, { context: { id: row.id } });
    navigate(`/dashboard/procurement/physical-inventory/${encodeURIComponent(row.id)}`);
  }

  function openCreate() {
    // §119.4 — Create is now its own dedicated companion page (side-panel form
    // removed here — FG/SFG+batch/multi-location selection is too complex for that).
    openScreen(OPERATION_SCREENS.PROC_PI_CREATE.screen_code);
    navigate("/dashboard/procurement/physical-inventory/create");
  }

  function openDifferenceReport() {
    // §119.15 — MI20 (IN07), standalone, own page.
    openScreen(OPERATION_SCREENS.PROC_PI_DIFFERENCES.screen_code);
    navigate("/dashboard/procurement/physical-inventory-differences");
  }

  return (
    <ErpScreenScaffold
      eyebrow="Procurement Inventory"
      title="Physical Inventory Documents"
      notices={[
        ...(error ? [{ key: "pi-list-error", tone: "error", message: error }] : []),
        {
          key: "pi-list-guide",
          tone: "info",
          message: "IN01 is the MI01/MI02/MI03 control point: create new PIDs here, open a document for review/change, then hand off to MI04 and MI05 for counting.",
        },
      ]}
      actions={[
        {
          key: "differences",
          label: "Open MI20 / IN07",
          tone: "neutral",
          onClick: openDifferenceReport,
        },
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => void loadDocuments(filters),
        },
        {
          // ACL gates who actually sees this succeed server-side (PROC_PI_LIST:EDIT,
          // Auditor-only per §119.5) — the button itself is not the security boundary.
          key: "create",
          label: "New PID",
          tone: "primary",
          onClick: openCreate,
        },
      ]}
    >
      <div className="grid gap-4">
        <div className="grid gap-4 xl:grid-cols-4">
          <ErpFieldPreview label="Step" value="IN01 / MI01-MI03" tone="sky" />
          <ErpFieldPreview label="Company Scope" value={effectiveCompanyId ? "Selected" : "Required"} />
          <ErpFieldPreview label="Register Rows" value={`${rows.length}`} caption={`Open ${metrics[1].value} · Pending ${metrics[2].value}`} />
          <ErpFieldPreview label="Companion Flow" value="MI04 / MI05 / MI07 / MI20" />
        </div>

        <ErpSectionCard
          eyebrow="Transaction Map"
          title="Physical Inventory Transaction Shell"
          aside={(
            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              MI01 Create · MI02 Change · MI03 Display · MI04 Count · MI05 Change Count · MI07 Post · MI20 Differences
            </div>
          )}
        >
          <div className="grid gap-3 xl:grid-cols-4">
            <div className="xl:col-span-4">
              <TransactionCompanySelector
                runtimeContext={runtimeContext}
                value={companyId}
                onChange={setCompanyId}
                label="Company"
              />
            </div>
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded border border-slate-200 bg-white px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{metric.label}</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{metric.value}</div>
                <div className="mt-1 text-sm text-slate-500">{metric.caption}</div>
              </div>
            ))}
          </div>
        </ErpSectionCard>

        <ErpSectionCard
          eyebrow="PI Register"
          title={loading ? "Loading Physical Inventory Documents" : `${rows.length} Document Row${rows.length === 1 ? "" : "s"}`}
          aside={(
            <div className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              Double-click a row to open MI02/MI03 review. Use MI20 / IN07 for cross-document difference analysis.
            </div>
          )}
        >
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
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
                { key: "company_name", label: "Company", width: "160px", render: (row) => row.company_name ?? row.company_code ?? "—" },
                { key: "mode", label: "Mode", width: "120px" },
                { key: "count_date", label: "Count Date", width: "110px", render: (row) => formatDate(row.count_date) },
                { key: "posting_date", label: "Posting Date", width: "110px", render: (row) => formatDate(row.posting_date) },
                { key: "item_count", label: "Items", width: "70px" },
                { key: "counted_count", label: "Counted", width: "80px", render: (row) => `${row.counted_count ?? 0}/${row.item_count ?? 0}` },
                {
                  key: "is_opening_stock_source",
                  label: "Opening Src",
                  width: "90px",
                  render: (row) => (row.is_opening_stock_source ? "Yes" : "—"),
                },
                {
                  key: "status",
                  label: "Status",
                  width: "130px",
                  render: (row) => {
                    const statusMeta = getPIStatusMeta(row.status);
                    return (
                      <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusMeta.badgeClassName}`}>
                        {statusMeta.label}
                      </span>
                    );
                  },
                },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
              onRowActivate={openDetail}
              getRowProps={(row) => ({
                onDoubleClick: () => openDetail(row),
                className: "cursor-pointer hover:bg-sky-50",
              })}
              emptyMessage={loading ? "Loading physical inventory documents..." : effectiveCompanyId ? "No physical inventory documents found." : "No company resolved for this session."}
              maxHeight="560px"
              />
            </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
