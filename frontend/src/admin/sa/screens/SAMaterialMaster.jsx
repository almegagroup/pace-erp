/*
 * File-ID: 15.16
 * File-Path: frontend/src/admin/sa/screens/SAMaterialMaster.jsx
 * Gate: 15 (revised)
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Material Master — Tab 1: SAP-style grid (inline edit, bulk save, CSV import).
 *          Tab 2: Company Mapping (map/unmap, CSV import).
 * Authority: Frontend
 */

import { useCallback, useEffect, useRef, useState } from "react";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  listMaterials,
  bulkSaveMaterials,
  importMaterialsCsv,
  listCompanyMapping,
  bulkMapMaterials,
  bulkUnmapMaterials,
  importCompanyMapping,
  changeMaterialStatus,
  deleteMaterials,
  listCompaniesForOm,
  listUoms,
  listMaterialUomConversions,
  createMaterialUomConversion,
  updateMaterialUomConversion,
} from "../../../pages/dashboard/om/omApi.js";

/* ─── constants ─────────────────────────────────────────────────────────── */
const MATERIAL_TYPES = ["RM", "PM", "INT", "FG", "TRA", "CONS"];
const PAGE_SIZE = 50;

const TYPE_LABEL = {
  RM: "Raw Material",
  PM: "Packaging Material",
  INT: "Intermediate",
  FG: "Finished Good",
  TRA: "Trading",
  CONS: "Consumable",
};

const STATUS_BADGE = {
  DRAFT: "bg-slate-100 text-slate-600",
  PENDING_APPROVAL: "bg-amber-100 text-amber-700",
  ACTIVE: "bg-emerald-100 text-emerald-700",
  INACTIVE: "bg-red-100 text-red-600",
  BLOCKED: "bg-red-200 text-red-800",
};

const ERROR_MESSAGES = {
  OM_MATERIAL_LIST_FAILED: "Failed to load materials.",
  OM_BULK_SAVE_FAILED: "Save failed. Please check the rows and retry.",
  OM_CSV_IMPORT_FAILED: "CSV import failed.",
  OM_CSV_EMPTY: "CSV file is empty.",
  OM_CSV_NO_DATA: "CSV has no data rows.",
  OM_COMPANY_MAPPING_FAILED: "Failed to load company mapping.",
  OM_MATERIAL_MAP_FAILED: "Mapping failed.",
  OM_MATERIAL_UNMAP_FAILED: "Unmap failed.",
  OM_MAPPING_IMPORT_FAILED: "Mapping CSV import failed.",
};

function friendly(code) {
  return ERROR_MESSAGES[code] ?? code;
}

function useUoms() {
  const [uoms, setUoms] = useState([]);
  useEffect(() => {
    listUoms({ is_active: true, limit: 500 })
      .then((result) => {
        if (Array.isArray(result?.data)) setUoms(result.data);
        else if (Array.isArray(result)) setUoms(result);
      })
      .catch(() => {});
  }, []);
  return uoms;
}

function useCompanies() {
  const [companies, setCompanies] = useState([]);
  useEffect(() => {
    listCompaniesForOm()
      .then((result) => {
        if (Array.isArray(result)) setCompanies(result);
      })
      .catch(() => {});
  }, []);
  return companies;
}

/* ══════════════════════════════════════════════════════════════════════════
   TAB 1 — Material Master Grid
══════════════════════════════════════════════════════════════════════════ */

