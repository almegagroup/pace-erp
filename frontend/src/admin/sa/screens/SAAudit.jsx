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
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { handleLinearNavigation } from "../../../navigation/erpRovingFocus.js";
import QuickFilterInput from "../../../components/inputs/QuickFilterInput.jsx";
import ErpMasterListTemplate from "../../../components/templates/ErpMasterListTemplate.jsx";
import { applyQuickFilter } from "../../../shared/erpCollections.js";
import { useErpScreenCommands } from "../../../hooks/useErpScreenCommands.js";
import { useErpScreenHotkeys } from "../../../hooks/useErpScreenHotkeys.js";

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
  const [auditRows, setAuditRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const actionBarRefs = useRef([]);
  const filterRefs = useRef([]);
  const rowRefs = useRef([]);
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

  const successCount = auditRows.filter((row) => row.status === "SUCCESS").length;
  const failedCount = auditRows.filter((row) => row.status === "FAILED").length;
  const companyScopedCount = auditRows.filter((row) => row.company_id).length;

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

  const metrics = [
    {
      key: "all-events",
      label: "All Events",
      value: loading ? "..." : String(auditRows.length),
      tone: "sky",
      caption:
        "Full admin action history currently returned by the backend audit endpoint.",
    },
    {
      key: "successful-events",
      label: "Successful",
      value: loading ? "..." : String(successCount),
      tone: "emerald",
      caption: "Administrative actions that completed successfully.",
    },
    {
      key: "failed-events",
      label: "Failed",
      value: loading ? "..." : String(failedCount),
      tone: "rose",
      caption:
        "Administrative actions that ended in failed status and may require review.",
    },
    {
      key: "company-scoped",
      label: "Company Scoped",
      value: loading ? "..." : String(companyScopedCount),
      tone: "amber",
      caption: "Audit rows that explicitly bind to a company scope.",
    },
  ];

  const filterSection = {
    eyebrow: "Audit Filter",
    title: "Admin Action Inventory",
    aside: (
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((option, index) => (
          <button
            key={option.key}
            ref={(element) => {
              filterRefs.current[index] = element;
            }}
            data-workspace-primary-focus={index === 0 ? "true" : undefined}
            type="button"
            onClick={() => setFilter(option.key)}
            onKeyDown={(event) =>
              handleLinearNavigation(event, {
                index,
                refs: filterRefs.current,
                orientation: "horizontal",
              })
            }
            className={`border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${
              filter === option.key
                ? "border-sky-400 bg-sky-50 text-sky-900"
                : "border-slate-300 bg-white text-slate-600"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    ),
    children: (
      <QuickFilterInput
        inputRef={searchInputRef}
        label="Quick Search"
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search by action, resource, actor, request, company, or status"
        hint="Visible quick filter for dense audit history. Alt+Shift+F jumps here, Alt+Shift+P returns to the filter rail."
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
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr>
                <th className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Action
                </th>
                <th className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Actor
                </th>
                <th className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Resource
                </th>
                <th className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Company
                </th>
                <th className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Request
                </th>
                <th className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Performed
                </th>
                <th className="border-b border-slate-300 bg-[#eef4fb] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, index) => (
                <tr
                  key={row.audit_id}
                  ref={(element) => {
                    rowRefs.current[index] = element;
                  }}
                  tabIndex={0}
                  onKeyDown={(event) =>
                    handleLinearNavigation(event, {
                      index,
                      refs: rowRefs.current,
                      orientation: "vertical",
                    })
                  }
                  className="border-b border-slate-200 bg-white"
                >
                  <td className="px-3 py-2 text-sm text-slate-700">
                    <div>
                      <p className="font-medium text-slate-900">
                        {row.action_code ?? "N/A"}
                      </p>
                      <p className="text-xs text-slate-500">
                        {row.resource_type ?? "RESOURCE_UNKNOWN"}
                      </p>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-700">
                    <div>
                      <p className="font-medium text-slate-900">
                        {shortId(row.admin_user_id)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {row.admin_user_id ?? "N/A"}
                      </p>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-700">
                    <div>
                      <p className="font-medium text-slate-900">
                        {row.resource_type ?? "N/A"}
                      </p>
                      <p className="text-xs text-slate-500">
                        {row.resource_id ?? "N/A"}
                      </p>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-700">
                    {row.company_id ? shortId(row.company_id) : "Global"}
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-700">
                    <div>
                      <p className="font-medium text-slate-900">
                        {shortId(row.request_id)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {row.request_id ?? "N/A"}
                      </p>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-700">
                    {formatDateTime(row.performed_at)}
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-700">
                    <span
                      className={`inline-flex border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${getStatusTone(row.status)}`}
                    >
                      {row.status ?? "UNKNOWN"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
  };

  return (
    <ErpMasterListTemplate
      eyebrow="SA Audit Viewer"
      title="Admin Audit Trail"
      description="This keyboard-native list keeps audit filters, quick search, and dense review rows in one structured operating surface."
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
      metrics={metrics}
      filterSection={filterSection}
      listSection={listSection}
    />
  );
}
