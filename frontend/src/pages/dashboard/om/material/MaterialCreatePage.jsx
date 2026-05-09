/*
 * File-ID: 15.3
 * File-Path: frontend/src/pages/dashboard/om/material/MaterialCreatePage.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render the material creation form with UOM lookup.
 * Authority: Frontend
 */

import { useEffect, useState } from "react";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpEntryFormTemplate from "../../../../components/templates/ErpEntryFormTemplate.jsx";
import { openScreen, popScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { createMaterial, listUoms } from "../omApi.js";

export default function MaterialCreatePage() {
  const [uoms, setUoms] = useState([]);
  const [form, setForm] = useState({
    material_type: "RM",
    material_name: "",
    base_uom_code: "",
    hsn_code: "",
    description: "",
    is_batch_managed: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    async function loadUoms() {
      setLoading(true);
      setError("");
      try {
        const result = await listUoms({ is_active: true });
        if (active) {
          setUoms(Array.isArray(result?.data) ? result.data : []);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "OM_UOM_LIST_FAILED");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void loadUoms();
    return () => {
      active = false;
    };
  }, []);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.material_name.trim() || !form.base_uom_code) {
      setError("OM_INVALID_MATERIAL_INPUT");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await createMaterial({
        material_type: form.material_type,
        material_name: form.material_name.trim(),
        base_uom_code: form.base_uom_code,
        hsn_code: form.hsn_code.trim() || undefined,
        description: form.description.trim() || undefined,
        is_batch_managed: form.is_batch_managed,
      });
      setNotice("Material created.");
      openScreen(OPERATION_SCREENS.OM_MATERIAL_LIST.screen_code, { mode: "replace" });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "OM_MATERIAL_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpEntryFormTemplate
      eyebrow="Operation Management"
      title="Create Material"
      actions={[
        { key: "back", label: "Back", tone: "neutral", onClick: () => popScreen() },
        { key: "save", label: saving ? "Saving..." : "Save Material", tone: "primary", onClick: () => void handleSubmit(), disabled: saving || loading },
      ]}
      notices={[
        ...(error ? [{ key: "error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "notice", tone: "success", message: notice }] : []),
      ]}
      formEyebrow="Material Setup"
      formTitle="Create a new material master row"
      formContent={
        loading ? (
          <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Loading UOM options...
          </div>
        ) : (
          <div className="grid gap-3">
            <ErpDenseFormRow label="Material Type" required>
              <select
                value={form.material_type}
                onChange={(event) => updateField("material_type", event.target.value)}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                {["RM", "PM", "INT", "FG", "TRA", "CONS"].map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Material Name" required>
              <input
                value={form.material_name}
                onChange={(event) => updateField("material_name", event.target.value)}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Base UOM" required>
              <select
                value={form.base_uom_code}
                onChange={(event) => updateField("base_uom_code", event.target.value)}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">Select UOM</option>
                {uoms.map((entry) => (
                  <option key={entry.id || entry.code} value={entry.code}>
                    {entry.code} | {entry.name}
                  </option>
                ))}
              </select>
            </ErpDenseFormRow>
            <ErpDenseFormRow label="HSN Code">
              <input
                value={form.hsn_code}
                onChange={(event) => updateField("hsn_code", event.target.value)}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Description">
              <textarea
                rows={4}
                value={form.description}
                onChange={(event) => updateField("description", event.target.value)}
                className="w-full border border-slate-300 bg-[#fffef7] px-2 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Batch Managed">
              <label className="flex h-8 items-center gap-2 text-sm text-slate-900">
                <input
                  type="checkbox"
                  checked={form.is_batch_managed}
                  onChange={(event) => updateField("is_batch_managed", event.target.checked)}
                />
                Track batches for this material
              </label>
            </ErpDenseFormRow>
          </div>
        )
      }
    />
  );
}
