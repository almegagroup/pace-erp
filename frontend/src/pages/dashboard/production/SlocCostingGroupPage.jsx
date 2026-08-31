import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpSummaryChips from "../../../components/data/ErpSummaryChips.jsx";
import ErpMasterListTemplate from "../../../components/templates/ErpMasterListTemplate.jsx";
import { pushToast } from "../../../store/uiToast.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";
import { useMenu } from "../../../context/useMenu.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { listStorageLocations } from "../om/omApi.js";
import {
  assignAc06CostingGroup,
  closeAc06Month,
  createAc06CostingGroup,
  createAc06SlocGroup,
  deleteAc06CostingGroup,
  deleteAc06SlocGroup,
  getAc06History,
  getAc06Report,
  getAc06Workspace,
  saveAc06Rates,
  setAc06MaterialInclusion,
  unassignAc06CostingGroup,
  updateAc06CostingGroup,
  updateAc06SlocGroup,
  verifyAc06Rates,
} from "./prodApi.js";

const EMPTY = [];
const AC06_FIRST_MONTH = "2026-05";
const AC06_BASE_ROUTE = "/dashboard/production/sloc-costing-group";
const unwrap = (payload) => payload?.data ?? payload ?? {};

// §35.18 (PO11, carried into AC06 by §114.23): Pace Code is never shown on
// this page. Material Name and External Code are two separate columns, not
// one combined cell.
function materialIdentityColumns() {
  return [
    {
      key: "material_name",
      label: "Material Name",
      width: "220px",
      render: (row) => row.material_name || "-",
    },
    {
      key: "material_external_code",
      label: "External Code",
      width: "120px",
      render: (row) => row.material_external_code || "-",
    },
  ];
}

// Shared by SLOC Group Setup's Manage Materials Included/Excluded lists and
// Costing Group Setup's Available Item Pool/Current Members/Standalone
// Materials -- same Name/External Code/Type/Status(+optional Action) shape
// everywhere, mirroring PO11's own buildMaterialListColumns() (§35.18/§114.23
// "follows PO11's ... workspace pattern").
// `selection` (Material Company Mapping's checkbox pattern, SAMaterialMaster.jsx's
// "Company Mapping" tab -- select one/many/all, then a single bulk action button,
// instead of a per-row action button) prepends a checkbox column: header checkbox
// toggles all currently-listed rows, row checkbox toggles that one row.
function buildAc06MaterialListColumns({ statusLabel, actionLabel, actionClassName, onAction, selection } = {}) {
  const columns = [
    ...materialIdentityColumns(),
    { key: "material_type", label: "Type", width: "70px", render: (row) => row.material_type || "-" },
    { key: "status", label: "Status", width: "110px", render: () => statusLabel },
  ];
  if (onAction) {
    columns.push({
      key: "action",
      label: "",
      width: "90px",
      render: (row) => (
        <button type="button" onClick={() => onAction(row)} className={actionClassName}>
          {actionLabel}
        </button>
      ),
    });
  }
  if (selection) {
    columns.unshift({
      key: "__select",
      label: (
        <input
          type="checkbox"
          checked={selection.allChecked}
          onChange={selection.onToggleAll}
          aria-label="Select all"
        />
      ),
      width: "36px",
      render: (row) => (
        <input
          type="checkbox"
          checked={selection.selected.has(row.id)}
          onChange={() => selection.onToggle(row.id)}
          aria-label={`Select ${row.material_name || row.id}`}
        />
      ),
    });
  }
  return columns;
}

// Group-lead rows get a visibly distinct background -- the AC06 analogue of
// PO11's "Group Total row gets a distinct background" rule (§35.18). AC06
// has no group-total/sum row (§114.23: rates propagate, they never sum), so
// the row that actually carries the editable rate for its Costing Group is
// the one that needs to stand out instead.
function rateRowProps(row) {
  if (row.is_group_lead) return { className: "!bg-sky-50" };
  return {};
}

// Report scope's month picker -- was a raw comma-separated text input
// ("2026-05,2026-06"), which is exactly the kind of thing the Month field
// right next to it (a native type="month" picker) exists to avoid. Since
// the report accepts one or many months (§114.23), this stays a native
// month picker used purely as an "add" control, plus removable chips for
// whatever's already picked -- no free-text typing required.
function ReportMonthsPicker({ months, onAdd, onRemove }) {
  return (
    <label className="grid gap-1 text-sm text-slate-700">
      <span className="font-medium text-slate-800">Months</span>
      <div className="flex min-h-10 flex-wrap items-center gap-2 border border-slate-300 bg-white px-2 py-1">
        <input
          type="month"
          min={AC06_FIRST_MONTH}
          value=""
          onChange={(event) => onAdd(event.target.value)}
          className="h-8 border border-slate-300 px-2 text-sm outline-none focus:border-sky-500"
        />
        {months.map((monthValue) => (
          <span
            key={monthValue}
            className="flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800"
          >
            {monthValue}
            <button
              type="button"
              onClick={() => onRemove(monthValue)}
              aria-label={`Remove ${monthValue}`}
              className="text-sky-900"
            >
              &times;
            </button>
          </span>
        ))}
      </div>
    </label>
  );
}

