/*
 * File-Path: frontend/src/components/inputs/LocationSelect.jsx
 * Purpose: Reusable storage location dropdown filtered by company + project.
 *          Loads locations assigned to the given projectCode for the given company.
 * Usage:
 *   <LocationSelect
 *     companyId={companyId}
 *     projectCode="PRJ009"
 *     value={locationId}
 *     onChange={(id) => setLocationId(id)}
 *   />
 */

import { useEffect, useState } from "react";

const BASE = import.meta.env.VITE_API_BASE;

async function readJsonSafe(res) {
  try { return await res.clone().json(); } catch { return null; }
}

// Cache project list for the session so every LocationSelect doesn't refetch
let _projectCache = null;
async function getProjects() {
  if (_projectCache) return _projectCache;
  const res = await fetch(`${BASE}/api/admin/projects`, { credentials: "include" });
  const json = await readJsonSafe(res);
  if (!res.ok || !Array.isArray(json?.data?.projects)) return [];
  _projectCache = json.data.projects;
  return _projectCache;
}

export default function LocationSelect({
  companyId,
  projectCode = "PRJ009",
  value = "",
  onChange,
  disabled = false,
  className = "",
  placeholder = "— select location —",
  size = "sm", // "sm" | "xs"
}) {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!companyId) { setLocations([]); return; }
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const projects = await getProjects();
        const project = projects.find((p) => p.project_code === projectCode);
        if (!project) { if (!cancelled) setLocations([]); return; }

        const params = new URLSearchParams({ company_id: companyId, plant_id: project.id });
        const res = await fetch(`${BASE}/api/om/storage-locations?${params}`, { credentials: "include" });
        const json = await readJsonSafe(res);
        if (!cancelled) {
          const data = json?.data?.data ?? json?.data ?? [];
          setLocations(Array.isArray(data) ? data.filter((l) => l.active) : []);
        }
      } catch {
        if (!cancelled) setLocations([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [companyId, projectCode]);

  const sizeClass = size === "xs"
    ? "h-7 px-2 text-[11px]"
    : "h-8 px-2 text-sm";

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
      disabled={disabled || loading || !companyId}
      className={`w-full border border-slate-300 bg-white text-slate-900 outline-none focus:border-sky-500 disabled:opacity-50 ${sizeClass} ${className}`}
    >
      <option value="">
        {loading ? "Loading locations..." : !companyId ? "— no company —" : placeholder}
      </option>
      {locations.map((loc) => (
        <option key={loc.id} value={loc.id}>
          {loc.code} | {loc.name}
        </option>
      ))}
    </select>
  );
}
