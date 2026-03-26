/*
 * File-ID: 9.16B-FRONT
 * File-Path: frontend/src/admin/sa/screens/SASystemHealth.jsx
 * Gate: 9
 * Phase: 9
 * Domain: FRONT
 * Purpose: Super Admin diagnostics surface for ERP system health visibility
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

function formatSystemVersion(value) {
  if (!value) return "N/A";

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    const system = typeof value.system === "string" ? value.system : "PACE-ERP";
    const version = typeof value.version === "string" ? value.version : "N/A";
    const buildGate =
      typeof value.build_gate === "string" ? value.build_gate : null;

    return buildGate
      ? `${system} ${version} (${buildGate})`
      : `${system} ${version}`;
  }

  return String(value);
}

function HealthCard({ label, value, description, tone = "sky" }) {
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
      <p className="mt-3 text-sm leading-6 text-slate-500">{description}</p>
    </article>
  );
}

export default function SASystemHealth() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    async function loadHealth() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_BASE}/api/admin/system-health`,
          {
            credentials: "include",
          }
        );

        const json = await readJsonSafe(response);

        if (!alive) return;

        if (!response.ok || !json?.ok) {
          throw new Error("SYSTEM_HEALTH_READ_FAILED");
        }

        setHealth(json.data ?? null);
      } catch {
        if (!alive) return;
        setError("Unable to load ERP system health right now.");
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    void loadHealth();

    return () => {
      alive = false;
    };
  }, []);

  async function handleRefresh() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE}/api/admin/system-health`,
        {
          credentials: "include",
        }
      );

      const json = await readJsonSafe(response);

      if (!response.ok || !json?.ok) {
        throw new Error("SYSTEM_HEALTH_REFRESH_FAILED");
      }

      setHealth(json.data ?? null);
    } catch {
      setError("Unable to refresh ERP system health right now.");
    } finally {
      setLoading(false);
    }
  }

  const dbStatus = health?.db_status ?? "N/A";
  const aclStatus = health?.acl_snapshot_status ?? "N/A";
  const menuStatus = health?.menu_snapshot_status ?? "N/A";
  const systemVersion = formatSystemVersion(health?.system_version);

  const alerts = [
    dbStatus === "DOWN"
      ? {
          title: "Database probe is failing",
          body: "Core ERP database health is reporting DOWN. This should be treated as operationally urgent.",
          tone: "rose",
        }
      : null,
    aclStatus === "UNAVAILABLE"
      ? {
          title: "ACL snapshot is unavailable",
          body: "Permission projection is not reporting healthy status. Access governance may need attention.",
          tone: "amber",
        }
      : null,
    menuStatus === "UNAVAILABLE"
      ? {
          title: "Menu snapshot is unavailable",
          body: "Navigation projection is not ready. Menu visibility and route reachability may be affected.",
          tone: "amber",
        }
      : null,
  ].filter(Boolean);

  return (
    <section className="min-h-full bg-[#e6edf2] px-4 py-4 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[30px] border border-slate-200 bg-white px-6 py-6 shadow-[0_16px_44px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">
                SA Diagnostics
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                ERP System Health
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-500">
                Review the ERP runtime health probes for database availability, ACL snapshot readiness, and menu snapshot readiness from the Super Admin diagnostics surface.
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
                {loading ? "Refreshing..." : "Refresh Health"}
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 shadow-[0_12px_30px_rgba(190,24,93,0.08)]">
            {error}
          </div>
        ) : null}

        {alerts.length > 0 ? (
          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            {alerts.map((alert) => (
              <article
                key={alert.title}
                className={`rounded-[28px] border px-5 py-5 shadow-[0_12px_30px_rgba(15,23,42,0.06)] ${
                  alert.tone === "rose"
                    ? "border-rose-200 bg-rose-50"
                    : "border-amber-200 bg-amber-50"
                }`}
              >
                <h2 className="text-base font-semibold text-slate-900">{alert.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{alert.body}</p>
              </article>
            ))}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <HealthCard
            label="System Version"
            value={loading ? "..." : systemVersion}
            tone="sky"
            description="Current backend system version reported by the diagnostics endpoint."
          />
          <HealthCard
            label="Database"
            value={loading ? "..." : dbStatus}
            tone={dbStatus === "DOWN" ? "rose" : "emerald"}
            description="Authoritative database connectivity check against ERP session storage."
          />
          <HealthCard
            label="ACL Snapshot"
            value={loading ? "..." : aclStatus}
            tone={aclStatus === "UNAVAILABLE" ? "amber" : "emerald"}
            description="Readiness of the permission projection layer used by controlled access flow."
          />
          <HealthCard
            label="Menu Snapshot"
            value={loading ? "..." : menuStatus}
            tone={menuStatus === "UNAVAILABLE" ? "amber" : "emerald"}
            description="Readiness of the menu projection layer that feeds controlled navigation."
          />
        </div>

        <section className="mt-6 rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
            Diagnostics Interpretation
          </p>
          <h2 className="mt-3 text-xl font-semibold text-slate-900">
            What SA should do next
          </h2>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <div className="rounded-3xl bg-slate-50 px-5 py-5">
              <p className="text-sm font-semibold text-slate-900">If Database is DOWN</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Treat this as operationally urgent. Avoid provisioning new governance actions until the core runtime is stable again.
              </p>
            </div>
            <div className="rounded-3xl bg-slate-50 px-5 py-5">
              <p className="text-sm font-semibold text-slate-900">If ACL Snapshot is UNAVAILABLE</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Review access-governance inputs and upcoming ACL administration surfaces before expanding user scope.
              </p>
            </div>
            <div className="rounded-3xl bg-slate-50 px-5 py-5">
              <p className="text-sm font-semibold text-slate-900">If Menu Snapshot is UNAVAILABLE</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Review menu-governance readiness because route visibility and navigation projection may be incomplete.
              </p>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
