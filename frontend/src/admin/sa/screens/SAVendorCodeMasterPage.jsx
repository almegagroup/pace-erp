/*
 * File-ID: 27.SA-02
 * File-Path: frontend/src/admin/sa/screens/SAVendorCodeMasterPage.jsx
 * Gate: 27.27 | Domain: PRODUCTION / COSTING
 * Purpose: SA-only global Vendor Code master (feasibility §140). A vendor
 *          code is a plain global lookup here -- which companies use it,
 *          which one is Primary, and Prodshade+Stroke overrides are all
 *          decided per company on the Accounts "Company Vendor Code" page
 *          (AC11), not here.
 */

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import { pushToast } from "../../../store/uiToast.js";
import DrawerBase from "../../../components/layer/DrawerBase.jsx";
import { listVendorCodes, createVendorCode, updateVendorCode } from "../../../pages/dashboard/production/prodApi.js";

const ERRORS = {
  VENDOR_CODE_INVALID: "Vendor code is required.",
  VENDOR_CODE_EXISTS: "This vendor code already exists.",
  PROD_SA_REQUIRED: "Super Admin access required.",
};

function friendly(code) {
  return ERRORS[code] ?? code;
}

const EMPTY_FORM = { vendor_code: "", description: "" };

export default function SAVendorCodeMasterPage() {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editRow, setEditRow] = useState(null);
  const [editDraft, setEditDraft] = useState({});

  function toast(message, tone = "success") {
    pushToast({ message, tone });
  }

  const listQ = useQuery({
    queryKey: ["vendor-codes"],
    queryFn: () => listVendorCodes(),
    select: (data) => (Array.isArray(data) ? data : data?.data ?? []),
  });
  const rows = listQ.data ?? [];

  async function handleCreate(event) {
    event.preventDefault();
    if (!form.vendor_code.trim()) {
      toast("Vendor code is required.", "error");
      return;
    }
    setSaving(true);
    try {
      await createVendorCode({ vendor_code: form.vendor_code, description: form.description });
      toast("Vendor code created.");
      setCreateOpen(false);
      setForm({ ...EMPTY_FORM });
      qc.invalidateQueries({ queryKey: ["vendor-codes"] });
    } catch (error) {
      toast(friendly(error.code) || error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  function openEdit(row) {
    setEditRow(row);
    setEditDraft({ description: row.description || "", active: row.active });
  }

  async function handleSaveEdit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await updateVendorCode(editRow.id, { description: editDraft.description, active: editDraft.active });
      toast("Vendor code updated.");
      setEditRow(null);
      qc.invalidateQueries({ queryKey: ["vendor-codes"] });
    } catch (error) {
      toast(friendly(error.code) || error.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ErpScreenScaffold
      title="Vendor Code Master"
      subtitle="SA - global Asian Paints-assigned vendor codes. Company mapping/Primary/overrides happen on the Accounts 'Company Vendor Code' page (AC11)."
      actions={[{
        label: "New Vendor Code",
        tone: "primary",
        mnemonic: "N",
        onClick: () => {
          setForm({ ...EMPTY_FORM });
          setCreateOpen(true);
        },
      }]}
    >
      <ErpSectionCard>
        {listQ.isLoading ? (
          <p className="py-6 text-center text-sm text-slate-400">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            No vendor codes yet. Press <kbd className="rounded border bg-slate-100 px-1 text-xs">Alt+N</kbd> to create.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                <th className="border-b px-3 py-2 text-left">Vendor Code</th>
                <th className="border-b px-3 py-2 text-left">Description</th>
                <th className="border-b px-3 py-2 text-left">Active</th>
                <th className="border-b px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono font-semibold">{row.vendor_code}</td>
                  <td className="px-3 py-2 text-slate-600">{row.description || "-"}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${row.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {row.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => openEdit(row)} className="text-xs text-sky-600 hover:underline">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ErpSectionCard>

      <DrawerBase visible={createOpen} title="New Vendor Code" onClose={() => setCreateOpen(false)}>
        <form onSubmit={handleCreate} className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Vendor Code <span className="text-rose-500">*</span></label>
            <input
              className="rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
              value={form.vendor_code}
              onChange={(event) => setForm((current) => ({ ...current, vendor_code: event.target.value.toUpperCase() }))}
              required
              placeholder="e.g. VC1234"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-600">Description</label>
            <input
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="optional"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="rounded bg-sky-600 px-5 py-2 text-sm text-white hover:bg-sky-700 disabled:opacity-50">Create</button>
            <button type="button" onClick={() => setCreateOpen(false)} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600">Cancel</button>
          </div>
        </form>
      </DrawerBase>

      <DrawerBase visible={!!editRow} title={editRow ? `Edit: ${editRow.vendor_code}` : ""} onClose={() => setEditRow(null)}>
        {editRow && (
          <form onSubmit={handleSaveEdit} className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">Description</label>
              <input
                className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={editDraft.description}
                onChange={(event) => setEditDraft((current) => ({ ...current, description: event.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="vc-active"
                type="checkbox"
                checked={editDraft.active}
                onChange={(event) => setEditDraft((current) => ({ ...current, active: event.target.checked }))}
                className="rounded"
              />
              <label htmlFor="vc-active" className="text-sm text-slate-700">Active</label>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving} className="rounded bg-sky-600 px-5 py-2 text-sm text-white hover:bg-sky-700 disabled:opacity-50">Save Changes</button>
              <button type="button" onClick={() => setEditRow(null)} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600">Cancel</button>
            </div>
          </form>
        )}
      </DrawerBase>
    </ErpScreenScaffold>
  );
}
