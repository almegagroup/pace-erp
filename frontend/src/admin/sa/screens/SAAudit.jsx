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

function MetricCard({ label, value, caption, tone = "sky" }) {
  const toneClassMap = {
    sky: "bg-sky-50 text-sky-700",
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
    amber: "bg-amber-50 text-amber-700",
    slate: "bg-slate-100 text-slate-700",
  };

  return (
    <article className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-[0_12px_34px_rgba(15,23,42,0.06)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
        {label}
      </p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <h3 className="text-2xl font-semibold text-slate-900">{value}</h3>
        <span
          className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${toneClassMap[tone] ?? toneClassMap.sky}`}
        >
          Live
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-500">{caption}</p>
    </article>
  );
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
    [auditRows, filter],
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
    [searchQuery, statusFilteredRows],
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
  });

  return (
    <section className="min-h-full bg-[#e6edf2] px-4 py-4 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <div className="sticky top-4 z-20 rounded-[30px] border border-slate-200 bg-white px-6 py-6 shadow-[0_16px_44px_rgba(15,23,42,0.12)]">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">
                SA Audit Viewer
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                Admin Audit Trail
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-500">
                Review administrative actions across the ERP control plane, inspect execution outcomes, and trace which actor performed which governance operation.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                ref={(element) => {
                  actionBarRefs.current[0] = element;
                }}
                type="button"
                onClick={() => openScreen("SA_CONTROL_PANEL", { mode: "reset" })}
                onKeyDown={(event) =>
                  handleLinearNavigation(event, {
                    index: 0,
                    refs: actionBarRefs.current,
                    orientation: "horizontal",
                  })
                }
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
              >
                Control Panel
              </button>
              <button
                ref={(element) => {
                  actionBarRefs.current[1] = element;
                }}
                type="button"
                onClick={() => void handleRefresh()}
                onKeyDown={(event) =>
                  handleLinearNavigation(event, {
                    index: 1,
                    refs: actionBarRefs.current,
                    orientation: "horizontal",
                  })
                }
                className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700 shadow-[0_10px_24px_rgba(14,116,144,0.08)]"
              >
                {loading ? "Refreshing..." : "Refresh Audit"}
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 shadow-[0_12px_30px_rgba(190,24,93,0.08)]">
            {error}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="All Events"
            value={loading ? "..." : String(auditRows.length)}
            tone="sky"
            caption="Full admin action history currently returned by the backend audit endpoint."
          />
          <MetricCard
            label="Successful"
            value={loading ? "..." : String(successCount)}
            tone="emerald"
            caption="Administrative actions that completed successfully."
          />
          <MetricCard
            label="Failed"
            value={loading ? "..." : String(failedCount)}
            tone="rose"
            caption="Administrative actions that ended in failed status and may require review."
          />
          <MetricCard
            label="Company Scoped"
            value={loading ? "..." : String(companyScopedCount)}
            tone="amber"
            caption="Audit rows that explicitly bind to a company scope."
          />
        </div>

        <section className="mt-6 rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Audit Filter
              </p>
              <h2 className="mt-3 text-xl font-semibold text-slate-900">
                Admin Action Inventory
              </h2>
            </div>

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
                  className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${
                    filter === option.key
                      ? "bg-sky-600 text-white"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {filteredRows.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
              {loading
                ? "Loading audit inventory..."
                : "No audit rows match the selected filter right now."}
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-y-3">
                <thead>
                  <tr>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Action
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Actor
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Resource
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Company
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Request
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Performed
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
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
                      className="bg-slate-50"
                    >
                      <td className="rounded-l-2xl px-4 py-3 text-sm text-slate-700">
                        <div>
                          <p className="font-medium text-slate-900">
                            {row.action_code ?? "N/A"}
                          </p>
                          <p className="text-xs text-slate-500">
                            {row.resource_type ?? "RESOURCE_UNKNOWN"}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        <div>
                          <p className="font-medium text-slate-900">
                            {shortId(row.admin_user_id)}
                          </p>
                          <p className="text-xs text-slate-500">
                            {row.admin_user_id ?? "N/A"}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        <div>
                          <p className="font-medium text-slate-900">
                            {row.resource_type ?? "N/A"}
                          </p>
                          <p className="text-xs text-slate-500">
                            {row.resource_id ?? "N/A"}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {row.company_id ? shortId(row.company_id) : "Global"}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        <div>
                          <p className="font-medium text-slate-900">
                            {shortId(row.request_id)}
                          </p>
                          <p className="text-xs text-slate-500">
                            {row.request_id ?? "N/A"}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatDateTime(row.performed_at)}
                      </td>
                      <td className="rounded-r-2xl px-4 py-3 text-sm text-slate-700">
                        <span
                          className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${getStatusTone(row.status)}`}
                        >
                          {row.status ?? "UNKNOWN"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
          </div>

          <QuickFilterInput
            inputRef={searchInputRef}
            className="mt-5"
            label="Quick Search"
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by action, resource, actor, request, company, or status"
            hint="Visible quick filter for dense audit history."
          />
        </section>
  );
}
