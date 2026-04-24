/*
 * File-ID: 9.14C-FRONT
 * File-Path: frontend/src/admin/sa/screens/SAAudit.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin audit viewer for administrative control-plane events
 * Authority: Frontend
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  openScreen,
  openScreenWithContext,
  getActiveScreenContext,
  updateActiveScreenContext,
  registerScreenRefreshCallback,
} from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import { useErpListNavigation } from "../../../hooks/useErpListNavigation.js";
import ErpCompactFilterSelect from "../../../components/inputs/ErpCompactFilterSelect.jsx";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../components/ErpPaginationStrip.jsx";
import ErpMasterListTemplate from "../../../components/templates/ErpMasterListTemplate.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import { applyQuickFilter } from "../../../shared/erpCollections.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";
import { useErpPagination } from "../../../hooks/useErpPagination.js";

const FILTERS = Object.freeze([
  { key: "ALL", label: "All Events" },
  { key: "SUCCESS", label: "Success" },
  { key: "FAILED", label: "Failed" },
]);

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function formatDateTime(value) {
  if (!value) return "N/A";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";

  return date.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(value) {
  if (!value) return "N/A";
  return String(value).slice(0, 8);
}

function getStatusTone(status) {
  switch (status) {
    case "SUCCESS":
      return "bg-emerald-50 text-emerald-700";
    case "FAILED":
      return "bg-rose-50 text-rose-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export default function SAAudit() {
  const initialContext = useMemo(() => getActiveScreenContext() ?? {}, []);
  const navigate = useNavigate();
  const [auditRows, setAuditRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState(initialContext.parentState?.filter ?? "ALL");
  const [searchQuery, setSearchQuery] = useState(initialContext.parentState?.searchQuery ?? "");
  const [selectedAuditRow, setSelectedAuditRow] = useState(null);
  const [focusKey, setFocusKey] = useState(initialContext.parentState?.focusKey ?? "");
  const [page, setPage] = useState(initialContext.parentState?.page ?? 1);
  const actionBarRefs = useRef([]);
  const filterRefs = useRef([]);
  const searchInputRef = useRef(null);

  useEffect(() => {
    let alive = true;

    async function loadAudit() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_BASE}/api/admin/audit`,
          {
            credentials: "include",
          }
        );

        const json = await readJsonSafe(response);

        if (!alive) return;

        if (!response.ok || !json?.ok || !Array.isArray(json.data)) {
          throw new Error("AUDIT_READ_FAILED");
        }

        setAuditRows(json.data);
      } catch {
        if (!alive) return;
        setError("Unable to load admin audit logs right now.");
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    void loadAudit();

    return () => {
      alive = false;
    };
  }, []);

  async function handleRefresh() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE}/api/admin/audit`,
        {
          credentials: "include",
        }
      );

      const json = await readJsonSafe(response);

      if (!response.ok || !json?.ok || !Array.isArray(json.data)) {
        throw new Error("AUDIT_REFRESH_FAILED");
      }

      setAuditRows(json.data);
    } catch {
      setError("Unable to refresh audit logs right now.");
    } finally {
      setLoading(false);
    }
  }

  const statusFilteredRows = useMemo(
    () =>
      filter === "ALL"
        ? auditRows
        : auditRows.filter((row) => row.status === filter),
    [auditRows, filter]
  );

  const filteredRows = useMemo(
    () =>
      applyQuickFilter(statusFilteredRows, searchQuery, [
        "action_code",
        "resource_type",
        "resource_id",
        "admin_user_id",
        "request_id",
        "status",
        "company_id",
      ]),
    [searchQuery, statusFilteredRows]
  );
  const auditPagination = useErpPagination(filteredRows, 10);
  const auditPage = auditPagination.page;
  const setAuditPage = auditPagination.setPage;

  function openDetail(row) {
    const nextFocusKey = row?.audit_id ?? "";
    const parentState = {
      filter,
      searchQuery,
      page: auditPage,
      focusKey: nextFocusKey,
    };
    setSelectedAuditRow(row ?? null);
    setFocusKey(nextFocusKey);
    updateActiveScreenContext({ parentState });
    openScreenWithContext("SA_AUDIT_DETAIL", {
      auditRow: row,
      parentState,
      refreshOnReturn: true,
    });
    navigate("/sa/audit/detail");
  }

  const { getRowProps, focusRow } = useErpListNavigation(auditPagination.pageItems, {
    onActivate: (row) => {
      openDetail(row);
    },
  });

  useEffect(
    () =>
      registerScreenRefreshCallback(() => {
        void handleRefresh();
      }),
    [],
  );

  useEffect(() => {
    updateActiveScreenContext({
      parentState: {
        filter,
        searchQuery,
        page: auditPage,
        focusKey,
      },
    });
  }, [filter, searchQuery, auditPage, focusKey]);

  useEffect(() => {
    if (auditPage !== page) {
      setAuditPage(page);
    }
  }, [page, auditPage, setAuditPage]);

  useEffect(() => {
    if (!focusKey || auditPagination.pageItems.length === 0) {
      return;
    }
    const targetIndex = auditPagination.pageItems.findIndex((row) => row.audit_id === focusKey);
    if (targetIndex >= 0) {
      queueMicrotask(() => focusRow(targetIndex));
    }
  }, [auditPagination.pageItems, focusKey, focusRow]);

  useErpScreenCommands([
    {
      id: "sa-audit-refresh",
      group: "Current Screen",
      label: loading ? "Refreshing audit trail..." : "Refresh audit trail",
      keywords: ["refresh", "audit", "logs"],
      disabled: loading,
      perform: () => void handleRefresh(),
      order: 10,
    },
    {
      id: "sa-audit-focus-search",
      group: "Current Screen",
      label: "Focus audit search",
      keywords: ["search", "filter", "audit"],
      perform: () => searchInputRef.current?.focus(),
      order: 20,
    },
    {
      id: "sa-audit-open-control-panel",
      group: "Current Screen",
      label: "Open control panel",
      keywords: ["control panel", "sa"],
      perform: () => openScreen("SA_CONTROL_PANEL", { mode: "reset" }),
      order: 30,
    },
  ]);

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => void handleRefresh(),
    },
    focusSearch: {
      perform: () => searchInputRef.current?.focus(),
    },
    focusPrimary: {
      perform: () => filterRefs.current[0]?.focus(),
    },
  });

  const topActions = [
    {
      key: "control-panel",
      label: "Control Panel",
      tone: "neutral",
      buttonRef: (element) => {
        actionBarRefs.current[0] = element;
      },
      onClick: () => openScreen("SA_CONTROL_PANEL", { mode: "reset" }),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 0,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
    {
      key: "refresh-audit",
      label: loading ? "Refreshing..." : "Refresh Audit",
      hint: "Alt+R",
      tone: "primary",
      buttonRef: (element) => {
        actionBarRefs.current[1] = element;
      },
      onClick: () => void handleRefresh(),
      onKeyDown: (event) =>
        handleLinearNavigation(event, {
          index: 1,
          refs: actionBarRefs.current,
          orientation: "horizontal",
        }),
    },
  ];

  const filterSection = {
    eyebrow: "Audit Filter",
    title: "Admin Action Inventory",
    aside: (
      <ErpCompactFilterSelect
        label="Audit View"
        value={filter}
        options={FILTERS}
        onChange={setFilter}
        selectRef={(element) => {
          filterRefs.current[0] = element;
        }}
        primaryFocus={true}
        helperText="Compact filtering keeps the audit selector short and leaves focus travel for the rows that matter."
      />
    ),
    children: (
      <QuickFilterInput
        inputRef={searchInputRef}
        label="Quick Search"
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search by action, resource, actor, request, company, or status"
        hint="Visible quick filter for dense audit history. Alt+Shift+F jumps here, Alt+Shift+P returns to the filter selector."
      />
    ),
  };

  const listSection = {
    eyebrow: "Audit Rows",
    title: loading
      ? "Refreshing audit inventory"
      : `${filteredRows.length} visible audit row${filteredRows.length === 1 ? "" : "s"}`,
    children:
      filteredRows.length === 0 ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-sm text-slate-500">
          {loading
            ? "Loading audit inventory..."
            : "No audit rows match the selected filter right now."}
        </div>
      ) : (
        <>
          <ErpPaginationStrip
            page={auditPage}
            setPage={(nextPage) => {
              setPage(nextPage);
              setAuditPage(nextPage);
            }}
            totalPages={auditPagination.totalPages}
            startIndex={auditPagination.startIndex}
            endIndex={auditPagination.endIndex}
            totalItems={filteredRows.length}
          />
          <ErpDenseGrid
            columns={[
              {
                key: "action",
                label: "Action",
                render: (row) => (
                  <div>
                    <p className="font-medium leading-tight">{row.action_code ?? "N/A"}</p>
                    <p className="text-[10px] text-slate-500">{row.resource_type ?? "RESOURCE_UNKNOWN"}</p>
                  </div>
                ),
              },
              {
                key: "actor",
                label: "Actor",
                render: (row) => (
                  <div>
                    <p className="font-medium leading-tight">{shortId(row.admin_user_id)}</p>
                    <p className="text-[10px] text-slate-500 truncate max-w-[120px]">{row.admin_user_id ?? "N/A"}</p>
                  </div>
                ),
              },
              {
                key: "resource",
                label: "Resource",
                render: (row) => (
                  <div>
                    <p className="font-medium leading-tight">{row.resource_type ?? "N/A"}</p>
                    <p className="text-[10px] text-slate-500 truncate max-w-[120px]">{row.resource_id ?? "N/A"}</p>
                  </div>
                ),
              },
              {
                key: "company",
                label: "Company",
                render: (row) => row.company_id ? shortId(row.company_id) : "Global",
              },
              {
                key: "request",
                label: "Request",
                render: (row) => (
                  <div>
                    <p className="font-medium leading-tight">{shortId(row.request_id)}</p>
                    <p className="text-[10px] text-slate-500 truncate max-w-[100px]">{row.request_id ?? "N/A"}</p>
                  </div>
                ),
              },
              {
                key: "performed",
                label: "Performed",
                render: (row) => formatDateTime(row.performed_at),
              },
              {
                key: "status",
                label: "Status",
                render: (row) => (
                  <span className={`inline-flex border px-2 py-[1px] text-[10px] font-semibold uppercase tracking-[0.14em] ${getStatusTone(row.status)}`}>
                    {row.status ?? "UNKNOWN"}
                  </span>
                ),
              },
            ]}
            rows={auditPagination.pageItems}
            rowKey={(row) => row.audit_id}
            getRowProps={(row, index) => ({
              ...getRowProps(index),
              onClick: () => setSelectedAuditRow(row),
              className: row.audit_id === focusKey ? "bg-sky-50" : "",
            })}
            onRowActivate={(row) => openDetail(row)}
            emptyMessage="No audit rows match the selected filter right now."
          />
        </>
      ),
  };

  return (
    <ErpMasterListTemplate
      eyebrow="SA Audit Viewer"
      title="Admin Audit Trail"
      actions={topActions}
      notices={
        error
          ? [
              {
                key: "error",
                tone: "error",
                message: error,
              },
            ]
          : []
      }
      footerHints={["↑↓ Navigate", "Enter Open", "F8 Refresh", "Esc Back", "Ctrl+K Command Bar"]}
      filterSection={filterSection}
      listSection={listSection}
      bottomSection={
        selectedAuditRow ? (
          <section className="grid gap-2 border-t border-slate-300 pt-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Selected Audit Detail
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Action", selectedAuditRow.action_code ?? "N/A"],
                ["Status", selectedAuditRow.status ?? "UNKNOWN"],
                ["Performed", formatDateTime(selectedAuditRow.performed_at)],
                ["Actor", selectedAuditRow.admin_user_id ?? "N/A"],
                ["Request", selectedAuditRow.request_id ?? "N/A"],
                ["Resource Type", selectedAuditRow.resource_type ?? "N/A"],
                ["Resource Id", selectedAuditRow.resource_id ?? "N/A"],
                ["Company", selectedAuditRow.company_id ?? "Global"],
                ["Audit Id", selectedAuditRow.audit_id ?? "N/A"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="border border-slate-200 bg-white px-3 py-2"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {label}
                  </div>
                  <div className="mt-1 break-all text-xs text-slate-900">
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null
      }
    />
  );
}
