/*
 * File-ID: 15.10
 * File-Path: frontend/src/pages/dashboard/om/asl/AslDetailPage.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render approved source list detail, edit, and status workflows.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpScreenScaffold, { ErpFieldPreview, ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { getActiveScreenContext, popScreen } from "../../../../navigation/screenStackEngine.js";
import {
  changeVendorMaterialInfoStatus,
  getVendorMaterialInfo,
  listUoms,
  updateVendorMaterialInfo,
} from "../omApi.js";

const ASL_TRANSITIONS = {
  DRAFT: ["PENDING_APPROVAL"],
  PENDING_APPROVAL: ["ACTIVE", "DRAFT"],
  ACTIVE: ["INACTIVE", "BLOCKED"],
  INACTIVE: ["ACTIVE"],
  BLOCKED: ["ACTIVE"],
};

export default function AslDetailPage() {
  const [searchParams] = useSearchParams();
  const context = useMemo(() => getActiveScreenContext() ?? {}, []);
  const searchId = searchParams.get("id");
  const id = searchId || context.id || "";
  const [record, setRecord] = useState(null);
  const [uoms, setUoms] = useState([]);
  const [form, setForm] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!searchId && context.id) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?id=${encodeURIComponent(context.id)}`);
    }
  }, [context.id, searchId]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!id) {
        setError("OM_VMI_NOT_FOUND");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const [recordResult, uomResult] = await Promise.all([
          getVendorMaterialInfo(id),
          listUoms({ is_active: true }),
        ]);
        if (!active) {
          return;
        }
        const row = recordResult?.data ?? null;
        setRecord(row);
        setUoms(Array.isArray(uomResult?.data) ? uomResult.data : []);
        setForm({
          vendor_material_code: row?.vendor_material_code ?? "",
          pack_size_description: row?.pack_size_description ?? "",
          lead_time_days: row?.lead_time_days ?? "",
          po_uom_code: row?.po_uom_code ?? "",
          conversion_factor: row?.conversion_factor ?? 1,
        });
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "OM_VMI_LOOKUP_FAILED");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [id]);

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    if (!record?.id || !form) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await updateVendorMaterialInfo({
        id: record.id,
        vendor_material_code: form.vendor_material_code,
        pack_size_description: form.pack_size_description,
        lead_time_days: form.lead_time_days ? Number(form.lead_time_days) : null,
        po_uom_code: form.po_uom_code,
        conversion_factor: Number(form.conversion_factor),
      });
      setRecord(result?.data ?? record);
      setEditMode(false);
      setNotice("ASL row updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_VMI_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  const allowedTargets = ASL_TRANSITIONS[String(record?.status || "").toUpperCase()] ?? [];

  async function handleStatusChange(newStatus) {
    if (!record?.id) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await changeVendorMaterialInfoStatus({
        id: record.id,
        new_status: newStatus,
      });
      setRecord(result?.data ?? record);
      setNotice(`ASL row moved to ${newStatus}.`);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "OM_VMI_STATUS_UPDATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      eyebrow="Operation Management"
      title="Approved Source Detail"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "edit", label: editMode ? "Cancel Edit" : "Edit", tone: "neutral", onClick: () => setEditMode((current) => !current), disabled: loading || !record },
        { key: "save", label: saving ? "Saving..." : "Save", tone: "primary", onClick: () => void handleSave(), disabled: saving || !editMode },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
    >
      {loading || !record || !form ? (
        <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {loading ? "Loading approved source detail..." : "Approved source detail is unavailable."}
        </div>
      ) : (
        <div className="grid gap-4">
          <ErpSectionCard eyebrow="Header" title={`${record.vendor_id} | ${record.material_id}`}>
            <div className="grid gap-3 md:grid-cols-4">
              <ErpFieldPreview label="Status" value={record.status} tone="sky" />
              <ErpFieldPreview label="PO UOM" value={record.po_uom_code} />
              <ErpFieldPreview label="Factor" value={String(record.conversion_factor ?? "-")} />
              <ErpFieldPreview label="Lead Time Days" value={String(record.lead_time_days ?? "-")} />
            </div>
          </ErpSectionCard>

          <ErpSectionCard eyebrow="View Or Edit" title="Approved source fields">
            {editMode ? (
              <div className="grid gap-3">
                <ErpDenseFormRow label="Vendor Material Code">
                  <input
                    value={form.vendor_material_code}
                    onChange={(event) => setField("vendor_material_code", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Pack Size Description">
                  <input
                    value={form.pack_size_description}
                    onChange={(event) => setField("pack_size_description", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="PO UOM">
                  <select
                    value={form.po_uom_code}
                    onChange={(event) => setField("po_uom_code", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  >
                    {uoms.map((entry) => (
                      <option key={entry.id || entry.code} value={entry.code}>
                        {entry.code} | {entry.name}
                      </option>
                    ))}
                  </select>
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Conversion Factor">
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    value={form.conversion_factor}
                    onChange={(event) => setField("conversion_factor", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
                <ErpDenseFormRow label="Lead Time Days">
                  <input
                    type="number"
                    min="0"
                    value={form.lead_time_days}
                    onChange={(event) => setField("lead_time_days", event.target.value)}
                    className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                  />
                </ErpDenseFormRow>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <ErpFieldPreview label="Vendor Material Code" value={record.vendor_material_code} />
                <ErpFieldPreview label="Pack Description" value={record.pack_size_description} />
                <ErpFieldPreview label="PO UOM" value={record.po_uom_code} />
                <ErpFieldPreview label="Conversion Factor" value={String(record.conversion_factor ?? "-")} />
              </div>
            )}
          </ErpSectionCard>

          <ErpSectionCard eyebrow="Lifecycle" title="Status actions">
            <div className="flex flex-wrap gap-2">
              {allowedTargets.length === 0 ? (
                <div className="text-sm text-slate-500">No status change is allowed from the current state.</div>
              ) : (
                allowedTargets.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => void handleStatusChange(entry)}
                    disabled={saving}
                    className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-900"
                  >
                    Move To {entry}
                  </button>
                ))
              )}
            </div>
          </ErpSectionCard>
        </div>
      )}
    </ErpScreenScaffold>
  );
}
