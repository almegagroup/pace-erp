import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpSummaryChips from "../../../components/data/ErpSummaryChips.jsx";
import ErpMasterListTemplate from "../../../components/templates/ErpMasterListTemplate.jsx";
import { pushToast } from "../../../store/uiToast.js";
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

// Group-lead rows get a visibly distinct background -- the AC06 analogue of
// PO11's "Group Total row gets a distinct background" rule (§35.18). AC06
// has no group-total/sum row (§114.23: rates propagate, they never sum), so
// the row that actually carries the editable rate for its Costing Group is
// the one that needs to stand out instead.
function rateRowProps(row) {
  if (row.is_group_lead) return { className: "!bg-sky-50" };
  return {};
}

export default function SlocCostingGroupPage() {
  const { runtimeContext } = useMenu();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const primaryFocusRef = useRef(null);
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
  const [targetCostingGroupId, setTargetCostingGroupId] = useState("");
  const [costingMemberIds, setCostingMemberIds] = useState([]);
  const [costingSearch, setCostingSearch] = useState("");
  const [managedSlocGroupId, setManagedSlocGroupId] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [selectedMaterialIds, setSelectedMaterialIds] = useState([]);
  const [rateSearch, setRateSearch] = useState("");
  const [rateCostingGroupId, setRateCostingGroupId] = useState("");
  const [onlyStandalone, setOnlyStandalone] = useState(false);
  const [reportMonths, setReportMonths] = useState(AC06_FIRST_MONTH);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setShowFullReport(isReportRoute);
  }, [isReportRoute]);

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
  const groupSetupRows = rows.filter(
    (row) =>
      !row.is_excluded &&
      String(row.source_sloc_group_id || "") === costingParentId &&
      `${row.material_name || ""} ${row.material_external_code || ""}`
        .toLowerCase()
        .includes(costingSearch.toLowerCase()),
  );
  const managedSlocRows = rows.filter(
    (row) =>
      String(row.source_sloc_group_id || "") === managedSlocGroupId &&
      `${row.material_name || ""} ${row.material_external_code || ""}`
        .toLowerCase()
        .includes(materialSearch.toLowerCase()),
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
                <label className="grid gap-1 text-sm text-slate-700">
                  <span className="font-medium text-slate-800">
                    Months (comma-separated, YYYY-MM)
                  </span>
                  <input
                    value={reportMonths}
                    onChange={(event) => setReportMonths(event.target.value)}
                    placeholder="2026-05,2026-06"
                    className="h-10 border border-slate-300 px-3 outline-none focus:border-sky-500"
                  />
                </label>
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
                onClick: () => {
                  if (
                    window.confirm(
                      `Close ${month}? This creates an immutable archive.`,
                    )
                  )
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
                <p className="text-sm text-slate-600">
                  Choose Company, SLOC Group, and one or more months, then
                  Execute Full Report for a side-by-side month comparison. The
                  report can be opened in a separate ERP window through
                  Shift+F8.
                </p>
                <input
                  value={reportMonths}
                  onChange={(event) => setReportMonths(event.target.value)}
                  placeholder="2026-05,2026-06"
                  className="h-10 w-full max-w-md border border-slate-300 px-3"
                />
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
              <div className="grid gap-4">
                <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
                  <div className="grid gap-3 border border-slate-200 bg-white p-4">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {editingSlocId ? "Edit SLOC Group" : "New SLOC Group"}
                    </h3>
                    <p className="text-xs leading-5 text-slate-500">
                      Choose the company storage locations that belong to this
                      AC06 costing scope.
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
                  <ErpDenseGrid
                    columns={[
                      { key: "group_name", label: "Existing SLOC Group" },
                      {
                        key: "member_count",
                        label: "SLOCs",
                        render: (row) => (row.storage_location_ids || []).length,
                      },
                      { key: "active", label: "Status", render: () => "Active" },
                      {
                        key: "actions",
                        label: "Action",
                        render: (row) => (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setManagedSlocGroupId(row.id);
                                setSlocGroupId(row.id);
                                setMaterialSearch("");
                                setSelectedMaterialIds([]);
                                window.setTimeout(() => {
                                  document
                                    .getElementById("ac06-manage-materials")
                                    ?.scrollIntoView({
                                      behavior: "smooth",
                                      block: "start",
                                    });
                                }, 0);
                              }}
                              className="text-xs font-semibold text-sky-800"
                            >
                              Manage Materials
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCostingParentId(row.id);
                                setTargetCostingGroupId("");
                                setCostingMemberIds([]);
                                setTab("group");
                              }}
                              className="text-xs font-semibold text-sky-800"
                            >
                              Manage
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSlocId(row.id);
                                setSlocName(row.group_name);
                                setSlocLocations(
                                  (row.storage_location_ids || []).map(String),
                                );
                              }}
                              className="text-xs font-semibold text-sky-800"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`Delete ${row.group_name}?`))
                                  void withBusy(() =>
                                    deleteAc06SlocGroup(row.id, {
                                      company_id: companyId,
                                    }),
                                  );
                              }}
                              className="text-xs font-semibold text-rose-800"
                            >
                              Delete
                            </button>
                          </div>
                        ),
                      },
                    ]}
                    rows={slocGroups}
                    rowKey={(row) => row.id}
                    emptyMessage="No AC06 SLOC Group exists for this company yet."
                  />
                </div>
                {managedSlocGroupId ? (
                  <div id="ac06-manage-materials" className="grid gap-3">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                      <input
                        value={materialSearch}
                        onChange={(event) => setMaterialSearch(event.target.value)}
                        placeholder="Search material name or external code..."
                        className="h-10 border border-slate-300 px-3"
                      />
                      <button
                        type="button"
                        disabled={
                          busy ||
                          !selectedMaterialIds.length ||
                          workspace.month?.status === "CLOSED"
                        }
                        onClick={() =>
                          void withBusy(() =>
                            setAc06MaterialInclusion({
                              company_id: companyId,
                              rate_month: month,
                              line_ids: selectedMaterialIds,
                              included: true,
                            }).then(() => setSelectedMaterialIds([])),
                          )
                        }
                        className="border border-sky-700 bg-sky-100 px-3 text-sm font-semibold"
                      >
                        Include Selected
                      </button>
                      <button
                        type="button"
                        disabled={
                          busy ||
                          !selectedMaterialIds.length ||
                          workspace.month?.status === "CLOSED"
                        }
                        onClick={() =>
                          void withBusy(() =>
                            setAc06MaterialInclusion({
                              company_id: companyId,
                              rate_month: month,
                              line_ids: selectedMaterialIds,
                              included: false,
                            }).then(() => setSelectedMaterialIds([])),
                          )
                        }
                        className="border border-rose-700 bg-rose-50 px-3 text-sm font-semibold"
                      >
                        Exclude Selected
                      </button>
                    </div>
                    <ErpDenseGrid
                      columns={[
                        {
                          key: "selected",
                          label: "Select",
                          width: "70px",
                          render: (row) => (
                            <input
                              type="checkbox"
                              checked={selectedMaterialIds.includes(row.id)}
                              onChange={() =>
                                toggle(
                                  selectedMaterialIds,
                                  row.id,
                                  setSelectedMaterialIds,
                                )
                              }
                            />
                          ),
                        },
                        ...materialIdentityColumns(),
                        {
                          key: "costing_group_name",
                          label: "Current Costing Group",
                          width: "160px",
                          render: (row) => row.costing_group_name || "Standalone",
                        },
                        {
                          key: "scope",
                          label: "Scope",
                          width: "100px",
                          render: (row) =>
                            row.is_excluded ? "Excluded" : "Included",
                        },
                        {
                          key: "status",
                          label: "Rate Status",
                          width: "110px",
                          render: (row) =>
                            row.is_excluded ? "Excluded" : row.verification_status,
                        },
                      ]}
                      rows={managedSlocRows}
                      rowKey={(row) => row.id}
                      emptyMessage="This SLOC Group has no eligible materials yet."
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            {tab === "group" ? (
              <div className="grid gap-4 border border-slate-200 p-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="grid gap-1 text-xs font-semibold">
                    Parent SLOC Group
                    <select
                      value={costingParentId}
                      onChange={(event) => {
                        setCostingParentId(event.target.value);
                        setTargetCostingGroupId("");
                        setCostingMemberIds([]);
                      }}
                      className="h-10 border border-slate-300 bg-white px-3"
                    >
                      <option value="">Select SLOC Group</option>
                      {slocGroups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.group_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-semibold">
                    Costing Group Name
                    <input
                      value={costingName}
                      onChange={(event) => setCostingName(event.target.value)}
                      className="h-10 border border-slate-300 px-3"
                    />
                  </label>
                  <div className="mt-5 flex gap-2">
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
                            setTargetCostingGroupId(created?.id || "");
                          }
                          setCostingName("");
                          setEditingCostingId("");
                        })
                      }
                      className="h-10 border border-sky-700 bg-sky-100 px-3 text-sm font-semibold"
                    >
                      {editingCostingId
                        ? "Save Costing Group"
                        : "Create Costing Group"}
                    </button>
                    {editingCostingId ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCostingId("");
                          setCostingName("");
                        }}
                        className="h-10 border border-slate-300 px-3 text-sm"
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_260px]">
                  <label className="grid gap-1 text-xs font-semibold">
                    Search Eligible / Standalone Material
                    <input
                      value={costingSearch}
                      onChange={(event) => setCostingSearch(event.target.value)}
                      placeholder="Material name or external code..."
                      className="h-10 border border-slate-300 px-3"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold">
                    Costing Group To Manage
                    <select
                      value={targetCostingGroupId}
                      onChange={(event) =>
                        setTargetCostingGroupId(event.target.value)
                      }
                      className="h-10 border border-slate-300 bg-white px-3"
                    >
                      <option value="">Select Costing Group</option>
                      {costingGroups
                        .filter((group) => group.sloc_group_id === costingParentId)
                        .map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.group_name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <label className="grid gap-1 text-xs font-semibold">
                    Move selected eligible items to
                    <select
                      value={targetCostingGroupId}
                      onChange={(event) =>
                        setTargetCostingGroupId(event.target.value)
                      }
                      className="h-10 border border-slate-300 bg-white px-3"
                    >
                      <option value="">Select Costing Group</option>
                      {costingGroups
                        .filter((group) => group.sloc_group_id === costingParentId)
                        .map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.group_name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !targetCostingGroupId ||
                      !costingMemberIds.length ||
                      workspace.month?.status === "CLOSED"
                    }
                    onClick={() =>
                      void withBusy(async () => {
                        await assignAc06CostingGroup({
                          company_id: companyId,
                          rate_month: month,
                          costing_group_id: targetCostingGroupId,
                          material_ids: groupSetupRows
                            .filter((row) => costingMemberIds.includes(row.id))
                            .map((row) => row.material_id),
                        });
                        setCostingMemberIds([]);
                      })
                    }
                    className="mt-5 h-10 border border-sky-700 bg-sky-100 px-3 text-sm font-semibold"
                  >
                    Map To Group
                  </button>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !costingMemberIds.length ||
                      workspace.month?.status === "CLOSED"
                    }
                    onClick={() =>
                      void withBusy(async () => {
                        await unassignAc06CostingGroup({
                          company_id: companyId,
                          rate_month: month,
                          line_ids: costingMemberIds,
                        });
                        setCostingMemberIds([]);
                      })
                    }
                    className="mt-5 h-10 border border-rose-700 bg-rose-50 px-3 text-sm font-semibold"
                  >
                    Make Standalone
                  </button>
                </div>
                <ErpDenseGrid
                  columns={[
                    {
                      key: "selected",
                      label: "Select",
                      width: "70px",
                      render: (row) => (
                        <input
                          type="checkbox"
                          checked={costingMemberIds.includes(row.id)}
                          onChange={() =>
                            toggle(costingMemberIds, row.id, setCostingMemberIds)
                          }
                        />
                      ),
                    },
                    ...materialIdentityColumns(),
                    {
                      key: "costing_group_name",
                      label: "Current Costing Group",
                      width: "160px",
                      render: (row) => row.costing_group_name || "Standalone",
                    },
                    { key: "verification_status", label: "Rate Status", width: "110px" },
                  ]}
                  rows={groupSetupRows}
                  rowKey={(row) => row.id}
                  emptyMessage="Select a parent SLOC Group to manage its eligible items."
                />
                <ErpDenseGrid
                  columns={[
                    { key: "group_name", label: "Costing Group" },
                    {
                      key: "sloc_group_id",
                      label: "Parent SLOC Group",
                      render: (row) =>
                        slocGroupNameById.get(String(row.sloc_group_id)) || "-",
                    },
                    {
                      key: "actions",
                      label: "Action",
                      render: (row) => (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setCostingParentId(row.sloc_group_id);
                              setTargetCostingGroupId(row.id);
                              setCostingMemberIds([]);
                            }}
                            className="text-xs font-semibold text-sky-800"
                          >
                            Manage
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCostingId(row.id);
                              setCostingParentId(row.sloc_group_id);
                              setCostingName(row.group_name);
                            }}
                            className="text-xs font-semibold text-sky-800"
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
                                  deleteAc06CostingGroup(row.id, {
                                    company_id: companyId,
                                  }),
                                );
                            }}
                            className="text-xs font-semibold text-rose-800"
                          >
                            Delete
                          </button>
                        </div>
                      ),
                    },
                  ]}
                  rows={costingGroups.filter(
                    (group) =>
                      !costingParentId || group.sloc_group_id === costingParentId,
                  )}
                  rowKey={(row) => row.id}
                  emptyMessage="No Costing Group exists yet."
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
