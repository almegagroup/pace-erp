/*
 * File-ID: 15.14
 * File-Path: frontend/src/admin/sa/screens/SAOmUomMaster.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render the SA-only UOM master list and inline create form.
 * Authority: Frontend
 */

import { useEffect, useRef, useState } from "react";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { createUom, listUoms, toggleUom } from "../../../pages/dashboard/om/omApi.js";

const ERROR_MESSAGES = {
  OM_INVALID_UOM_CODE:  "UOM code is required and must be 1–10 alphanumeric characters.",
  OM_INVALID_UOM_TYPE:  "UOM name and type are required.",
  OM_UOM_EXISTS:        "A UOM with this code already exists.",
  OM_UOM_NOT_FOUND:     "UOM not found.",
  OM_SA_REQUIRED:       "Super Admin access required.",
  OM_ADMIN_REQUIRED:    "Admin access required.",
  OM_UOM_CREATE_FAILED: "Failed to create UOM. Please try again.",
  OM_UOM_TOGGLE_FAILED: "Failed to update UOM status. Please try again.",
  OM_UOM_LIST_FAILED:   "Failed to load UOM list. Please refresh.",
};

function friendlyError(code) {
  return ERROR_MESSAGES[code] ?? code;
}

export default function SAOmUomMaster() {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ uom_code: "", uom_name: "", uom_type: "COUNT" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(null); // holds uom code being toggled
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef(null);

  function showNotice(msg) {
    setNotice(msg);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 4000);
  }

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const result = await listUoms({});
      setRows(Array.isArray(result?.data) ? result.data : []);
    } catch (loadError) {
      setRows([]);
      setError(friendlyError(loadError instanceof Error ? loadError.message : "OM_UOM_LIST_FAILED"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
    return () => clearTimeout(noticeTimer.current);
  }, []);

  async function handleCreate() {
    if (!form.uom_code.trim() || !form.uom_name.trim() || !form.uom_type) {
      setError(friendlyError("OM_INVALID_UOM_CODE"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createUom({
        uom_code: form.uom_code.trim().toUpperCase(),
        uom_name: form.uom_name.trim(),
        uom_type: form.uom_type,
      });
      setForm({ uom_code: "", uom_name: "", uom_type: "COUNT" });
      showNotice("UOM created successfully.");
      await loadRows();
    } catch (saveError) {
      setError(friendlyError(saveError instanceof Error ? saveError.message : "OM_UOM_CREATE_FAILED"));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(row) {
    setToggling(row.code);
    setError("");
    try {
      await toggleUom({ code: row.code, active: !row.active });
      showNotice(`UOM "${row.code}" ${!row.active ? "activated" : "deactivated"}.`);
      await loadRows();
    } catch (toggleError) {
      setError(friendlyError(toggleError instanceof Error ? toggleError.message : "OM_UOM_TOGGLE_FAILED"));
    } finally {
      setToggling(null);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Super Admin Operation Management"
      title="UOM Master"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => void loadRows() },
        { key: "create", label: saving ? "Creating..." : "Create UOM", tone: "primary", onClick: () => void handleCreate(), disabled: saving },
      ]}
      notices={[
        ...(error  ? [{ key: "error",  tone: "error",   message: error  }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <ErpSectionCard eyebrow="UOM Register" title="All units of measure">
          <ErpDenseGrid
            columns={[
              { key: "code",     label: "Code" },
              { key: "name",     label: "Name" },
              { key: "uom_type", label: "Type" },
              {
                key: "active",
                label: "Active",
                render: (row) => (row.active ? "YES" : "NO"),
              },
              {
                key: "_toggle",
                label: "",
                render: (row) => (
                  <button
                    onClick={() => void handleToggle(row)}
                    disabled={toggling === row.code}
                    className={`px-2 py-0.5 text-xs font-medium rounded ${
                      row.active
                        ? "bg-red-50 text-red-600 hover:bg-red-100"
                        : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    } disabled:opacity-50`}
                  >
                    {toggling === row.code ? "..." : row.active ? "Deactivate" : "Activate"}
                  </button>
                ),
              },
            ]}
            rows={rows}
            rowKey={(row) => row.id || row.code}
            emptyMessage={loading ? "Loading UOM rows..." : "No UOM rows are available."}
            maxHeight="420px"
          />
        </ErpSectionCard>

        <ErpSectionCard eyebrow="Create UOM" title="New unit of measure">
          <div className="grid gap-3">
            <ErpDenseFormRow label="UOM Code" required>
              <input
                value={form.uom_code}
                onChange={(e) => setForm((f) => ({ ...f, uom_code: e.target.value.toUpperCase() }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                placeholder="e.g. KG"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="UOM Name" required>
              <input
                value={form.uom_name}
                onChange={(e) => setForm((f) => ({ ...f, uom_name: e.target.value }))}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                placeholder="e.g. Kilogram"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="UOM Type" required>
              <select
                value={form.uom_type}
                onChange={(e) => setForm((f) => ({ ...f, uom_type: e.target.value }))}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="COUNT">COUNT</option>
                <option value="WEIGHT">WEIGHT</option>
                <option value="VOLUME">VOLUME</option>
                <option value="LENGTH">LENGTH</option>
                <option value="PACKING">PACKING</option>
              </select>
            </ErpDenseFormRow>
          </div>
        </ErpSectionCard>
      </div>
    </ErpScreenScaffold>
  );
}