export default function SlocCostingGroupPage() {
  const { runtimeContext } = useMenu();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const primaryFocusRef = useRef(null);
  // Report display is driven by local state, not location.pathname (same
  // reasoning as PO11/ProcurementPlanningPage.jsx). Seed from the URL once
  // (so a direct deep link to /report, e.g. via Shift+F8 in a new window,
  // still opens straight into the report), then let openReport()/
  // backToWorkspace() flip this in-place. Do NOT add an effect that
  // re-derives showFullReport from isReportRoute on every render -- this
  // app's screen-stack sync can correct the URL back to the base screen's
  // registered route a moment after navigate() (the /report path is a
  // route-only companion, not a registered screen), and an effect watching
  // isReportRoute would then flip showFullReport back to false right after
  // the user clicks Execute Full Report, bouncing them back to the
  // workspace. PO11 hit this exact bug first; state-only display is the fix.
  const isReportRoute = location.pathname.endsWith("/report");
  const [showFullReport, setShowFullReport] = useState(isReportRoute);
  const [companyId, setCompanyId] = useState("");
  const [month, setMonth] = useState(AC06_FIRST_MONTH);
  const [slocGroupId, setSlocGroupId] = useState("");
  const [tab, setTab] = useState("dashboard");
  const [rateDraft, setRateDraft] = useState({});
  const [selectedForVerify, setSelectedForVerify] = useState([]);
  const [slocName, setSlocName] = useState("");
  const [slocLocations, setSlocLocations] = useState([]);
  const [editingSlocId, setEditingSlocId] = useState("");
  const [costingName, setCostingName] = useState("");
  const [editingCostingId, setEditingCostingId] = useState("");
  const [costingParentId, setCostingParentId] = useState("");
  const [costingManagerSlocGroupId, setCostingManagerSlocGroupId] = useState("");
  const [targetCostingGroupId, setTargetCostingGroupId] = useState("");
  const [itemPoolMaterialTypeFilter, setItemPoolMaterialTypeFilter] = useState("ALL");
  const [costingSearch, setCostingSearch] = useState("");
  const [managedSlocGroupId, setManagedSlocGroupId] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [selectedIncludedIds, setSelectedIncludedIds] = useState(() => new Set());
  const [selectedExcludedIds, setSelectedExcludedIds] = useState(() => new Set());
  const [rateSearch, setRateSearch] = useState("");
  const [rateCostingGroupId, setRateCostingGroupId] = useState("");
  const [onlyStandalone, setOnlyStandalone] = useState(false);
  const [reportMonths, setReportMonths] = useState(AC06_FIRST_MONTH);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!companyId && runtimeContext?.selectedCompanyId)
      setCompanyId(String(runtimeContext.selectedCompanyId));
  }, [companyId, runtimeContext]);

  // Deep-link support (Shift+F8 opens the current URL in a new window; a
  // bookmarked report link works the same way) -- seed state from the URL
  // once when entering report mode. Runs after the default-company effect
  // above so an explicit company_id in the URL wins over the runtime default.
  useEffect(() => {
    if (!showFullReport) return;
    const paramCompany = searchParams.get("company_id");
    const paramSloc = searchParams.get("sloc_group_id");
    const paramMonths = searchParams.get("months");
    if (paramCompany) setCompanyId(paramCompany);
    if (paramSloc) setSlocGroupId(paramSloc);
    if (paramMonths) setReportMonths(paramMonths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFullReport]);

  const reportMonthList = reportMonths
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  function addReportMonth(monthValue) {
    if (!monthValue || reportMonthList.includes(monthValue)) return;
    setReportMonths([...reportMonthList, monthValue].sort().join(","));
  }
  function removeReportMonth(monthValue) {
    setReportMonths(reportMonthList.filter((value) => value !== monthValue).join(","));
  }

  const workspaceQuery = useQuery({
    queryKey: ["ac06-v3", "workspace", companyId, month, slocGroupId],
    queryFn: () =>
      getAc06Workspace({
        company_id: companyId,
        rate_month: month,
        sloc_group_id: slocGroupId,
      }),
    enabled: Boolean(companyId && month),
    select: unwrap,
  });
  const locationsQuery = useQuery({
    queryKey: ["ac06-v3", "locations", companyId],
    queryFn: () =>
      listStorageLocations({ company_id: companyId, is_active: true }),
    enabled: Boolean(companyId),
    select: (payload) =>
      Array.isArray(payload) ? payload : (payload?.data ?? EMPTY),
  });
  const reportQuery = useQuery({
    queryKey: [
      "ac06-v3",
      "report",
      companyId,
      slocGroupId,
      reportMonthList.join(","),
    ],
    queryFn: () =>
      getAc06Report({
        company_id: companyId,
        sloc_group_id: slocGroupId,
        months: reportMonthList.join(","),
      }),
    enabled:
      showFullReport && Boolean(companyId && slocGroupId && reportMonthList.length),
    select: unwrap,
  });
  const historyQuery = useQuery({
    queryKey: ["ac06-v3", "history", companyId, month],
    queryFn: () => getAc06History({ company_id: companyId, rate_month: month }),
    enabled: tab === "history" && Boolean(companyId && month),
    select: unwrap,
  });

  const workspace = workspaceQuery.data ?? {};
  const rows = workspace.rows ?? EMPTY;
  const slocGroups = workspace.sloc_groups ?? EMPTY;
  const costingGroups = workspace.costing_groups ?? EMPTY;
  const summary = workspace.summary ?? {};
  const permissions = workspace.permissions ?? {};
  const canSetup = Boolean(permissions.can_setup);
  const canRate = Boolean(permissions.can_rate);
  const canVerify = Boolean(permissions.can_verify);
  const canClose = Boolean(permissions.can_close);
  const slocGroupNameById = new Map(
    slocGroups.map((group) => [String(group.id), group.group_name]),
  );
  const selectedSlocRows = rows.filter(
    (row) =>
      !row.is_excluded &&
      (!slocGroupId || row.source_sloc_group_id === slocGroupId),
  );
  const pendingIds = new Set(
    selectedSlocRows
      .filter(
        (row) =>
          row.verification_status === "PENDING" &&
          (row.is_standalone || row.is_group_lead),
      )
      .map((row) => row.id),
  );
  const selectionValid =
    selectedForVerify.length > 0 &&
    selectedForVerify.every((id) => pendingIds.has(id));

  // SLOC Group Setup card list -- same per-group summary line PO11 shows
  // ("X storage locations selected | Y eligible materials (Z grouped, W
  // excluded)"), derived from the workspace rows instead of a plain table.
  const slocGroupInsights = slocGroups.map((group) => {
    const linkedRows = rows.filter((row) => row.source_sloc_group_id === group.id);
    return {
      ...group,
      linkedMaterialCount: linkedRows.length,
      groupedMaterialCount: linkedRows.filter((row) => row.costing_group_id).length,
      excludedMaterialCount: linkedRows.filter((row) => row.is_excluded).length,
    };
  });

  // SLOC Group Setup's "Manage Materials" Included/Excluded split (PO11
  // pattern) -- ignores costing_group_id entirely, exclude/include applies
  // regardless of whether the material is grouped or standalone.
  const slocMaterialRows = rows.filter(
    (row) =>
      row.source_sloc_group_id === managedSlocGroupId &&
      `${row.material_name || ""} ${row.material_external_code || ""}`
        .toLowerCase()
        .includes(materialSearch.toLowerCase()),
  );
  const includedSlocMaterialRows = slocMaterialRows.filter((row) => !row.is_excluded);
  const excludedSlocMaterialRows = slocMaterialRows.filter((row) => row.is_excluded);

  // Costing Group Setup work area -- mirrors PO11's Item Group Setup tab:
  // one SLOC-scoped row set, search-filtered, then split into the Available
  // Item Pool (no costing group yet) and the selected Costing Group's
  // Current Members.
  const selectedSlocGroupIdForItems = costingManagerSlocGroupId || slocGroups[0]?.id || "";
  const itemTabRows = rows
    .filter(
      (row) =>
        !row.is_excluded &&
        row.source_sloc_group_id === selectedSlocGroupIdForItems &&
        `${row.material_name || ""} ${row.material_external_code || ""}`
          .toLowerCase()
          .includes(costingSearch.toLowerCase()),
    )
    .sort((left, right) => String(left.material_name || "").localeCompare(String(right.material_name || "")));
  const selectedCostingGroupMembers = itemTabRows.filter(
    (row) => row.costing_group_id === targetCostingGroupId,
  );
  const availableCostingItemPool = itemTabRows.filter((row) => !row.costing_group_id);
  const filteredAvailableCostingItemPool = availableCostingItemPool.filter(
    (row) => itemPoolMaterialTypeFilter === "ALL" || row.material_type === itemPoolMaterialTypeFilter,
  );
  const scopedCostingGroups = costingGroups.filter(
    (group) => group.sloc_group_id === selectedSlocGroupIdForItems,
  );

  const visibleRateRows = selectedSlocRows.filter(
    (row) =>
      (!rateCostingGroupId || row.costing_group_id === rateCostingGroupId) &&
      (!onlyStandalone || row.is_standalone) &&
      `${row.material_name || ""} ${row.material_external_code || ""} ${row.costing_group_name || ""}`
        .toLowerCase()
        .includes(rateSearch.toLowerCase()),
  );

  useEffect(() => {
    setRateDraft((current) => {
      const next = { ...current };
      rows.forEach((row) => {
        if (!(row.id in next)) next[row.id] = String(row.rate ?? "0");
      });
      return next;
    });
  }, [rows]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["ac06-v3"] });
  }
  function notice(message, tone = "success") {
    pushToast({ message, tone });
  }
  function toggle(list, value, setter) {
    setter(
      list.includes(value)
        ? list.filter((entry) => entry !== value)
        : [...list, value],
    );
  }

  function toggleSetMember(setter, id) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSetAll(setter, rows) {
    setter((prev) =>
      rows.length > 0 && prev.size === rows.length ? new Set() : new Set(rows.map((row) => row.id)),
    );
  }

  async function withBusy(action) {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (error) {
      notice(error?.message || "Request failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  function setGroupRate(row, value) {
    // Only accept a value that's still a valid (possibly partial, e.g. "2.")
    // non-negative decimal as the user types -- letters, commas, a second
    // decimal point, or a minus sign never enter rateDraft at all. Before this,
    // a single bad character typed into any one row (among possibly 100+
    // visible ones) silently blocked the entire "Save Rates" batch with a
    // generic error that didn't say which row was wrong (found live 2026-08-27).
    if (!/^\d*\.?\d*$/.test(value)) return;
    setRateDraft((current) => {
      const next = { ...current, [row.id]: value };
      if (row.costing_group_id)
        rows
          .filter(
            (candidate) => candidate.costing_group_id === row.costing_group_id,
          )
          .forEach((candidate) => {
            next[candidate.id] = value;
          });
      return next;
    });
  }

  function handleRatePaste(event, row) {
    const rawValue = event.clipboardData?.getData("text") ?? "";
    // Spreadsheet/accounting exports commonly include commas, the rupee sign,
    // or surrounding whitespace. Normalize one copied rate before applying the
    // same validation used for typed input.
    const value = rawValue.trim().replace(/[\s,₹]/g, "");
    if (!/^\d*\.?\d*$/.test(value) || value === "") {
      event.preventDefault();
      notice("Paste one non-negative numeric rate, for example 3.50.", "error");
      return;
    }
    event.preventDefault();
    setGroupRate(row, value);
  }

  // In-place full-report toggle, same mechanism as PO11 (feasibility §35.18
  // / ProcurementPlanningPage.jsx): flips local state and pushes a dedicated
  // /report URL via navigate({replace:true}) -- never window.open. This is
  // what lets Shift+F8 (the app-wide "open in new window" hotkey) duplicate
  // the exact live scope into a second window, and keeps Company/SLOC Group
  // resolved to real names instead of raw ids in the URL only.
  function openReport() {
    if (!companyId || !slocGroupId || !reportMonthList.length) {
      notice("Select Company, SLOC Group, and at least one month first.", "error");
      return;
    }
    setShowFullReport(true);
    const params = new URLSearchParams();
    params.set("company_id", companyId);
    params.set("sloc_group_id", slocGroupId);
    params.set("months", reportMonths);
    navigate(`${AC06_BASE_ROUTE}/report?${params.toString()}`, { replace: true });
  }

  function backToWorkspace() {
    setShowFullReport(false);
    const params = new URLSearchParams();
    if (companyId) params.set("company_id", companyId);
    params.set("rate_month", month);
    if (slocGroupId) params.set("sloc_group_id", slocGroupId);
    navigate(`${AC06_BASE_ROUTE}?${params.toString()}`, { replace: true });
  }

  const tabs = [
    ["dashboard", "Costing Dashboard"],
    ["rate", "Monthly Costing Rate Input"],
    ["sloc", "SLOC Group Setup"],
    ["group", "Costing Group Setup"],
    ["history", "History / Archive"],
  ].filter(([id]) => !["sloc", "group"].includes(id) || canSetup);

  useEffect(() => {
    if (!tabs.some(([id]) => id === tab)) setTab("dashboard");
  }, [tab, tabs]);

  useErpScreenHotkeys({
    refresh: {
      disabled: !companyId,
      perform: () => {
        void refresh();
      },
    },
    focusPrimary: {
      disabled: false,
      perform: () => primaryFocusRef.current?.focus?.(),
    },
  });

  if (showFullReport) {
    const reportRows = reportQuery.data?.rows ?? EMPTY;
    return (
      <ErpMasterListTemplate
        eyebrow="AC06"
        title="Monthly Costing Rate Report"
        actions={[
          {
            key: "back-to-workspace",
            label: "Back to Workspace",
            tone: "neutral",
            onClick: backToWorkspace,
          },
          {
            key: "refresh",
            label: "Refresh",
            tone: "neutral",
            onClick: () => {
              void refresh();
            },
          },
        ]}
        filterSection={null}
        listSection={{
          eyebrow: "",
          title: "",
          children: (
            <div className="grid gap-4">
              <div className="grid gap-3 rounded border border-slate-200 bg-white p-3 lg:grid-cols-[minmax(0,300px)_minmax(0,260px)_minmax(0,1fr)]">
                <TransactionCompanySelector
                  runtimeContext={runtimeContext}
                  value={companyId}
                  onChange={setCompanyId}
                  label="Company"
                />
                <label className="grid gap-1 text-sm text-slate-700">
                  <span className="font-medium text-slate-800">SLOC Group</span>
                  <select
                    value={slocGroupId}
                    onChange={(event) => setSlocGroupId(event.target.value)}
                    className="h-10 border border-slate-300 bg-white px-3 outline-none focus:border-sky-500"
                  >
                    <option value="">Select SLOC Group</option>
                    {slocGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.group_name}
                      </option>
                    ))}
                  </select>
                </label>
                <ReportMonthsPicker
                  months={reportMonthList}
                  onAdd={addReportMonth}
                  onRemove={removeReportMonth}
                />
              </div>
              <ErpDenseGrid
                columns={[
                  { key: "rate_month", label: "Month", width: "100px" },
                  {
                    key: "costing_group_name_snapshot",
                    label: "Group",
                    width: "140px",
                    render: (row) => row.costing_group_name_snapshot || "Standalone",
                  },
                  ...materialIdentityColumns(),
                  { key: "rate", label: "Rate", width: "110px" },
                  { key: "verification_status", label: "Verification", width: "120px" },
                  { key: "month_status", label: "Month Status", width: "110px" },
                ]}
                rows={reportRows}
                rowKey={(row) => row.id}
                emptyMessage="No rate rows match this report scope."
              />
            </div>
          ),
        }}
      />
    );
  }

  return (
    <ErpMasterListTemplate
      eyebrow="AC06"
      title="Monthly Costing Rate Workspace"
      actions={[
        {
          key: "refresh",
          label: "Refresh",
          tone: "neutral",
          onClick: () => {
            void refresh();
          },
        },
        ...(tab === "dashboard"
          ? [
              {
                key: "execute-report",
                label: "Execute Full Report",
                tone: "primary",
                disabled: !companyId || !slocGroupId || !reportMonths,
                onClick: openReport,
              },
            ]
          : []),
        ...(canClose
          ? [
              {
                key: "close-month",
                label: "Close Month",
                tone: "danger",
                disabled:
                  busy || workspace.month?.status === "CLOSED" || !companyId,
                onClick: async () => {
                  const confirmed = await openActionConfirm({
                    eyebrow: "AC06 Month Close",
                    title: `Close ${month}?`,
                    message: "This creates an immutable archive. Rates for this month can no longer be changed.",
                    confirmLabel: "Close Month",
                  });
                  if (!confirmed) return;
                  void withBusy(() =>
                    closeAc06Month({
                      company_id: companyId,
                      rate_month: month,
                    }),
                  );
                },
              },
            ]
          : []),
      ]}
      filterSection={{
        eyebrow: "Controls",
        title: "Company / Month / Workspace",
        children: (
          <div className="grid gap-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,330px)_180px_minmax(0,280px)]">
              <TransactionCompanySelector
                runtimeContext={runtimeContext}
                value={companyId}
                onChange={setCompanyId}
                label="Company"
                selectRef={primaryFocusRef}
              />
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                Month
                <input
                  type="month"
                  min={AC06_FIRST_MONTH}
                  value={month}
                  onChange={(event) => setMonth(event.target.value)}
                  className="h-10 border border-slate-300 px-3"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                SLOC Group
                <select
                  value={slocGroupId}
                  onChange={(event) => setSlocGroupId(event.target.value)}
                  className="h-10 border border-slate-300 bg-white px-3"
                >
                  <option value="">All SLOC Groups</option>
                  {slocGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.group_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ErpSummaryChips
              items={[
                {
                  label: "Month",
                  value: workspace.month?.status || "OPEN",
                  className:
                    workspace.month?.status === "CLOSED"
                      ? "border-slate-300 bg-white text-slate-700"
                      : "border-emerald-300 bg-emerald-50 text-emerald-800",
                },
                {
                  label: "Access",
                  value:
                    canSetup || canRate || canVerify || canClose
                      ? "Maintenance"
                      : "View only",
                },
                { label: "Rows", value: summary.rows || 0 },
                {
                  label: "Verified",
                  value: summary.verified || 0,
                  className: "border-emerald-300 bg-emerald-50 text-emerald-800",
                },
                {
                  label: "Pending",
                  value: summary.pending || 0,
                  className: "border-amber-300 bg-amber-50 text-amber-800",
                },
                { label: "Standalone", value: summary.standalone || 0 },
                { label: "Excluded", value: summary.excluded || 0 },
              ]}
            />
            <div className="flex flex-wrap gap-1 border-b border-slate-200">
              {tabs.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`border px-3 py-2 text-sm font-semibold ${tab === id ? "border-sky-700 bg-sky-100 text-sky-950" : "border-slate-200 bg-white text-slate-600"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "AC06",
        title: tabs.find(([id]) => id === tab)?.[1] || "Workspace",
        children: (
          <div className="grid gap-4">
            {tab === "dashboard" ? (
              <div className="grid gap-4">
                <div className="rounded border border-slate-200 bg-white p-4">
                  <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
                    <label className="grid gap-1 text-sm text-slate-700">
                      <span className="font-medium text-slate-800">SLOC Group</span>
                      <select
                        value={slocGroupId}
                        onChange={(event) => setSlocGroupId(event.target.value)}
                        className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
                      >
                        <option value="">Select SLOC Group</option>
                        {slocGroups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.group_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <ReportMonthsPicker
                      months={reportMonthList}
                      onAdd={addReportMonth}
                      onRemove={removeReportMonth}
                    />
                    <div className="flex items-end">
                      <button
                        type="button"
                        disabled={!companyId || !slocGroupId || !reportMonths}
                        onClick={openReport}
                        className="h-10 border border-sky-700 bg-sky-100 px-4 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Execute Full Report
                      </button>
                    </div>
                  </div>
                </div>
                <div className="rounded border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                  Choose Company, SLOC Group, and one or more months, then
                  execute the full-page report. The report opens on its own
                  route so the current report view can also be opened in a new
                  ERP window with{" "}
                  <span className="font-semibold text-slate-700">Shift+F8</span>.
                </div>
              </div>
            ) : null}
            {tab === "rate" ? (
              <div className="grid gap-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="text-xs text-slate-600">
                    Changing a rate immediately makes its scope pending again.
                    Only pending standalone rows and Costing Group lead rows
                    can be verified.
                  </p>
                  <div className="flex gap-2">
                    {canVerify ? (
                      <button
                        type="button"
                        disabled={busy || !selectionValid}
                        onClick={() =>
                          void withBusy(() =>
                            verifyAc06Rates({
                              company_id: companyId,
                              rate_month: month,
                              line_ids: selectedForVerify,
                            }),
                          )
                        }
                        className="border border-emerald-700 bg-emerald-50 px-3 py-1 text-xs font-semibold disabled:opacity-40"
                      >
                        Verify Selected
                      </button>
                    ) : null}
                    {canRate ? (
                      <button
                        type="button"
                        disabled={
                          busy ||
                          !visibleRateRows.length ||
                          workspace.month?.status === "CLOSED"
                        }
                        onClick={() =>
                          void withBusy(() =>
                            saveAc06Rates({
                              company_id: companyId,
                              rate_month: month,
                              updates: visibleRateRows
                                .filter(
                                  (row) => row.is_standalone || row.is_group_lead,
                                )
                                .map((row) => ({
                                  line_id: row.id,
                                  rate: rateDraft[row.id] ?? row.rate,
                                })),
                            }),
                          )
                        }
                        className="border border-sky-700 bg-sky-100 px-3 py-1 text-xs font-semibold"
                      >
                        Save Rates
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_240px_auto]">
                  <input
                    value={rateSearch}
                    onChange={(event) => setRateSearch(event.target.value)}
                    placeholder="Search material or Costing Group..."
                    className="h-10 border border-slate-300 px-3"
                  />
                  <select
                    value={rateCostingGroupId}
                    onChange={(event) => setRateCostingGroupId(event.target.value)}
                    className="h-10 border border-slate-300 bg-white px-3"
                  >
                    <option value="">All Costing Groups</option>
                    {costingGroups
                      .filter(
                        (group) =>
                          !slocGroupId || group.sloc_group_id === slocGroupId,
                      )
                      .map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.group_name}
                        </option>
                      ))}
                  </select>
                  <label className="flex items-center gap-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={onlyStandalone}
                      onChange={(event) => setOnlyStandalone(event.target.checked)}
                    />
                    Only standalone
                  </label>
                </div>
                <ErpDenseGrid
                  columns={[
                    {
                      key: "verify",
                      label: "Verify",
                      width: "70px",
                      render: (row) => (
                        <input
                          type="checkbox"
                          disabled={
                            !canVerify ||
                            !pendingIds.has(row.id) ||
                            workspace.month?.status === "CLOSED"
                          }
                          checked={selectedForVerify.includes(row.id)}
                          onChange={() =>
                            toggle(selectedForVerify, row.id, setSelectedForVerify)
                          }
                        />
                      ),
                    },
                    {
                      key: "costing_group_name",
                      label: "Group",
                      width: "130px",
                      render: (row) => row.costing_group_name || "Standalone",
                    },
                    {
                      key: "source_sloc_group_name",
                      label: "Source SLOC Group",
                      width: "160px",
                      render: (row) =>
                        slocGroupNameById.get(String(row.source_sloc_group_id)) || "-",
                    },
                    ...materialIdentityColumns(),
                    {
                      key: "rate",
                      label: "Rate",
                      width: "150px",
                      render: (row) =>
                        canRate &&
                        workspace.month?.status !== "CLOSED" &&
                        (row.is_standalone || row.is_group_lead) ? (
                          <input
                            value={rateDraft[row.id] ?? row.rate ?? "0"}
                            onChange={(event) =>
                              setGroupRate(row, event.target.value)
                            }
                            onPaste={(event) => handleRatePaste(event, row)}
                            inputMode="decimal"
                            className="h-8 w-32 border border-slate-300 px-2 font-mono"
                          />
                        ) : (
                          <span className="font-mono">
                            {rateDraft[row.id] ?? row.rate ?? "0"}
                          </span>
                        ),
                    },
                    { key: "verification_status", label: "Status", width: "110px" },
                    {
                      key: "lead",
                      label: "Entry",
                      width: "110px",
                      render: (row) =>
                        row.is_standalone
                          ? "Standalone"
                          : row.is_group_lead
                            ? "Group Lead"
                            : "Auto-filled",
                    },
                  ]}
                  rows={visibleRateRows}
                  rowKey={(row) => row.id}
                  getRowProps={rateRowProps}
                  emptyMessage="Create a SLOC Group first, then select it to load eligible items."
                />
              </div>
            ) : null}
            {tab === "sloc" ? (
              <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
                <div className="grid gap-3 border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {editingSlocId ? "Edit SLOC Group" : "New SLOC Group"}
                  </h3>
                  <p className="text-xs leading-5 text-slate-500">
                    Each SLOC group decides which materials enter AC06 costing
                    scope for the selected company.
                  </p>
                  <label className="grid gap-1 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">Group Name</span>
                    <input
                      value={slocName}
                      onChange={(event) => setSlocName(event.target.value)}
                      className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
                    />
                  </label>
                  <label className="grid gap-1 text-sm text-slate-700">
                    <span className="font-medium text-slate-800">
                      Storage Locations
                    </span>
                    <select
                      multiple
                      value={slocLocations}
                      onChange={(event) =>
                        setSlocLocations(
                          Array.from(event.target.selectedOptions).map(
                            (option) => option.value,
                          ),
                        )
                      }
                      className="min-h-48 border border-slate-300 px-2 py-2 outline-none focus:border-sky-500"
                    >
                      {(locationsQuery.data ?? EMPTY).map((location) => (
                        <option
                          key={location.id}
                          value={location.id}
                        >{`${location.code || location.storage_location_code || "-"} - ${location.name || location.storage_location_name || "Unnamed"}`}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy || !slocName || !slocLocations.length}
                      onClick={() =>
                        void withBusy(async () => {
                          if (editingSlocId)
                            await updateAc06SlocGroup(editingSlocId, {
                              company_id: companyId,
                              group_name: slocName,
                              storage_location_ids: slocLocations,
                            });
                          else
                            await createAc06SlocGroup({
                              company_id: companyId,
                              group_name: slocName,
                              storage_location_ids: slocLocations,
                            });
                          setSlocName("");
                          setSlocLocations([]);
                          setEditingSlocId("");
                        })
                      }
                      className="border border-sky-700 bg-sky-100 px-3 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Save Group
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSlocId("");
                        setSlocName("");
                        setSlocLocations([]);
                      }}
                      className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                    >
                      {editingSlocId ? "Cancel" : "Clear"}
                    </button>
                  </div>
                </div>
                <div className="grid gap-3">
                  {slocGroupInsights.map((group) => (
                    <div key={group.id} className="grid gap-1 border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="grid gap-1">
                          <h3 className="text-sm font-semibold text-slate-900">{group.group_name}</h3>
                          <p className="text-xs text-slate-500">
                            {(group.storage_location_ids || []).length} storage location
                            {(group.storage_location_ids || []).length === 1 ? "" : "s"} selected
                            {" | "}
                            {group.linkedMaterialCount} eligible material{group.linkedMaterialCount === 1 ? "" : "s"}
                            {" ("}
                            {group.groupedMaterialCount} grouped, {group.excludedMaterialCount} excluded
                            {")"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setCostingManagerSlocGroupId(group.id);
                              setTargetCostingGroupId("");
                              setTab("group");
                            }}
                            className="border border-sky-700 bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-950"
                          >
                            Manage
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setManagedSlocGroupId(group.id);
                              setMaterialSearch("");
                              setSelectedIncludedIds(new Set());
                              setSelectedExcludedIds(new Set());
                            }}
                            className="border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800"
                          >
                            Manage Materials
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSlocGroupId(group.id);
                              setTab("rate");
                            }}
                            className="border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800"
                          >
                            Open in Rate Input
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSlocId(group.id);
                              setSlocName(group.group_name);
                              setSlocLocations((group.storage_location_ids || []).map(String));
                            }}
                            className="border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Delete ${group.group_name}?`))
                                void withBusy(() =>
                                  deleteAc06SlocGroup(group.id, { company_id: companyId }),
                                );
                            }}
                            className="border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700"
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      {managedSlocGroupId === group.id ? (
                        <div className="mt-3 grid gap-3 border-t border-slate-200 pt-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="grid gap-1">
                              <h4 className="text-sm font-semibold text-slate-900">
                                Manage Materials -- {group.group_name}
                              </h4>
                              <p className="text-xs text-slate-500">
                                New materials that land in this group&apos;s storage
                                locations auto-include here. Exclude a material to
                                drop it from this month&apos;s rate scope -- it can
                                be included again anytime. Grouped or standalone
                                doesn&apos;t matter here.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setManagedSlocGroupId("");
                                setSelectedIncludedIds(new Set());
                                setSelectedExcludedIds(new Set());
                              }}
                              className="border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
                            >
                              Close
                            </button>
                          </div>
                          <label className="grid gap-1 text-sm text-slate-700">
                            <span className="font-medium text-slate-800">Search Material</span>
                            <input
                              value={materialSearch}
                              onChange={(event) => setMaterialSearch(event.target.value)}
                              placeholder="Type material name or external code..."
                              className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
                            />
                          </label>
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-4">
                              <div className="flex items-center justify-between gap-3">
                                <h4 className="text-sm font-semibold text-slate-900">Included</h4>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-slate-500">
                                    {includedSlocMaterialRows.length} item(s)
                                  </span>
                                  {canSetup && selectedIncludedIds.size > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void withBusy(async () => {
                                          await setAc06MaterialInclusion({
                                            company_id: companyId,
                                            rate_month: month,
                                            line_ids: [...selectedIncludedIds],
                                            included: false,
                                          });
                                          setSelectedIncludedIds(new Set());
                                        })
                                      }
                                      disabled={busy}
                                      className="border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 disabled:opacity-40"
                                    >
                                      Exclude ({selectedIncludedIds.size})
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                              <ErpDenseGrid
                                columns={buildAc06MaterialListColumns({
                                  selection: canSetup
                                    ? {
                                        selected: selectedIncludedIds,
                                        allChecked:
                                          includedSlocMaterialRows.length > 0 &&
                                          selectedIncludedIds.size === includedSlocMaterialRows.length,
                                        onToggle: (id) => toggleSetMember(setSelectedIncludedIds, id),
                                        onToggleAll: () =>
                                          toggleSetAll(setSelectedIncludedIds, includedSlocMaterialRows),
                                      }
                                    : undefined,
                                }).filter((column) => column.key !== "status")}
                                rows={includedSlocMaterialRows}
                                rowKey={(row) => row.id}
                                maxHeight="320px"
                                stickyFirstColumn
                                emptyMessage="No included material matches the current search."
                              />
                            </div>
                            <div className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-4">
                              <div className="flex items-center justify-between gap-3">
                                <h4 className="text-sm font-semibold text-slate-900">Excluded</h4>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-slate-500">
                                    {excludedSlocMaterialRows.length} item(s)
                                  </span>
                                  {canSetup && selectedExcludedIds.size > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void withBusy(async () => {
                                          await setAc06MaterialInclusion({
                                            company_id: companyId,
                                            rate_month: month,
                                            line_ids: [...selectedExcludedIds],
                                            included: true,
                                          });
                                          setSelectedExcludedIds(new Set());
                                        })
                                      }
                                      disabled={busy}
                                      className="border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800 disabled:opacity-40"
                                    >
                                      Include ({selectedExcludedIds.size})
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                              <ErpDenseGrid
                                columns={buildAc06MaterialListColumns({
                                  selection: canSetup
                                    ? {
                                        selected: selectedExcludedIds,
                                        allChecked:
                                          excludedSlocMaterialRows.length > 0 &&
                                          selectedExcludedIds.size === excludedSlocMaterialRows.length,
                                        onToggle: (id) => toggleSetMember(setSelectedExcludedIds, id),
                                        onToggleAll: () =>
                                          toggleSetAll(setSelectedExcludedIds, excludedSlocMaterialRows),
                                      }
                                    : undefined,
                                }).filter((column) => column.key !== "status")}
                                rows={excludedSlocMaterialRows}
                                rowKey={(row) => row.id}
                                maxHeight="320px"
                                stickyFirstColumn
                                emptyMessage="No material is excluded from this SLOC group yet."
                              />
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {slocGroupInsights.length === 0 ? (
                    <div className="rounded border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                      No AC06 SLOC Group exists yet. Create one first, then open
                      Rate Input to review the auto-included item list.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {tab === "group" ? (
              <div className="grid gap-4">
                <div className="grid gap-3 border border-slate-200 bg-white p-4">
                  <div className="grid gap-3 lg:grid-cols-[220px_220px_minmax(0,1fr)_auto]">
                    <label className="grid gap-1 text-sm text-slate-700">
                      <span className="font-medium text-slate-800">Parent SLOC Group</span>
                      <select
                        value={costingParentId}
                        onChange={(event) => setCostingParentId(event.target.value)}
                        className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
                      >
                        <option value="">Select SLOC group</option>
                        {slocGroups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.group_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700">
                      <span className="font-medium text-slate-800">Costing Group Name</span>
                      <input
                        value={costingName}
                        onChange={(event) => setCostingName(event.target.value)}
                        className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
                      />
                    </label>
                    <div className="flex items-end gap-2">
                      <button
                        type="button"
                        disabled={busy || !costingParentId || !costingName}
                        onClick={() =>
                          void withBusy(async () => {
                            if (editingCostingId)
                              await updateAc06CostingGroup(editingCostingId, {
                                company_id: companyId,
                                group_name: costingName,
                              });
                            else {
                              const created = await createAc06CostingGroup({
                                company_id: companyId,
                                sloc_group_id: costingParentId,
                                group_name: costingName,
                              });
                              setCostingManagerSlocGroupId(costingParentId);
                              setTargetCostingGroupId(created?.id || "");
                            }
                            setCostingName("");
                            setEditingCostingId("");
                          })
                        }
                        className="h-10 border border-sky-700 bg-sky-100 px-4 text-sm font-semibold text-sky-950"
                      >
                        {editingCostingId ? "Update Costing Group" : "Create Costing Group"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCostingId("");
                          setCostingName("");
                          setCostingParentId("");
                        }}
                        className="h-10 border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">
                    Create or update the Costing Group directly where the parent
                    SLOC Group scope is selected, then manage member mapping below.
                  </p>
                </div>

                <div className="grid gap-3 border border-slate-200 bg-white p-4">
                  <div className="grid gap-3 lg:grid-cols-[220px_220px_minmax(0,1fr)]">
                    <label className="grid gap-1 text-sm text-slate-700">
                      <span className="font-medium text-slate-800">SLOC Group Scope</span>
                      <select
                        value={selectedSlocGroupIdForItems}
                        onChange={(event) => {
                          setCostingManagerSlocGroupId(event.target.value);
                          setTargetCostingGroupId("");
                        }}
                        className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
                      >
                        <option value="">Select SLOC group</option>
                        {slocGroups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.group_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700">
                      <span className="font-medium text-slate-800">Costing Group To Manage</span>
                      <select
                        value={targetCostingGroupId}
                        onChange={(event) => setTargetCostingGroupId(event.target.value)}
                        className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
                      >
                        <option value="">Select Costing Group</option>
                        {scopedCostingGroups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.group_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700">
                      <span className="font-medium text-slate-800">Search Material</span>
                      <input
                        value={costingSearch}
                        onChange={(event) => setCostingSearch(event.target.value)}
                        placeholder="Type material name or external code..."
                        className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
                      />
                    </label>
                  </div>
                  <ErpSummaryChips
                    items={[
                      { label: "Scope Items", value: itemTabRows.length },
                      { label: "Scope Groups", value: scopedCostingGroups.length },
                      { label: "Current Members", value: selectedCostingGroupMembers.length },
                      { label: "Available Standalone", value: availableCostingItemPool.length },
                    ]}
                  />
                  {targetCostingGroupId ? (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-slate-900">Available Item Pool</h3>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 text-xs text-slate-600">
                              Material Type
                              <select
                                value={itemPoolMaterialTypeFilter}
                                onChange={(event) => setItemPoolMaterialTypeFilter(event.target.value)}
                                className="h-7 border border-slate-300 bg-white px-1.5 text-xs outline-none focus:border-sky-500"
                              >
                                <option value="ALL">All</option>
                                <option value="RM">RM</option>
                                <option value="PM">PM</option>
                              </select>
                            </label>
                            <span className="text-xs text-slate-500">
                              {filteredAvailableCostingItemPool.length} item(s)
                            </span>
                          </div>
                        </div>
                        <ErpDenseGrid
                          columns={buildAc06MaterialListColumns({
                            statusLabel: "Standalone",
                            actionLabel: "Add",
                            actionClassName:
                              "border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800",
                            onAction: (row) =>
                              void withBusy(() =>
                                assignAc06CostingGroup({
                                  company_id: companyId,
                                  rate_month: month,
                                  costing_group_id: targetCostingGroupId,
                                  material_ids: [row.material_id],
                                }),
                              ),
                          })}
                          rows={filteredAvailableCostingItemPool}
                          rowKey={(row) => row.id}
                          maxHeight="320px"
                          stickyFirstColumn
                          emptyMessage={
                            availableCostingItemPool.length === 0
                              ? "No standalone item is available in this SLOC group scope."
                              : "No item matches the current filter."
                          }
                        />
                      </div>
                      <div className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-slate-900">Current Members</h3>
                          <span className="text-xs text-slate-500">{selectedCostingGroupMembers.length} item(s)</span>
                        </div>
                        <ErpDenseGrid
                          columns={buildAc06MaterialListColumns({
                            statusLabel: "Group Member",
                            actionLabel: "Remove",
                            actionClassName:
                              "border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700",
                            onAction: (row) =>
                              void withBusy(() =>
                                unassignAc06CostingGroup({
                                  company_id: companyId,
                                  rate_month: month,
                                  line_ids: [row.id],
                                }),
                              ),
                          })}
                          rows={selectedCostingGroupMembers}
                          rowKey={(row) => row.id}
                          maxHeight="320px"
                          stickyFirstColumn
                          emptyMessage="No member is mapped to this Costing Group yet."
                        />
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-1">
                    <h3 className="text-sm font-semibold text-slate-900">Standalone Materials</h3>
                    <p className="text-xs text-slate-500">
                      These materials are eligible in this SLOC Group but are not assigned to any Costing Group.
                    </p>
                  </div>
                  <ErpDenseGrid
                    columns={buildAc06MaterialListColumns({ statusLabel: "Standalone" })}
                    rows={availableCostingItemPool}
                    rowKey={(row) => row.id}
                    maxHeight="360px"
                    emptyMessage="Every eligible material in this SLOC scope is already assigned to a Costing Group."
                  />
                </div>

                <ErpDenseGrid
                  columns={[
                    { key: "group_name", label: "Costing Group", width: "220px" },
                    {
                      key: "sloc_group_id",
                      label: "Parent SLOC Group",
                      width: "160px",
                      render: (row) => slocGroupNameById.get(String(row.sloc_group_id)) || "-",
                    },
                    {
                      key: "actions",
                      label: "",
                      width: "220px",
                      render: (row) => (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setCostingManagerSlocGroupId(row.sloc_group_id || "");
                              setTargetCostingGroupId(row.id);
                            }}
                            className="border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800"
                          >
                            Manage
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCostingId(row.id);
                              setCostingParentId(row.sloc_group_id || "");
                              setCostingName(row.group_name);
                            }}
                            className="border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete ${row.group_name}? Its open-month items become standalone.`,
                                )
                              )
                                void withBusy(() =>
                                  deleteAc06CostingGroup(row.id, { company_id: companyId }),
                                );
                            }}
                            className="border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700"
                          >
                            Delete
                          </button>
                        </div>
                      ),
                    },
                  ]}
                  rows={costingGroups}
                  rowKey={(row) => row.id}
                  maxHeight="none"
                  emptyMessage="No Costing Group exists yet for this company."
                />
              </div>
            ) : null}
            {tab === "history" ? (
              <div className="grid gap-3">
                <p className="text-sm text-slate-600">
                  Closed snapshots are immutable. The selected month is shown
                  below; open the full-page report to compare multiple months.
                </p>
                <ErpDenseGrid
                  columns={[
                    {
                      key: "costing_group_name_snapshot",
                      label: "Group",
                      width: "140px",
                      render: (row) =>
                        row.costing_group_name_snapshot || "Standalone",
                    },
                    {
                      key: "source_sloc_group_name_snapshot",
                      label: "Source SLOC Group",
                      width: "160px",
                    },
                    {
                      key: "material_name_snapshot",
                      label: "Material Name",
                      width: "220px",
                    },
                    {
                      key: "material_external_code_snapshot",
                      label: "External Code",
                      width: "120px",
                      render: (row) => row.material_external_code_snapshot || "-",
                    },
                    { key: "rate", label: "Rate", width: "110px" },
                    { key: "verification_status", label: "Verification", width: "120px" },
                  ]}
                  rows={historyQuery.data?.rows ?? EMPTY}
                  rowKey={(row) => row.id}
                  emptyMessage={
                    historyQuery.data?.archive
                      ? "No archived rows."
                      : "The selected month is still open or has no archive."
                  }
                />
              </div>
            ) : null}
          </div>
        ),
      }}
    />
  );
}