function MaterialMasterTab({ uoms }) {
  /* grid data & pagination */
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filterType, setFilterType] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  /* in-memory edit buffer: { [id]: patchObj } for existing rows */
  const editBufferRef = useRef({});
  /* tracks whether buffer has edits — needed to trigger re-render since ref changes don't */
  const [bufferDirty, setBufferDirty] = useState(false);
  /* new rows buffer: array of draft objects */
  const [newRows, setNewRows] = useState([]);
  /* which existing row is being edited */
  const [editingId, setEditingId] = useState(null);
  /* saving state */
  const [saving, setSaving] = useState(false);
  /* selected rows for status change */
  const [selectedIds, setSelectedIds] = useState(new Set());
  /* CSV import */
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importResults, setImportResults] = useState(null);
  const [importing, setImporting] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async (pg = page) => {
    setLoading(true);
    setError("");
    try {
      const result = await listMaterials({
        material_type: filterType || undefined,
        search: filterSearch || undefined,
        limit: PAGE_SIZE,
        offset: pg * PAGE_SIZE,
      });
      setRows(Array.isArray(result?.data) ? result.data : []);
      setTotal(result?.total ?? 0);
      setPage(pg);
    } catch (e) {
      setError(friendly(e.message));
    } finally {
      setLoading(false);
    }
  }, [filterType, filterSearch, page]);

  useEffect(() => { load(0); }, [filterType]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearchKey(e) {
    if (e.key === "Enter") load(0);
  }

  /* buffer an edit to an existing row */
  function patchBuffer(id, field, value) {
    editBufferRef.current = {
      ...editBufferRef.current,
      [id]: { ...(editBufferRef.current[id] ?? {}), [field]: value },
    };
    setBufferDirty(true);
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  }

  /* new row helpers */
  function addNewRow() {
    setNewRows((prev) => [
      ...prev,
      {
        _key: Date.now(),
        material_type: "RM",
        material_name: "",
        base_uom_code: "",
        purchase_uom_code: "",
        issue_uom_code: "",
        material_category: "",
        external_code: "",
        document_name: "",
        hsn_code: "",
      },
    ]);
  }

  function patchNewRow(key, field, value) {
    setNewRows((prev) =>
      prev.map((r) => (r._key === key ? { ...r, [field]: value } : r))
    );
  }

  function removeNewRow(key) {
    setNewRows((prev) => prev.filter((r) => r._key !== key));
  }

  /* Save all */
  async function handleSave() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const updates = Object.entries(editBufferRef.current).map(([id, patch]) => ({
        id,
        ...patch,
      }));

      const validCreates = newRows.filter(
        (r) => r.material_name.trim() && r.base_uom_code.trim()
      );

      if (updates.length === 0 && validCreates.length === 0) {
        setNotice("Nothing to save.");
        setSaving(false);
        return;
      }

      const result = await bulkSaveMaterials({
        creates: validCreates,
        updates,
      });

      const hasErrors = result?.errors?.length > 0;
      if (hasErrors) {
        const msgs = result.errors
          .map((e) => `Row ${e.index + 1} (${e.context}): ${friendly(e.error)}`)
          .join(" | ");
        setError(msgs);
      } else {
        setNotice(`Saved: ${result?.created?.length ?? 0} created, ${result?.updated?.length ?? 0} updated.`);
      }

      editBufferRef.current = {};
      setBufferDirty(false);
      setNewRows([]);
      setEditingId(null);
      load(page);
    } catch (e) {
      setError(friendly(e.message));
    } finally {
      setSaving(false);
    }
  }

  /* Status change for selected rows */
  async function handleActivate() {
    if (selectedIds.size === 0) return;
    setSaving(true);
    setError("");
    let failed = 0;
    for (const id of selectedIds) {
      try {
        await changeMaterialStatus({ id, new_status: "ACTIVE" });
      } catch {
        failed++;
      }
    }
    setSaving(false);
    setSelectedIds(new Set());
    if (failed > 0) setError(`${failed} row(s) could not be activated.`);
    else setNotice("Selected materials activated.");
    load(page);
  }

  async function handleDeactivate() {
    if (selectedIds.size === 0) return;
    setSaving(true);
    setError("");
    let failed = 0;
    for (const id of selectedIds) {
      try {
        await changeMaterialStatus({ id, new_status: "INACTIVE" });
      } catch {
        failed++;
      }
    }
    setSaving(false);
    setSelectedIds(new Set());
    if (failed > 0) setError(`${failed} row(s) could not be deactivated.`);
    else setNotice("Selected materials deactivated.");
    load(page);
  }

  async function handleDelete() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} material(s)? This cannot be undone.`)) return;
    setSaving(true);
    setError("");
    try {
      const result = await deleteMaterials([...selectedIds]);
      const failedRows = result?.errors ?? [];
      setSelectedIds(new Set());
      if (failedRows.length > 0) {
        setError(`${failedRows.length} material(s) could not be deleted — they may have active transactions or mappings.`);
      } else {
        setNotice(`${result?.deleted?.length ?? 0} material(s) deleted.`);
      }
      load(page);
    } catch (e) {
      setError(friendly(e.message));
    } finally {
      setSaving(false);
    }
  }

  /* CSV import */
  async function handleImport() {
    if (!csvText.trim()) { setError("Paste CSV content first."); return; }
    setImporting(true);
    setError("");
    try {
      const result = await importMaterialsCsv(csvText);
      setImportResults(result?.results ?? []);
      setNotice(`Import done: ${(result?.results ?? []).filter((r) => r.status === "CREATED").length} created.`);
      load(0);
    } catch (e) {
      setError(friendly(e.message));
    } finally {
      setImporting(false);
    }
  }

  function downloadTemplate() {
    const header = "material_type,material_name,base_uom_code,material_category,external_code,document_name,hsn_code";
    const example = "RM,Caustic Soda Flakes,KG,Chemical,,NaOH Flakes,28151100";
    const blob = new Blob([header + "\n" + example], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "material_master_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const toggleSelect = (id) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleSelectAll = () =>
    setSelectedIds((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))
    );

  const hasEdits = bufferDirty || newRows.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="h-8 border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-sky-500"
        >
          <option value="">All Types</option>
          {MATERIAL_TYPES.map((t) => (
            <option key={t} value={t}>{t} — {TYPE_LABEL[t]}</option>
          ))}
        </select>
        <input
          value={filterSearch}
          onChange={(e) => setFilterSearch(e.target.value)}
          onKeyDown={handleSearchKey}
          placeholder="Search name / PACE code / external code…"
          className="h-8 w-64 border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-sky-500"
        />
        <button
          onClick={() => load(0)}
          className="h-8 border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
        >
          Search
        </button>
        <div className="flex-1" />
        <button
          onClick={addNewRow}
          className="h-8 border border-sky-500 bg-sky-500 px-3 text-sm text-white hover:bg-sky-600"
        >
          + Add Row
        </button>
        <button
          onClick={() => setShowImport((v) => !v)}
          className="h-8 border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
        >
          CSV Import
        </button>
        {selectedIds.size > 0 && (
          <>
            <button
              onClick={handleActivate}
              disabled={saving}
              className="h-8 border border-emerald-500 bg-emerald-500 px-3 text-sm text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              Activate ({selectedIds.size})
            </button>
            <button
              onClick={handleDeactivate}
              disabled={saving}
              className="h-8 border border-amber-500 bg-amber-500 px-3 text-sm text-white hover:bg-amber-600 disabled:opacity-50"
            >
              Deactivate ({selectedIds.size})
            </button>
            <button
              onClick={handleDelete}
              disabled={saving}
              className="h-8 border border-red-500 bg-red-500 px-3 text-sm text-white hover:bg-red-600 disabled:opacity-50"
            >
              Delete ({selectedIds.size})
            </button>
          </>
        )}
        {hasEdits && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="h-8 border border-sky-600 bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save All"}
          </button>
        )}
      </div>

      {/* Notices */}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {notice && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>
      )}

      {/* CSV Import panel */}
      {showImport && (
        <div className="rounded border border-slate-200 bg-slate-50 p-4">
          <div className="mb-2 flex items-center gap-3">
            <span className="text-sm font-medium text-slate-700">CSV Bulk Import</span>
            <button
              onClick={downloadTemplate}
              className="text-xs text-sky-600 underline"
            >
              Download Template
            </button>
          </div>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={6}
            placeholder="Paste CSV content here (with header row)…"
            className="w-full border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-800 outline-none focus:border-sky-500"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleImport}
              disabled={importing}
              className="h-8 border border-sky-600 bg-sky-600 px-4 text-sm text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {importing ? "Importing…" : "Import"}
            </button>
            <button
              onClick={() => { setShowImport(false); setImportResults(null); setCsvText(""); }}
              className="h-8 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-100"
            >
              Close
            </button>
          </div>
          {importResults && (
            <div className="mt-3 max-h-48 overflow-y-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-600">
                    <th className="border border-slate-200 px-2 py-1 text-left">Row</th>
                    <th className="border border-slate-200 px-2 py-1 text-left">Material Name</th>
                    <th className="border border-slate-200 px-2 py-1 text-left">PACE Code</th>
                    <th className="border border-slate-200 px-2 py-1 text-left">Status</th>
                    <th className="border border-slate-200 px-2 py-1 text-left">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {importResults.map((r) => (
                    <tr key={r.row} className={r.status === "CREATED" ? "bg-emerald-50" : r.status === "DUPLICATE" ? "bg-amber-50" : "bg-red-50"}>
                      <td className="border border-slate-200 px-2 py-1">{r.row}</td>
                      <td className="border border-slate-200 px-2 py-1">{r.material_name}</td>
                      <td className="border border-slate-200 px-2 py-1 font-mono">{r.pace_code ?? "—"}</td>
                      <td className="border border-slate-200 px-2 py-1">{r.status}</td>
                      <td className="border border-slate-200 px-2 py-1 text-red-600">{r.error ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Grid */}
      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100">
            <tr>
              <th className="w-8 border-b border-slate-300 px-2 py-1.5">
                <input
                  type="checkbox"
                  checked={selectedIds.size === rows.length && rows.length > 0}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="border-b border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-600">PACE Code</th>
              <th className="border-b border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-600">Type</th>
              <th className="border-b border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-600">Material Name *</th>
              <th className="border-b border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-600">Document Name</th>
              <th className="border-b border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-600">Category</th>
              <th className="border-b border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-600">Base UOM *</th>
              <th className="border-b border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-600">Alt UOM 1</th>
              <th className="border-b border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-600">Alt UOM 2</th>
              <th className="border-b border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-600">External Code</th>
              <th className="border-b border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-600">HSN Code</th>
              <th className="border-b border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-600">Status</th>
              <th className="w-8 border-b border-slate-300 px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {/* New (unsaved) rows at top */}
            {newRows.map((nr) => (
              <NewRow
                key={nr._key}
                row={nr}
                onPatch={(f, v) => patchNewRow(nr._key, f, v)}
                onRemove={() => removeNewRow(nr._key)}
                uoms={uoms}
              />
            ))}

            {/* Existing rows */}
            {loading ? (
              <tr>
                <td colSpan={13} className="px-3 py-6 text-center text-sm text-slate-400">Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-3 py-6 text-center text-sm text-slate-400">No materials found.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <ExistingRow
                  key={row.id}
                  row={row}
                  isEditing={editingId === row.id}
                  isSelected={selectedIds.has(row.id)}
                  onToggleSelect={() => toggleSelect(row.id)}
                  onActivateEdit={() => setEditingId(row.id)}
                  onPatch={(f, v) => patchBuffer(row.id, f, v)}
                  onDoneEdit={() => setEditingId(null)}
                  uoms={uoms}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <button
            onClick={() => load(page - 1)}
            disabled={page === 0 || loading}
            className="h-7 border border-slate-300 px-2 text-xs disabled:opacity-40"
          >
            ← Prev
          </button>
          <span>Page {page + 1} of {totalPages} ({total} total)</span>
          <button
            onClick={() => load(page + 1)}
            disabled={page >= totalPages - 1 || loading}
            className="h-7 border border-slate-300 px-2 text-xs disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

/* ── New Row (unsaved) ───────────────────────────────────────────────────── */

function NewRow({ row, onPatch, onRemove, uoms }) {
  const cellCls = "border-b border-slate-200 bg-[#fffef0] px-1 py-0.5";
  const inputCls = "h-7 w-full border border-sky-300 bg-white px-1.5 text-xs text-slate-900 outline-none focus:border-sky-500";
  const selectCls = "h-7 w-full border border-sky-300 bg-white px-1 text-xs text-slate-900 outline-none";

  return (
    <tr className="bg-amber-50">
      <td className={cellCls + " w-8"} />
      <td className={cellCls + " font-mono text-xs text-slate-400"}>—</td>
      <td className={cellCls}>
        <select
          value={row.material_type}
          onChange={(e) => onPatch("material_type", e.target.value)}
          className={selectCls}
        >
          {MATERIAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td className={cellCls}>
        <input
          value={row.material_name}
          onChange={(e) => onPatch("material_name", e.target.value)}
          placeholder="Required"
          className={inputCls}
        />
      </td>
      <td className={cellCls}>
        <input
          value={row.document_name}
          onChange={(e) => onPatch("document_name", e.target.value)}
          className={inputCls}
        />
      </td>
      <td className={cellCls}>
        <input
          value={row.material_category}
          onChange={(e) => onPatch("material_category", e.target.value)}
          className={inputCls}
        />
      </td>
      <td className={cellCls}>
        <select
          value={row.base_uom_code}
          onChange={(e) => onPatch("base_uom_code", e.target.value)}
          className={selectCls}
        >
          <option value="">— UOM —</option>
          {uoms.map((u) => (
            <option key={u.code} value={u.code}>{u.code} | {u.name}</option>
          ))}
        </select>
      </td>
      <td className={cellCls}>
        <select
          value={row.purchase_uom_code}
          onChange={(e) => onPatch("purchase_uom_code", e.target.value)}
          className={selectCls}
        >
          <option value="">—</option>
          {uoms.map((u) => (
            <option key={u.code} value={u.code}>{u.code}</option>
          ))}
        </select>
      </td>
      <td className={cellCls}>
        <select
          value={row.issue_uom_code}
          onChange={(e) => onPatch("issue_uom_code", e.target.value)}
          className={selectCls}
        >
          <option value="">—</option>
          {uoms.map((u) => (
            <option key={u.code} value={u.code}>{u.code}</option>
          ))}
        </select>
      </td>
      <td className={cellCls}>
        <input
          value={row.external_code}
          onChange={(e) => onPatch("external_code", e.target.value)}
          className={inputCls}
        />
      </td>
      <td className={cellCls}>
        <input
          value={row.hsn_code}
          onChange={(e) => onPatch("hsn_code", e.target.value)}
          className={inputCls}
        />
      </td>
      <td className={cellCls + " text-xs text-amber-600"}>NEW</td>
      <td className={cellCls + " w-8"}>
        <button
          onClick={onRemove}
          className="text-red-400 hover:text-red-600"
          title="Remove row"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

/* ── Existing Row ────────────────────────────────────────────────────────── */

function ExistingRow({ row, isEditing, isSelected, onToggleSelect, onActivateEdit, onPatch, onDoneEdit, uoms }) {
  const cellCls = "border-b border-slate-200 px-2 py-1";
  const inputCls = "h-7 w-full border border-sky-300 bg-[#fffef7] px-1.5 text-xs text-slate-900 outline-none focus:border-sky-500";
  const readCls = "text-xs text-slate-800";

  function CellInput({ field, value }) {
    return (
      <input
        defaultValue={value ?? ""}
        onBlur={(e) => {
          const v = e.target.value;
          if (v !== (value ?? "")) onPatch(field, v);
        }}
        className={inputCls}
      />
    );
  }

  return (
    <tr
      className={isSelected ? "bg-sky-50" : isEditing ? "bg-[#fffef7]" : "hover:bg-slate-50"}
      onClick={() => { if (!isEditing) onActivateEdit(); }}
    >
      <td className={cellCls + " w-8"} onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
        />
      </td>
      <td className={cellCls + " font-mono text-xs text-slate-500"}>{row.pace_code ?? "—"}</td>
      <td className={cellCls}>
        {isEditing ? (
          <select
            defaultValue={row.material_type}
            onChange={(e) => onPatch("material_type", e.target.value)}
            className="h-7 w-full border border-sky-300 bg-white px-1 text-xs text-slate-900 outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            {MATERIAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        ) : (
          <span className={readCls}>{row.material_type}</span>
        )}
      </td>
      <td className={cellCls}>
        {isEditing ? (
          <CellInput field="material_name" value={row.material_name} />
        ) : (
          <span className={readCls + " font-medium"}>{row.material_name}</span>
        )}
      </td>
      <td className={cellCls}>
        {isEditing ? (
          <CellInput field="document_name" value={row.document_name} />
        ) : (
          <span className={readCls + " text-slate-500"}>{row.document_name ?? "—"}</span>
        )}
      </td>
      <td className={cellCls}>
        {isEditing ? (
          <CellInput field="material_category" value={row.material_category} />
        ) : (
          <span className={readCls}>{row.material_category ?? "—"}</span>
        )}
      </td>
      <td className={cellCls}>
        {isEditing ? (
          <select
            defaultValue={row.base_uom_code}
            onChange={(e) => onPatch("base_uom_code", e.target.value)}
            className="h-7 w-full border border-sky-300 bg-white px-1 text-xs text-slate-900 outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <option value="">— UOM —</option>
            {uoms.map((u) => (
              <option key={u.code} value={u.code}>{u.code} | {u.name}</option>
            ))}
          </select>
        ) : (
          <span className={readCls + " font-mono"}>{row.base_uom_code}</span>
        )}
      </td>
      <td className={cellCls}>
        {isEditing ? (
          <select
            defaultValue={row.purchase_uom_code ?? ""}
            onChange={(e) => onPatch("purchase_uom_code", e.target.value || null)}
            className="h-7 w-full border border-sky-300 bg-white px-1 text-xs text-slate-900 outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <option value="">—</option>
            {uoms.map((u) => (
              <option key={u.code} value={u.code}>{u.code}</option>
            ))}
          </select>
        ) : (
          <span className={readCls + " font-mono"}>{row.purchase_uom_code ?? "—"}</span>
        )}
      </td>
      <td className={cellCls}>
        {isEditing ? (
          <select
            defaultValue={row.issue_uom_code ?? ""}
            onChange={(e) => onPatch("issue_uom_code", e.target.value || null)}
            className="h-7 w-full border border-sky-300 bg-white px-1 text-xs text-slate-900 outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <option value="">—</option>
            {uoms.map((u) => (
              <option key={u.code} value={u.code}>{u.code}</option>
            ))}
          </select>
        ) : (
          <span className={readCls + " font-mono"}>{row.issue_uom_code ?? "—"}</span>
        )}
      </td>
      <td className={cellCls}>
        {isEditing ? (
          <CellInput field="external_code" value={row.external_code} />
        ) : (
          <span className={readCls + " text-slate-500"}>{row.external_code ?? "—"}</span>
        )}
      </td>
      <td className={cellCls}>
        {isEditing ? (
          <CellInput field="hsn_code" value={row.hsn_code} />
        ) : (
          <span className={readCls}>{row.hsn_code ?? "—"}</span>
        )}
      </td>
      <td className={cellCls}>
        <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_BADGE[row.status] ?? "bg-slate-100 text-slate-600"}`}>
          {row.status}
        </span>
      </td>
      <td className={cellCls + " w-8"} onClick={(e) => e.stopPropagation()}>
        {isEditing && (
          <button
            onClick={onDoneEdit}
            className="text-xs text-sky-500 hover:text-sky-700"
            title="Done editing"
          >
            ✓
          </button>
        )}
      </td>
    </tr>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TAB 2 — UOM Conversions
