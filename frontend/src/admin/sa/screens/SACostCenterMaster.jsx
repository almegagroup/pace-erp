/*
 * File-ID: 12B.7
 * File-Path: frontend/src/admin/sa/screens/SACostCenterMaster.jsx
 * Gate: 12B
 * Phase: 12B
 * Domain: MASTER
 * Purpose: SA screen - Cost Center master list, inline edit, active toggle, create.
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";

const BASE = import.meta.env.VITE_API_BASE ?? "";
import {
  createCostCenter,
  listCostCenters,
  toggleCostCenter,
  updateCostCenter,
} from "../../../pages/dashboard/om/omApi.js";

const ERROR_LABELS = {
  OM_CC_LIST_FAILED:    "Failed to load cost centers.",
  OM_CC_CREATE_FAILED:  "Could not create cost center. Check required fields.",
  OM_CC_UPDATE_FAILED:  "Could not save changes.",
  OM_CC_TOGGLE_FAILED:  "Could not change active status.",
  OM_CC_EXISTS:         "A cost center with this code already exists.",
  COMPANY_LIST_FAILED:  "Failed to load company list.",
};

function label(code) {
  return ERROR_LABELS[code] || code;
}

async function fetchAdminList(path, dataKey, fallback) {
  try {
    const res = await fetch(`${BASE}${path}`, { credentials: "include" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.code ?? fallback);
    return json?.data?.[dataKey] ?? json?.[dataKey] ?? [];
  } catch {
    return [];
  }
}

export default function SACostCenterMaster() {
  const [rows, setRows]             = useState([]);
  const [companies, setCompanies]   = useState([]);
  const [filterCompany, setFilterCompany] = useState("");
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState("");
  const [notice, setNotice]         = useState("");

  // inline edit
  const [editId, setEditId]         = useState(null);
  const [editDraft, setEditDraft]   = useState({});

  // create form
  const [form, setForm]             = useState({
    company_id: "",
    cost_center_code: "",
    cost_center_name: "",
    description: "",
  });

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [ccResult, companyList] = await Promise.all([
        listCostCenters(),
        fetchAdminList("/api/admin/companies", "companies", "COMPANY_LIST_FAILED"),
      ]);
      setRows(Array.isArray(ccResult?.data) ? ccResult.data : Array.isArray(ccResult) ? ccResult : []);
      setCompanies(Array.isArray(companyList) ? companyList : []);
    } catch (e) {
      setError(label(e instanceof Error ? e.message : "OM_CC_LIST_FAILED"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadData(); }, []);

  // ── inline edit ──────────────────────────────────────────────
  function startEdit(row) {
    setEditId(row.id);
    setEditDraft({ cost_center_name: row.cost_center_name, description: row.description || "" });
    setError("");
    setNotice("");
  }

  function cancelEdit() {
    setEditId(null);
    setEditDraft({});
  }

  async function saveEdit(row) {
    if (!editDraft.cost_center_name?.trim()) {
      setError("Cost center name is required.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await updateCostCenter({
        id: row.id,
        cost_center_name: editDraft.cost_center_name.trim(),
        description: editDraft.description.trim() || null,
      });
      setNotice("Cost center updated.");
      setEditId(null);
      setEditDraft({});
      await loadData();
    } catch (e) {
      setError(label(e instanceof Error ? e.message : "OM_CC_UPDATE_FAILED"));
    } finally {
      setSaving(false);
    }
  }

  // ── toggle ────────────────────────────────────────────────────
  async function handleToggle(row) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await toggleCostCenter({ id: row.id, active: !row.active });
      setNotice(`Cost center ${!row.active ? "activated" : "deactivated"}.`);
      await loadData();
    } catch (e) {
      setError(label(e instanceof Error ? e.message : "OM_CC_TOGGLE_FAILED"));
    } finally {
      setSaving(false);
    }
  }

  // ── create ────────────────────────────────────────────────────
  async function handleCreate() {
    if (!form.company_id || !form.cost_center_code.trim() || !form.cost_center_name.trim()) {
      setError("Company, code, and name are required.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createCostCenter({
        company_id: form.company_id,
        cost_center_code: form.cost_center_code.trim().toUpperCase(),
        cost_center_name: form.cost_center_name.trim(),
        description: form.description.trim() || null,
      });
      setForm({ company_id: form.company_id, cost_center_code: "", cost_center_name: "", description: "" });
      setNotice("Cost center created.");
      await loadData();
    } catch (e) {
      setError(label(e instanceof Error ? e.message : "OM_CC_CREATE_FAILED"));
    } finally {
      setSaving(false);
    }
  }

  const companyMap = new Map(companies.map((c) => [c.id, c]));
  const displayRows = filterCompany
    ? rows.filter((r) => r.company_id === filterCompany)
    : rows;

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin — Operation Management"
      title="Cost Center Master"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadData(), disabled: loading },
      ]}
      notices={[
        ...(error  ? [{ key: "error",  tone: "error",   message: label(error)  }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_360px]">
        {/* ── Left: list ── */}
        <ErpSectionCard eyebrow="Cost Center Register" title="All cost centers">
          {/* company filter */}
          <div className="mb-3 flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600 whitespace-nowrap">Filter by Company</label>
            <select
              value={filterCompany}
              onChange={(e) => setFilterCompany(e.target.value)}
              className="h-8 border border-slate-300 bg-white px-2 text-sm outline-none focus:border-sky-500"
            >
              <option value="">— All Companies —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.company_code} | {c.company_name}</option>
              ))}
            </select>
          </div>

          <div className="overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Company</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Code</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Name</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Description</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">Loading...</td></tr>
                )}
                {!loading && displayRows.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-400">No cost centers found.</td></tr>
                )}
                {displayRows.map((row) => {
                  const isEditing = editId === row.id;
                  const comp = companyMap.get(row.company_id);
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-slate-100 transition-colors ${isEditing ? "bg-sky-50" : "hover:bg-slate-50 cursor-pointer"}`}
                      onClick={() => { if (!isEditing) startEdit(row); }}
                    >
                      <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                        {comp ? `${comp.company_code}` : row.company_id?.slice(0, 8) || "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-900 whitespace-nowrap">{row.cost_center_code}</td>
                      <td className="px-3 py-2 text-slate-900">
                        {isEditing ? (
                          <input
                            autoFocus
                            value={editDraft.cost_center_name}
                            onChange={(e) => setEditDraft((d) => ({ ...d, cost_center_name: e.target.value }))}
                            onClick={(e) => e.stopPropagation()}
                            className="h-7 w-full border border-sky-400 bg-white px-2 text-sm outline-none"
                          />
                        ) : (
                          row.cost_center_name
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {isEditing ? (
                          <input
                            value={editDraft.description}
                            onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                            onClick={(e) => e.stopPropagation()}
                            className="h-7 w-full border border-sky-400 bg-white px-2 text-sm outline-none"
                          />
                        ) : (
                          row.description || "—"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${row.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>
                          {row.active ? "ACTIVE" : "INACTIVE"}
                        </span>
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        {isEditing ? (
                          <div className="flex gap-1">
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void saveEdit(row)}
                              className="border border-sky-600 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-900 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void handleToggle(row)}
                            className={`border px-2 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                              row.active
                                ? "border-rose-300 bg-rose-50 text-rose-800"
                                : "border-emerald-400 bg-emerald-50 text-emerald-900"
                            }`}
                          >
                            {row.active ? "Deactivate" : "Activate"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ErpSectionCard>

        {/* ── Right: create form ── */}
        <ErpSectionCard eyebrow="Create Cost Center" title="New cost center">
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Company <span className="text-rose-500">*</span>
              <select
                value={form.company_id}
                onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value }))}
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              >
                <option value="">— select company —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.company_code} | {c.company_name}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Cost Center Code <span className="text-rose-500">*</span>
              <input
                value={form.cost_center_code}
                onChange={(e) => setForm((f) => ({ ...f, cost_center_code: e.target.value.toUpperCase() }))}
                placeholder="e.g. PROD_CMP001"
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>

            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Cost Center Name <span className="text-rose-500">*</span>
              <input
                value={form.cost_center_name}
                onChange={(e) => setForm((f) => ({ ...f, cost_center_name: e.target.value }))}
                placeholder="e.g. Production — CMP001"
                className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm outline-none focus:border-sky-500"
              />
            </label>

            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Description
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className="border border-slate-300 bg-[#fffef7] px-2 py-1.5 text-sm outline-none focus:border-sky-500"
              />
            </label>

            <button
              type="button"
              disabled={saving}
              onClick={() => void handleCreate()}
              className="mt-1 border border-sky-700 bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create Cost Center"}
            </button>
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
