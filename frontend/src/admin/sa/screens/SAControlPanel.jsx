/*
 * File-ID: 9.17B
 * File-Path: frontend/src/admin/sa/screens/SAControlPanel.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin command center surface consuming admin diagnostics endpoints
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import { openScreen } from "../../../navigation/screenStackEngine.js";

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

function MetricCard({ label, value, tone = "sky", caption }) {
  const toneClassMap = {
    sky: "bg-sky-50 text-sky-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
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

function LaunchCard({ badge, title, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-[0_12px_34px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-[0_18px_42px_rgba(14,116,144,0.12)]"
    >
      <div className="flex items-center justify-between gap-4">
        <span className="rounded-full bg-sky-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
          {badge}
        </span>
        <span className="text-slate-300 transition group-hover:text-sky-600">
          {"->"}
        </span>
      </div>
      <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
    </button>
  );
}

function DataTableCard({ eyebrow, title, rows, columns, emptyMessage, footer }) {
  return (
    <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-xl font-semibold text-slate-900">{title}</h2>

      {rows.length === 0 ? (
        <div className="mt-5 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
          {emptyMessage}
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-y-3">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id ?? `${title}-${index}`} className="bg-slate-50">
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className="rounded-none px-4 py-3 text-sm text-slate-700 first:rounded-l-2xl last:rounded-r-2xl"
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {footer ? <div className="mt-4 text-sm text-slate-500">{footer}</div> : null}
    </section>
  );
}

export default function SAControlPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [controlPanel, setControlPanel] = useState(null);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const [controlPanelResponse, healthResponse] = await Promise.all([
          fetch(`${import.meta.env.VITE_API_BASE}/api/admin/control-panel`, {
            credentials: "include",
          }),
          fetch(`${import.meta.env.VITE_API_BASE}/api/admin/system-health`, {
            credentials: "include",
          }),
        ]);

        const [controlPanelJson, healthJson] = await Promise.all([
          readJsonSafe(controlPanelResponse),
          readJsonSafe(healthResponse),
        ]);

        if (!alive) return;

        if (!controlPanelResponse.ok || !controlPanelJson?.ok) {
          throw new Error("CONTROL_PANEL_READ_FAILED");
        }

        setControlPanel(controlPanelJson.data ?? null);
        setHealth(healthJson?.ok ? healthJson.data ?? null : null);
      } catch {
        if (!alive) return;
        setError("Unable to load the SA control panel right now.");
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      alive = false;
    };
  }, []);

  const recentSessions = controlPanel?.recent_sessions ?? [];
  const recentAudit = controlPanel?.recent_audit ?? [];

  const statusAlerts = [
    health?.db_status === "DOWN"
      ? {
          title: "Database attention required",
          body: "The ERP database health probe is failing. SA should investigate before provisioning new activity.",
          tone: "rose",
        }
      : null,
    health?.acl_snapshot_status === "UNAVAILABLE"
      ? {
          title: "ACL snapshot is unavailable",
          body: "Permission projection is not reporting ready state. ACL governance should be reviewed next.",
          tone: "amber",
        }
      : null,
    health?.menu_snapshot_status === "UNAVAILABLE"
      ? {
          title: "Menu snapshot is unavailable",
          body: "Menu projection is not ready. Admin navigation integrity may be at risk.",
          tone: "amber",
        }
      : null,
    !loading && recentSessions.length === 0
      ? {
          title: "No active session preview",
          body: "Control panel did not return recent active sessions. Session governance should be reviewed.",
          tone: "slate",
        }
      : null,
  ].filter(Boolean);

  const quickLaunch = [
    {
      badge: "Health",
      title: "System Health",
      description: "Open diagnostics to review database availability, ACL snapshot readiness, and menu snapshot readiness.",
      onClick: () => openScreen("SA_SYSTEM_HEALTH"),
    },
    {
      badge: "Trace",
      title: "Audit Viewer",
      description: "Inspect recent administrative actions and review which governance operations succeeded or failed.",
      onClick: () => openScreen("SA_AUDIT"),
    },
    {
      badge: "Secure",
      title: "Session Control",
      description: "Review the full ERP session inventory and revoke active access when governance requires it.",
      onClick: () => openScreen("SA_SESSIONS"),
    },
    {
      badge: "Approve",
      title: "Signup Requests",
      description: "Review incoming onboarding requests and move approved users into the ERP lifecycle.",
      onClick: () => openScreen("SA_SIGNUP_REQUESTS"),
    },
    {
      badge: "Provision",
      title: "Create Company",
      description: "Start a fresh company setup flow and extend the organizational structure from SA control.",
      onClick: () => openScreen("SA_COMPANY_CREATE"),
    },
    {
      badge: "Govern",
      title: "User Control",
      description: "Open user governance to review user posture, lifecycle state, and operational readiness.",
      onClick: () => openScreen("SA_USERS"),
    },
    {
      badge: "Anchor",
      title: "Back To SA Home",
      description: "Return to the Super Admin dashboard entry shell and main command overview.",
      onClick: () => openScreen("SA_HOME", { mode: "reset" }),
    },
  ];

  return (
    <section className="min-h-full bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.09),_transparent_28%),linear-gradient(180deg,_#f8fbfd_0%,_#eef4f7_100%)] px-6 py-6 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[30px] border border-slate-200 bg-white px-6 py-6 shadow-[0_16px_44px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">
                SA Command Center
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                ERP Control Panel
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-500">
                Use this screen to assess ERP health, review recent activity, and launch the next SA governance surface without leaving the control plane.
              </p>
            </div>

            <div className="rounded-3xl border border-sky-100 bg-sky-50 px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-700">
                Runtime
              </p>
              <p className="mt-2 text-lg font-semibold text-slate-900">
                {loading ? "Loading..." : health?.db_status === "DOWN" ? "Attention" : "Operational"}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Version {controlPanel?.system ?? health?.system_version ?? "N/A"}
              </p>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 shadow-[0_12px_30px_rgba(190,24,93,0.08)]">
            {error}
          </div>
        ) : null}

        {statusAlerts.length > 0 ? (
          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            {statusAlerts.map((alert) => (
              <article
                key={alert.title}
                className={`rounded-[28px] border px-5 py-5 shadow-[0_12px_30px_rgba(15,23,42,0.06)] ${
                  alert.tone === "rose"
                    ? "border-rose-200 bg-rose-50"
                    : alert.tone === "amber"
                      ? "border-amber-200 bg-amber-50"
                      : "border-slate-200 bg-slate-50"
                }`}
              >
                <h2 className="text-base font-semibold text-slate-900">{alert.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{alert.body}</p>
              </article>
            ))}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Database"
            value={loading ? "..." : health?.db_status ?? controlPanel?.db_status ?? "N/A"}
            tone={health?.db_status === "DOWN" ? "rose" : "emerald"}
            caption="Live database probe from the admin diagnostics layer."
          />
          <MetricCard
            label="Mapped Users"
            value={loading ? "..." : String(controlPanel?.user_count ?? 0)}
            tone="sky"
            caption="Current user-company role mappings visible to the admin control plane."
          />
          <MetricCard
            label="Recent Active Sessions"
            value={loading ? "..." : String(recentSessions.length)}
            tone="amber"
            caption="Preview count from the current active-session diagnostics payload."
          />
          <MetricCard
            label="Recent Admin Activity"
            value={loading ? "..." : String(recentAudit.length)}
            tone="slate"
            caption="Most recent admin control-plane audit entries returned by backend."
          />
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <DataTableCard
            eyebrow="Live Preview"
            title="Recent Sessions"
            rows={recentSessions.map((session) => ({
              id: session.session_id,
              ...session,
            }))}
            columns={[
              {
                key: "session",
                label: "Session",
                render: (row) => (
                  <div>
                    <p className="font-medium text-slate-900">{shortId(row.session_id)}</p>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                      {row.status}
                    </p>
                  </div>
                ),
              },
              {
                key: "user",
                label: "Auth User",
                render: (row) => shortId(row.auth_user_id),
              },
              {
                key: "created",
                label: "Created",
                render: (row) => formatDateTime(row.created_at),
              },
              {
                key: "seen",
                label: "Last Seen",
                render: (row) => formatDateTime(row.last_seen_at),
              },
            ]}
            emptyMessage="No recent active sessions are available in the current preview payload."
            footer="Full session governance screen is part of the next SA build wave."
          />

          <div className="grid gap-6">
            <DataTableCard
              eyebrow="Admin Trail"
              title="Recent Audit"
              rows={recentAudit.map((audit) => ({
                id: audit.audit_id,
                ...audit,
              }))}
              columns={[
                {
                  key: "action",
                  label: "Action",
                  render: (row) => (
                    <div>
                      <p className="font-medium text-slate-900">{row.action_code ?? "N/A"}</p>
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                        {row.status ?? "UNKNOWN"}
                      </p>
                    </div>
                  ),
                },
                {
                  key: "actor",
                  label: "Actor",
                  render: (row) => shortId(row.admin_user_id),
                },
                {
                  key: "when",
                  label: "Performed",
                  render: (row) => formatDateTime(row.performed_at),
                },
              ]}
              emptyMessage="No recent admin audit entries are available in the current preview payload."
              footer="Dedicated audit viewer will provide broader filtering and trace depth."
            />

            <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Snapshot Readiness
              </p>
              <h2 className="mt-3 text-xl font-semibold text-slate-900">
                Access Projection Status
              </h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl bg-slate-50 px-5 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    ACL Snapshot
                  </p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">
                    {loading ? "..." : health?.acl_snapshot_status ?? "N/A"}
                  </p>
                </div>
                <div className="rounded-3xl bg-slate-50 px-5 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Menu Snapshot
                  </p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">
                    {loading ? "..." : health?.menu_snapshot_status ?? "N/A"}
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Quick Launch
            </p>
            <h2 className="mt-3 text-xl font-semibold text-slate-900">
              Open the next SA workspace
            </h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {quickLaunch.map((action) => (
                <LaunchCard key={action.title} {...action} />
              ))}
            </div>
          </section>

          <section className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Build Program
            </p>
            <h2 className="mt-3 text-xl font-semibold text-slate-900">
              Next governance waves
            </h2>
            <div className="mt-5 space-y-3">
              {[
                "Org Masters completion",
                "User lifecycle and scope governance",
                "Module enablement by company",
                "ACL and capability governance",
                "Workflow and approval control",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3"
                >
                  <p className="text-sm font-medium text-slate-700">{item}</p>
                  <span className="rounded-full bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Planned
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