══════════════════════════════════════════════════════════════════════════ */

const CONV_PAGE_SIZE = 50;

function UomConversionsTab({ uoms }) {
  const [materials, setMaterials] = useState([]);
  const [conversions, setConversions] = useState({}); // map: material_id → [conversion rows]
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState({}); // map: material_id → bool
  const [factors, setFactors] = useState({}); // map: `${material_id}_alt1` or `_alt2` → string value
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const uomMap = Object.fromEntries(uoms.map((u) => [u.code, u.name]));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await listMaterials({
        material_type: typeFilter || undefined,
        search: search || undefined,
        limit: CONV_PAGE_SIZE,
        offset: (page - 1) * CONV_PAGE_SIZE,
      });
      const rows = Array.isArray(result?.data) ? result.data : [];
      setMaterials(rows);
      setTotal(Number(result?.total ?? 0));

      // load conversions for all materials with alt UOM set
      const withAlt = rows.filter((m) => m.purchase_uom_code || m.issue_uom_code);
      if (withAlt.length > 0) {
        const results = await Promise.all(
          withAlt.map((m) => listMaterialUomConversions(m.id).then((r) => ({ id: m.id, data: r?.data ?? [] })))
        );
        const convMap = {};
        const factMap = {};
        results.forEach(({ id, data }) => {
          convMap[id] = data;
          const mat = rows.find((m) => m.id === id);
          if (!mat) return;
          data.forEach((row) => {
            if (mat.purchase_uom_code && row.from_uom_code === mat.purchase_uom_code) {
              factMap[`${id}_alt1`] = String(row.conversion_factor);
            }
            if (mat.issue_uom_code && row.from_uom_code === mat.issue_uom_code) {
              factMap[`${id}_alt2`] = String(row.conversion_factor);
            }
          });
        });
        setConversions(convMap);
        setFactors((prev) => ({ ...prev, ...factMap }));
      } else {
        setConversions({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "OM_MATERIAL_LIST_FAILED");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, search, page]);

  useEffect(() => { void load(); }, [load]);

  function getConvRow(materialId, fromUom) {
    return (conversions[materialId] ?? []).find((r) => r.from_uom_code === fromUom) ?? null;
  }

  async function saveConversion(mat, altKey) {
    const fromUom = altKey === "alt1" ? mat.purchase_uom_code : mat.issue_uom_code;
    const toUom = altKey === "alt1" ? mat.base_uom_code : mat.purchase_uom_code;
    const factorStr = factors[`${mat.id}_${altKey}`] ?? "";
    const factor = parseFloat(factorStr);
    if (!fromUom || !toUom || !factor || factor <= 0) {
      setError("Factor must be a positive number.");
      return;
    }
    const existing = getConvRow(mat.id, fromUom);
    setSaving((prev) => ({ ...prev, [`${mat.id}_${altKey}`]: true }));
    setError("");
    setNotice("");
    try {
      if (existing) {
        await updateMaterialUomConversion({ id: existing.id, conversion_factor: factor });
      } else {
        await createMaterialUomConversion({
          material_id: mat.id,
          from_uom_code: fromUom,
          to_uom_code: toUom,
          conversion_factor: factor,
        });
      }
      setNotice(`${mat.pace_code} — ${fromUom} conversion saved.`);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "OM_UOM_CONVERSION_CREATE_FAILED");
    } finally {
      setSaving((prev) => ({ ...prev, [`${mat.id}_${altKey}`]: false }));
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / CONV_PAGE_SIZE));

  return (
    <div className="grid gap-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="h-8 border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
        >
          <option value="">All Types</option>
          {MATERIAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          placeholder="Search PACE code or name..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="h-8 border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500 w-64"
        />
        <button
          type="button"
          onClick={() => void load()}
          className="h-8 border border-slate-300 bg-white px-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-700"
        >
          Refresh
        </button>
      </div>

      {/* Notices */}
      {error && <div className="border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
      {notice && <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</div>}

      {/* Grid */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <th className="px-3 py-2 font-semibold text-slate-600">PACE Code</th>
              <th className="px-3 py-2 font-semibold text-slate-600">Name</th>
              <th className="px-3 py-2 font-semibold text-slate-600">Type</th>
              <th className="px-3 py-2 font-semibold text-slate-600">Base UOM</th>
              <th className="px-3 py-2 font-semibold text-slate-600">Alt UOM 1</th>
              <th className="px-3 py-2 font-semibold text-slate-600">1 Alt1 = ? Base</th>
              <th className="px-3 py-2 font-semibold text-slate-600"></th>
              <th className="px-3 py-2 font-semibold text-slate-600">Alt UOM 2</th>
              <th className="px-3 py-2 font-semibold text-slate-600">1 Alt2 = ? Alt1</th>
              <th className="px-3 py-2 font-semibold text-slate-600"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">Loading materials...</td></tr>
            ) : materials.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">No materials matched the filter.</td></tr>
            ) : materials.map((mat) => {
              const alt1 = mat.purchase_uom_code;
              const alt2 = mat.issue_uom_code;
              const conv1 = alt1 ? getConvRow(mat.id, alt1) : null;
              const conv2 = alt2 ? getConvRow(mat.id, alt2) : null;
              const isSaving1 = saving[`${mat.id}_alt1`] ?? false;
              const isSaving2 = saving[`${mat.id}_alt2`] ?? false;
              const factor1 = factors[`${mat.id}_alt1`] ?? (conv1 ? String(conv1.conversion_factor) : "");
              const factor2 = factors[`${mat.id}_alt2`] ?? (conv2 ? String(conv2.conversion_factor) : "");

              return (
                <tr key={mat.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-slate-700">{mat.pace_code}</td>
                  <td className="px-3 py-2 text-slate-800">{mat.material_name}</td>
                  <td className="px-3 py-2 text-slate-500">{mat.material_type}</td>
                  <td className="px-3 py-2 text-slate-700">
                    <span title={uomMap[mat.base_uom_code]}>{mat.base_uom_code}</span>
                  </td>

                  {/* Alt UOM 1 */}
                  <td className="px-3 py-2 text-slate-700">
                    {alt1 ? <span title={uomMap[alt1]}>{alt1}</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {alt1 ? (
                      <input
                        type="number"
                        min="0.0001"
                        step="any"
                        value={factor1}
                        onChange={(e) => setFactors((prev) => ({ ...prev, [`${mat.id}_alt1`]: e.target.value }))}
                        className="h-7 w-24 border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
                        placeholder="e.g. 32"
                      />
                    ) : <span className="text-slate-200">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {alt1 ? (
                      <button
                        type="button"
                        onClick={() => void saveConversion(mat, "alt1")}
                        disabled={isSaving1 || !factor1}
                        className="h-7 border border-sky-300 bg-sky-50 px-2 text-xs font-semibold text-sky-700 disabled:opacity-40"
                      >
                        {conv1 ? (isSaving1 ? "..." : "Update") : (isSaving1 ? "..." : "Save")}
                      </button>
                    ) : null}
                  </td>

                  {/* Alt UOM 2 */}
                  <td className="px-3 py-2 text-slate-700">
                    {alt2 ? <span title={uomMap[alt2]}>{alt2}</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {alt2 ? (
                      <input
                        type="number"
                        min="0.0001"
                        step="any"
                        value={factor2}
                        onChange={(e) => setFactors((prev) => ({ ...prev, [`${mat.id}_alt2`]: e.target.value }))}
                        className="h-7 w-24 border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
                        placeholder="e.g. 4"
                      />
                    ) : <span className="text-slate-200">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {alt2 ? (
                      <button
                        type="button"
                        onClick={() => void saveConversion(mat, "alt2")}
                        disabled={isSaving2 || !alt1 || !factor2}
                        className="h-7 border border-sky-300 bg-sky-50 px-2 text-xs font-semibold text-sky-700 disabled:opacity-40"
                        title={!alt1 ? "Alt UOM 1 must be set before saving Alt UOM 2 conversion" : ""}
                      >
                        {conv2 ? (isSaving2 ? "..." : "Update") : (isSaving2 ? "..." : "Save")}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="border border-slate-300 bg-white px-2 py-1 disabled:opacity-40">Prev</button>
          <span>Page {page} / {totalPages} ({total} materials)</span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="border border-slate-300 bg-white px-2 py-1 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TAB 3 — Company Mapping
══════════════════════════════════════════════════════════════════════════ */

function CompanyMappingTab() {
  const companies = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [mappingData, setMappingData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedMapped, setSelectedMapped] = useState(new Set());
  const [selectedUnmapped, setSelectedUnmapped] = useState(new Set());

  /* CSV import */
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importResults, setImportResults] = useState(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async (companyId, q) => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    try {
      const result = await listCompanyMapping({ company_id: companyId, search: q || undefined });
      setMappingData(Array.isArray(result?.data) ? result.data : []);
    } catch (e) {
      setError(friendly(e.message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCompanyId) load(selectedCompanyId, search);
  }, [selectedCompanyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const mapped = mappingData.filter((m) => m.is_mapped);
  const unmapped = mappingData.filter((m) => !m.is_mapped);
  const filteredMapped = search
    ? mapped.filter((m) => m.material_name?.toLowerCase().includes(search.toLowerCase()) || m.pace_code?.toLowerCase().includes(search.toLowerCase()))
    : mapped;
  const filteredUnmapped = search
    ? unmapped.filter((m) => m.material_name?.toLowerCase().includes(search.toLowerCase()) || m.pace_code?.toLowerCase().includes(search.toLowerCase()))
    : unmapped;

  async function handleMap() {
    if (!selectedCompanyId || selectedUnmapped.size === 0) return;
    setSaving(true);
    setError("");
    try {
      await bulkMapMaterials({ company_id: selectedCompanyId, material_ids: [...selectedUnmapped] });
      setSelectedUnmapped(new Set());
      setNotice(`${selectedUnmapped.size} material(s) mapped.`);
      load(selectedCompanyId, search);
    } catch (e) {
      setError(friendly(e.message));
    } finally {
      setSaving(false);
    }
  }

  async function handleUnmap() {
    if (!selectedCompanyId || selectedMapped.size === 0) return;
    setSaving(true);
    setError("");
    try {
      await bulkUnmapMaterials({ company_id: selectedCompanyId, material_ids: [...selectedMapped] });
      setSelectedMapped(new Set());
      setNotice(`${selectedMapped.size} material(s) unmapped.`);
      load(selectedCompanyId, search);
    } catch (e) {
      setError(friendly(e.message));
    } finally {
      setSaving(false);
    }
  }

  async function handleMapAll() {
    if (!selectedCompanyId || unmapped.length === 0) return;
    setSaving(true);
    setError("");
    try {
      await bulkMapMaterials({ company_id: selectedCompanyId, material_ids: unmapped.map((m) => m.id) });
      setNotice(`${unmapped.length} material(s) mapped.`);
      load(selectedCompanyId, search);
    } catch (e) {
      setError(friendly(e.message));
    } finally {
      setSaving(false);
    }
  }

  async function handleImport() {
    if (!csvText.trim()) { setError("Paste CSV content first."); return; }
    setImporting(true);
    setError("");
    try {
      const result = await importCompanyMapping(csvText);
      setImportResults(result?.results ?? []);
      const mapped_count = (result?.results ?? []).filter((r) => r.status === "MAPPED").length;
      setNotice(`Import done: ${mapped_count} mapped.`);
      if (selectedCompanyId) load(selectedCompanyId, search);
    } catch (e) {
      setError(friendly(e.message));
    } finally {
      setImporting(false);
    }
  }

  function downloadMappingTemplate() {
    const header = "material_name,company_code";
    const example = "Caustic Soda Flakes,CMP001";
    const blob = new Blob([header + "\n" + example], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "company_mapping_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const toggleMapped = (id) => setSelectedMapped((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleUnmapped = (id) => setSelectedUnmapped((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAllMapped = () =>
    setSelectedMapped((prev) =>
      prev.size === filteredMapped.length ? new Set() : new Set(filteredMapped.map((m) => m.id))
    );

  const toggleAllUnmapped = () =>
    setSelectedUnmapped((prev) =>
      prev.size === filteredUnmapped.length ? new Set() : new Set(filteredUnmapped.map((m) => m.id))
    );

  return (
    <div className="flex flex-col gap-4">
      {/* Company selector + search */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selectedCompanyId}
          onChange={(e) => { setSelectedCompanyId(e.target.value); setSelectedMapped(new Set()); setSelectedUnmapped(new Set()); }}
          className="h-8 border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-sky-500"
        >
          <option value="">— Select Company —</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.company_code} — {c.company_name}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") load(selectedCompanyId, search); }}
          placeholder="Filter by name or PACE code…"
          className="h-8 w-64 border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-sky-500"
        />
        <button
          onClick={() => load(selectedCompanyId, search)}
          disabled={!selectedCompanyId}
          className="h-8 border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Filter
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setShowImport((v) => !v)}
          className="h-8 border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
        >
          CSV Import
        </button>
      </div>

      {/* Notices */}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {notice && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>
      )}

      {/* CSV Import panel */}
      {showImport && (
        <div className="rounded border border-slate-200 bg-slate-50 p-4">
          <div className="mb-2 flex items-center gap-3">
            <span className="text-sm font-medium text-slate-700">CSV Mapping Import</span>
            <button onClick={downloadMappingTemplate} className="text-xs text-sky-600 underline">
              Download Template
            </button>
            <span className="text-xs text-slate-500">Columns: material_name, company_code</span>
          </div>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={5}
            placeholder="material_name,company_code&#10;Caustic Soda Flakes,CMP001"
            className="w-full border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-800 outline-none focus:border-sky-500"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleImport}
              disabled={importing}
              className="h-8 border border-sky-600 bg-sky-600 px-4 text-sm text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {importing ? "Importing…" : "Import"}
            </button>
            <button
              onClick={() => { setShowImport(false); setImportResults(null); setCsvText(""); }}
              className="h-8 border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-100"
            >
              Close
            </button>
          </div>
          {importResults && (
            <div className="mt-3 max-h-40 overflow-y-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-600">
                    <th className="border border-slate-200 px-2 py-1 text-left">Row</th>
                    <th className="border border-slate-200 px-2 py-1 text-left">Material</th>
                    <th className="border border-slate-200 px-2 py-1 text-left">Company</th>
                    <th className="border border-slate-200 px-2 py-1 text-left">Status</th>
                    <th className="border border-slate-200 px-2 py-1 text-left">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {importResults.map((r) => (
                    <tr key={r.row} className={r.status === "MAPPED" ? "bg-emerald-50" : "bg-red-50"}>
                      <td className="border border-slate-200 px-2 py-1">{r.row}</td>
                      <td className="border border-slate-200 px-2 py-1">{r.material_name}</td>
                      <td className="border border-slate-200 px-2 py-1">{r.company_name ?? r.company_code}</td>
                      <td className="border border-slate-200 px-2 py-1">{r.status}</td>
                      <td className="border border-slate-200 px-2 py-1 text-red-600">{r.error ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Two-column mapping view */}
      {selectedCompanyId && (
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3">
          {/* Mapped (left) */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                Mapped ({filteredMapped.length})
              </span>
              {selectedMapped.size > 0 && (
                <button
                  onClick={handleUnmap}
                  disabled={saving}
                  className="rounded border border-red-400 bg-red-50 px-2 py-0.5 text-xs text-red-600 hover:bg-red-100 disabled:opacity-40"
                >
                  Unmap ({selectedMapped.size})
                </button>
              )}
            </div>
            <MappingList
              rows={filteredMapped}
              selected={selectedMapped}
              onToggle={toggleMapped}
              onToggleAll={toggleAllMapped}
              loading={loading}
            />
          </div>

          {/* Center controls */}
          <div className="flex flex-col items-center justify-center gap-2 pt-6">
            <button
              onClick={handleMap}
              disabled={saving || selectedUnmapped.size === 0}
              title="Map selected"
              className="h-8 w-8 border border-sky-400 bg-sky-50 text-sky-600 hover:bg-sky-100 disabled:opacity-40"
            >
              ←
            </button>
            <button
              onClick={handleMapAll}
              disabled={saving || unmapped.length === 0}
              title="Map all"
              className="h-8 w-8 border border-sky-400 bg-sky-50 text-xs text-sky-600 hover:bg-sky-100 disabled:opacity-40"
            >
              ←←
            </button>
          </div>

          {/* Unmapped (right) */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                Not Mapped ({filteredUnmapped.length})
              </span>
              {selectedUnmapped.size > 0 && (
                <button
                  onClick={handleMap}
                  disabled={saving}
                  className="rounded border border-sky-400 bg-sky-50 px-2 py-0.5 text-xs text-sky-600 hover:bg-sky-100 disabled:opacity-40"
                >
                  Map ({selectedUnmapped.size})
                </button>
              )}
            </div>
            <MappingList
              rows={filteredUnmapped}
              selected={selectedUnmapped}
              onToggle={toggleUnmapped}
              onToggleAll={toggleAllUnmapped}
              loading={loading}
            />
          </div>
        </div>
      )}

      {!selectedCompanyId && (
        <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
          Select a company to manage material mappings.
        </div>
      )}
    </div>
  );
}

function MappingList({ rows, selected, onToggle, onToggleAll, loading }) {
  return (
    <div className="max-h-[calc(100vh-360px)] overflow-y-auto rounded border border-slate-200 bg-white">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-slate-100">
          <tr>
            <th className="w-8 border-b border-slate-200 px-2 py-1">
              <input
                type="checkbox"
                checked={rows.length > 0 && selected.size === rows.length}
                onChange={onToggleAll}
              />
            </th>
            <th className="border-b border-slate-200 px-2 py-1 text-left font-semibold text-slate-600">PACE</th>
            <th className="border-b border-slate-200 px-2 py-1 text-left font-semibold text-slate-600">Material Name</th>
            <th className="border-b border-slate-200 px-2 py-1 text-left font-semibold text-slate-600">Type</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">Loading…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">—</td></tr>
          ) : rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => onToggle(r.id)}
              className={`cursor-pointer ${selected.has(r.id) ? "bg-sky-50" : "hover:bg-slate-50"}`}
            >
              <td className="border-b border-slate-100 px-2 py-1">
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => onToggle(r.id)} onClick={(e) => e.stopPropagation()} />
              </td>
              <td className="border-b border-slate-100 px-2 py-1 font-mono text-slate-500">{r.pace_code ?? "—"}</td>
              <td className="border-b border-slate-100 px-2 py-1 font-medium text-slate-800">{r.material_name}</td>
              <td className="border-b border-slate-100 px-2 py-1 text-slate-500">{r.material_type}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ROOT PAGE
══════════════════════════════════════════════════════════════════════════ */

const TABS = [
  { key: "master", label: "Material Master" },
  { key: "conversions", label: "UOM Conversions" },
  { key: "mapping", label: "Company Mapping" },
];

export default function SAMaterialMaster() {
  const [activeTab, setActiveTab] = useState("master");
  const uoms = useUoms();

  return (
    <ErpScreenScaffold eyebrow="SA — Operation Management" title="Material Master">
      {/* Tab bar */}
      <div className="mb-4 flex border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "border-b-2 border-sky-500 text-sky-600"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <ErpSectionCard>
        {activeTab === "master" && <MaterialMasterTab uoms={uoms} />}
        {activeTab === "conversions" && <UomConversionsTab uoms={uoms} />}
        {activeTab === "mapping" && <CompanyMappingTab />}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
