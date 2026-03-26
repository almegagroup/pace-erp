/*
 * File-ID: 9.15B-FRONT
 * File-Path: frontend/src/admin/sa/screens/SASessions.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin session governance surface for listing and revoking ERP sessions
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import { openScreen } from "../../../navigation/screenStackEngine.js";
import { openActionConfirm } from "../../../store/actionConfirm.js";

const FILTERS = Object.freeze([
  { key: "ALL", label: "All Sessions" },
  { key: "ACTIVE", label: "Active" },
  { key: "REVOKED", label: "Revoked" },
  { key: "IDLE", label: "Idle" },
  { key: "EXPIRED", label: "Expired" },
]);

async function readJsonSafe(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchSessions() {
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE}/api/admin/sessions`,
    {
      credentials: "include",
    }
  );

  const json = await readJsonSafe(response);

  if (!response.ok || !json?.ok || !Array.isArray(json.data)) {
    throw new Error("SESSION_LIST_READ_FAILED");
  }

  return json.data;
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

function formatSessionIdentity(session) {
  if (session.user_code && session.name) {
    return `${session.user_code} ${session.name}`;
  }

  if (session.user_code) {
    return session.user_code;
  }

  if (session.name) {
    return session.name;
  }

  return `Auth ${shortId(session.auth_user_id)}`;
}

function getStatusTone(status) {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-50 text-emerald-700";
    case "REVOKED":
      return "bg-rose-50 text-rose-700";
    case "IDLE":
      return "bg-amber-50 text-amber-700";
    case "EXPIRED":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-sky-50 text-sky-700";
  }
}

function SummaryCard({ label, value, caption, tone = "sky" }) {
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

export default function SASessions() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [revokingSessionId, setRevokingSessionId] = useState("");

  useEffect(() => {
    let alive = true;

    async function loadSessions() {
      setLoading(true);
      setError("");

      try {
        const data = await fetchSessions();

        if (!alive) return;

        setSessions(data);
      } catch {
        if (!alive) return;
        setError("Unable to load ERP sessions right now.");
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    void loadSessions();

    return () => {
      alive = false;
    };
  }, []);

  async function handleRefresh() {
    setLoading(true);
    setError("");

    try {
      const data = await fetchSessions();
      setSessions(data);
    } catch {
      setError("Unable to refresh the session list right now.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke(sessionRow) {
    const approved = await openActionConfirm({
      eyebrow: "SA Session Governance",
      title: "Revoke ERP Session",
      message: `Revoke the session for ${formatSessionIdentity(sessionRow)} now?`,
      confirmLabel: "Revoke",
      cancelLabel: "Cancel",
    });

    if (!approved) {
      return;
    }

    setRevokingSessionId(sessionRow.session_id);
    setError("");

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE}/api/admin/sessions/revoke`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ session_id: sessionRow.session_id }),
        }
      );

      const json = await readJsonSafe(response);

      if (!response.ok || !json?.ok || json?.data?.revoked !== true) {
        throw new Error("SESSION_REVOKE_FAILED");
      }

      const refreshedSessions = await fetchSessions();
      const revokedSession = refreshedSessions.find(
        (session) => session.session_id === sessionRow.session_id
      );

      setSessions(refreshedSessions);

      if (revokedSession?.status !== "REVOKED") {
        throw new Error("SESSION_REVOKE_NOT_FINALIZED");
      }
    } catch {
      setError("Session revoke was not finalized by the backend.");
    } finally {
      setRevokingSessionId("");
    }
  }

  const filteredSessions =
    filter === "ALL"
      ? sessions
      : sessions.filter((session) => session.status === filter);

  const activeCount = sessions.filter((session) => session.status === "ACTIVE").length;
  const revokedCount = sessions.filter((session) => session.status === "REVOKED").length;
  const idleCount = sessions.filter((session) => session.status === "IDLE").length;
  const expiredCount = sessions.filter((session) => session.status === "EXPIRED").length;

  return (
    <section className="min-h-full bg-[#e6edf2] px-4 py-4 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[30px] border border-slate-200 bg-white px-6 py-6 shadow-[0_16px_44px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">
                SA Session Governance
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                ERP Sessions
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-500">
                Review current and historical ERP sessions, inspect lifecycle state, and revoke suspicious or stale access from the Super Admin control plane.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => openScreen("SA_CONTROL_PANEL", { mode: "reset" })}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
              >
                Control Panel
              </button>
              <button
                type="button"
                onClick={() => void handleRefresh()}
                className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700 shadow-[0_10px_24px_rgba(14,116,144,0.08)]"
              >
                {loading ? "Refreshing..." : "Refresh Sessions"}
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
          <SummaryCard
            label="All Sessions"
            value={loading ? "..." : String(sessions.length)}
            tone="sky"
            caption="Full admin-visible session inventory returned by the ERP session governance endpoint."
          />
          <SummaryCard
            label="Active"
            value={loading ? "..." : String(activeCount)}
            tone="emerald"
            caption="Currently live ERP sessions that can still access protected routes."
          />
          <SummaryCard
            label="Revoked"
            value={loading ? "..." : String(revokedCount)}
            tone="rose"
            caption="Sessions explicitly terminated by logout, new login, or revoke governance."
          />
          <SummaryCard
            label="Idle / Expired"
            value={loading ? "..." : String(idleCount + expiredCount)}
            tone="amber"
            caption="Sessions that are no longer usable because lifecycle termination already occurred."
          />
        </div>

        <section className="mt-6 rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Session Filter
              </p>
              <h2 className="mt-3 text-xl font-semibold text-slate-900">
                Session Inventory
              </h2>
            </div>

            <div className="flex flex-wrap gap-2">
              {FILTERS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setFilter(option.key)}
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

          {filteredSessions.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-sm text-slate-500">
              {loading
                ? "Loading session inventory..."
                : "No sessions match the selected filter right now."}
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-y-3">
                <thead>
                  <tr>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Session
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      ERP User
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Status
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Created
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Last Seen
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Expires
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Revoked
                    </th>
                    <th className="px-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSessions.map((session) => (
                    <tr
                      key={session.session_id}
                      className="bg-slate-50"
                    >
                      <td className="rounded-l-2xl px-4 py-3 text-sm text-slate-700">
                        <div>
                          <p className="font-medium text-slate-900">
                            {shortId(session.session_id)}
                          </p>
                          <p className="text-xs text-slate-500">
                            {session.session_id}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        <div>
                          <p className="font-medium text-slate-900">
                            {formatSessionIdentity(session)}
                          </p>
                          <p className="text-xs text-slate-500">
                            {session.parent_company_name ?? "Company Not Captured"}
                          </p>
                          <p className="text-xs text-slate-500">
                            {session.designation_hint ?? `Auth ${shortId(session.auth_user_id)}`}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        <span
                          className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${getStatusTone(session.status)}`}
                        >
                          {session.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatDateTime(session.created_at)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatDateTime(session.last_seen_at)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatDateTime(session.expires_at)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatDateTime(session.revoked_at)}
                      </td>
                      <td className="rounded-r-2xl px-4 py-3 text-sm text-slate-700">
                        {session.status === "ACTIVE" ? (
                          <button
                            type="button"
                            onClick={() => void handleRevoke(session)}
                            disabled={revokingSessionId === session.session_id}
                            className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {revokingSessionId === session.session_id
                              ? "Revoking..."
                              : "Revoke"}
                          </button>
                        ) : (
                          <span className="text-xs uppercase tracking-[0.16em] text-slate-400">
                            Read Only
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
