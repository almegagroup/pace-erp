/*
 * File-ID: 15.17
 * File-Path: frontend/src/admin/sa/screens/SAVendorMaster.jsx
 * Gate: 15 (revised)
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Vendor Master — Tab 1: Domestic vendors, Tab 2: Import vendors (both with right-panel detail),
 *          Tab 3: Company Mapping.
 * Authority: Frontend
 */

import { useCallback, useEffect, useRef, useState } from "react";
import ErpScreenScaffold, { ErpSectionCard } from "../../../components/templates/ErpScreenScaffold.jsx";
import {
  listVendors,
  createVendor,
  updateVendor,
  changeVendorStatus,
  deleteVendors,
  getVendor,
  upsertVendorContacts,
  upsertVendorEmails,
  listVendorCompanyMapping,
  bulkMapVendors,
  bulkUnmapVendors,
  listCompaniesForOm,
} from "../../../pages/dashboard/om/omApi.js";

/* ─── Currency options ───────────────────────────────────────────────────── */
const CURRENCY_OPTIONS = [
  { country: "Bangladesh",    name: "Taka",                code: "BDT" },
  { country: "India",         name: "Rupee",               code: "INR" },
  { country: "USA",           name: "US Dollar",           code: "USD" },
  { country: "Euro Zone",     name: "Euro",                code: "EUR" },
  { country: "China",         name: "Yuan Renminbi",       code: "CNY" },
  { country: "UAE",           name: "Dirham",              code: "AED" },
  { country: "UK",            name: "Pound Sterling",      code: "GBP" },
  { country: "Singapore",     name: "Singapore Dollar",    code: "SGD" },
  { country: "Japan",         name: "Yen",                 code: "JPY" },
  { country: "South Korea",   name: "Won",                 code: "KRW" },
  { country: "Thailand",      name: "Baht",                code: "THB" },
  { country: "Malaysia",      name: "Ringgit",             code: "MYR" },
  { country: "Australia",     name: "Australian Dollar",   code: "AUD" },
  { country: "Canada",        name: "Canadian Dollar",     code: "CAD" },
  { country: "Switzerland",   name: "Swiss Franc",         code: "CHF" },
  { country: "Turkey",        name: "Turkish Lira",        code: "TRY" },
  { country: "Saudi Arabia",  name: "Saudi Riyal",         code: "SAR" },
  { country: "Indonesia",     name: "Rupiah",              code: "IDR" },
  { country: "Vietnam",       name: "Dong",                code: "VND" },
];

const STATUS_BADGE = {
  DRAFT: "bg-slate-100 text-slate-600",
  PENDING_APPROVAL: "bg-amber-100 text-amber-700",
  ACTIVE: "bg-emerald-100 text-emerald-700",
  INACTIVE: "bg-red-100 text-red-600",
  BLOCKED: "bg-red-200 text-red-800",
};

const PAGE_SIZE = 50;

function friendly(code) {
  const map = {
    OM_VENDOR_LIST_FAILED: "Failed to load vendors.",
    OM_VENDOR_CREATE_FAILED: "Create failed.",
    OM_VENDOR_UPDATE_FAILED: "Update failed.",
    OM_VENDOR_DELETE_FAILED: "Delete failed.",
    OM_VENDOR_HAS_DEPENDENCIES: "Vendor has linked transactions, cannot delete.",
    OM_VENDOR_CONTACTS_FAILED: "Contacts save failed.",
    OM_VENDOR_EMAILS_FAILED: "Emails save failed.",
  };
  return map[code] ?? code ?? "Unexpected error.";
}

function useCompanies() {
  const [companies, setCompanies] = useState([]);
  useEffect(() => {
    listCompaniesForOm().then((r) => { if (Array.isArray(r)) setCompanies(r); }).catch(() => {});
  }, []);
  return companies;
}

/* ══════════════════════════════════════════════════════════════════════════
   RIGHT PANEL — Vendor Detail / Create
══════════════════════════════════════════════════════════════════════════ */

const BLANK_VENDOR = {
  vendor_name: "",
  bin_number: "",
  tin_number: "",
  trade_license: "",
  gst_number: "",
  gst_category: "",
  iec_code: "",
  import_license: "",
  country_code: "",
  currency_code: "BDT",
  registered_address: "",
  correspondence_address: "",
  bank_name: "",
  bank_branch: "",
  bank_account_number: "",
  bank_routing_number: "",
};

function blankContact() {
  return { _key: Date.now() + Math.random(), contact_name: "", phone: "", designation: "", is_primary: false };
}

function blankEmail() {
  return { _key: Date.now() + Math.random(), email: "", label: "", is_primary: false };
}

function VendorPanel({ vendorType, initialVendor, onClose, onSaved }) {
  const isCreate = !initialVendor?.id;
  const [fields, setFields] = useState(() => initialVendor ? { ...BLANK_VENDOR, ...initialVendor } : { ...BLANK_VENDOR });
  const [contacts, setContacts] = useState(initialVendor?.contacts ?? []);
  const [emails, setEmails] = useState(initialVendor?.emails ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function patchField(key, value) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function patchContact(key, field, value) {
    setContacts((prev) => prev.map((c) => (c._key ?? c.id) === key ? { ...c, [field]: value } : c));
  }

  function removeContact(key) {
    setContacts((prev) => prev.filter((c) => (c._key ?? c.id) !== key));
  }

  function addContact() {
    setContacts((prev) => [...prev, blankContact()]);
  }

  function patchEmail(key, field, value) {
    setEmails((prev) => prev.map((e) => (e._key ?? e.id) === key ? { ...e, [field]: value } : e));
  }

  function removeEmail(key) {
    setEmails((prev) => prev.filter((e) => (e._key ?? e.id) !== key));
  }

  function addEmail() {
    setEmails((prev) => [...prev, blankEmail()]);
  }

  async function handleSave() {
    if (!fields.vendor_name.trim()) { setError("Vendor name is required."); return; }
    setSaving(true);
    setError("");
    try {
      let vendorId = initialVendor?.id;

      if (isCreate) {
        const result = await createVendor({ ...fields, vendor_type: vendorType });
        if (!result?.data?.id) throw new Error(result?.code ?? "OM_VENDOR_CREATE_FAILED");
        vendorId = result.data.id;
      } else {
        await updateVendor({ id: vendorId, ...fields });
      }

      await Promise.all([
        upsertVendorContacts({ vendor_id: vendorId, contacts }),
        upsertVendorEmails({ vendor_id: vendorId, emails }),
      ]);

      onSaved();
      onClose();
    } catch (e) {
      setError(friendly(e.message));
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500";
  const labelCls = "mb-0.5 block text-xs font-medium text-slate-600";

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div className="flex h-full w-[480px] flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <div className="text-xs font-medium text-slate-500">
              {vendorType === "DOMESTIC" ? "Domestic Vendor" : "Import Vendor"}
            </div>
            <div className="text-base font-semibold text-slate-800">
              {isCreate ? "New Vendor" : (initialVendor?.vendor_name ?? "Edit Vendor")}
            </div>
            {!isCreate && (
              <div className="font-mono text-xs text-slate-400">{initialVendor?.vendor_code}</div>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {error && (
            <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          )}

          {/* Basic Info */}
          <Section title="Basic Information">
            <Field label="Vendor Name *">
              <input value={fields.vendor_name} onChange={(e) => patchField("vendor_name", e.target.value)} className={inputCls} placeholder="Required" />
            </Field>
            {vendorType === "DOMESTIC" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="BIN Number">
                    <input value={fields.bin_number} onChange={(e) => patchField("bin_number", e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="TIN Number">
                    <input value={fields.tin_number} onChange={(e) => patchField("tin_number", e.target.value)} className={inputCls} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Trade License">
                    <input value={fields.trade_license} onChange={(e) => patchField("trade_license", e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="GST Number">
                    <input value={fields.gst_number} onChange={(e) => patchField("gst_number", e.target.value)} className={inputCls} />
                  </Field>
                </div>
                <Field label="GST Category">
                  <select value={fields.gst_category} onChange={(e) => patchField("gst_category", e.target.value)} className={inputCls}>
                    <option value="">— Select —</option>
                    <option value="REGISTERED">Registered</option>
                    <option value="UNREGISTERED">Unregistered</option>
                    <option value="COMPOSITION">Composition</option>
                    <option value="EXPORT">Export</option>
                  </select>
                </Field>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="IEC Code">
                    <input value={fields.iec_code} onChange={(e) => patchField("iec_code", e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="Import License">
                    <input value={fields.import_license} onChange={(e) => patchField("import_license", e.target.value)} className={inputCls} />
                  </Field>
                </div>
                <Field label="Country">
                  <select value={fields.country_code} onChange={(e) => patchField("country_code", e.target.value)} className={inputCls}>
                    <option value="">— Select Country —</option>
                    {CURRENCY_OPTIONS.map((c) => (
                      <option key={c.code} value={c.country}>{c.country}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Currency">
                  <select value={fields.currency_code} onChange={(e) => patchField("currency_code", e.target.value)} className={inputCls}>
                    <option value="">— Select Currency —</option>
                    {CURRENCY_OPTIONS.map((c) => (
                      <option key={c.code} value={c.code}>{c.country} — {c.name} ({c.code})</option>
                    ))}
                  </select>
                </Field>
              </>
            )}
          </Section>

          {/* Address */}
          <Section title="Address">
            <Field label="Registered Address">
              <textarea
                value={fields.registered_address}
                onChange={(e) => patchField("registered_address", e.target.value)}
                rows={2}
                className="w-full border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </Field>
            <Field label="Correspondence Address">
              <textarea
                value={fields.correspondence_address}
                onChange={(e) => patchField("correspondence_address", e.target.value)}
                rows={2}
                className="w-full border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </Field>
          </Section>

          {/* Banking */}
          <Section title="Banking">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bank Name">
                <input value={fields.bank_name} onChange={(e) => patchField("bank_name", e.target.value)} className={inputCls} />
              </Field>
              <Field label="Branch">
                <input value={fields.bank_branch} onChange={(e) => patchField("bank_branch", e.target.value)} className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Account Number">
                <input value={fields.bank_account_number} onChange={(e) => patchField("bank_account_number", e.target.value)} className={inputCls} />
              </Field>
              <Field label="Routing Number">
                <input value={fields.bank_routing_number} onChange={(e) => patchField("bank_routing_number", e.target.value)} className={inputCls} />
              </Field>
            </div>
          </Section>

          {/* Contacts */}
          <Section title="Contacts" action={<button onClick={addContact} className="text-xs text-sky-600 hover:text-sky-800">+ Add</button>}>
            {contacts.length === 0 && (
              <p className="text-xs text-slate-400">No contacts. Click + Add to add one.</p>
            )}
            {contacts.map((c) => {
              const key = c._key ?? c.id;
              return (
                <div key={key} className="mb-2 rounded border border-slate-200 bg-slate-50 p-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className={labelCls}>Name *</div>
                      <input value={c.contact_name} onChange={(e) => patchContact(key, "contact_name", e.target.value)} className="h-7 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                    </div>
                    <div>
                      <div className={labelCls}>Phone</div>
                      <input value={c.phone ?? ""} onChange={(e) => patchContact(key, "phone", e.target.value)} className="h-7 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-3">
                    <div className="flex-1">
                      <div className={labelCls}>Designation</div>
                      <input value={c.designation ?? ""} onChange={(e) => patchContact(key, "designation", e.target.value)} className="h-7 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                    </div>
                    <label className="flex items-center gap-1 text-xs text-slate-600 mt-4">
                      <input type="checkbox" checked={Boolean(c.is_primary)} onChange={(e) => patchContact(key, "is_primary", e.target.checked)} />
                      Primary
                    </label>
                    <button onClick={() => removeContact(key)} className="mt-4 text-red-400 hover:text-red-600 text-xs">Remove</button>
                  </div>
                </div>
              );
            })}
          </Section>

          {/* Emails */}
          <Section title="Email Addresses" action={<button onClick={addEmail} className="text-xs text-sky-600 hover:text-sky-800">+ Add</button>}>
            {emails.length === 0 && (
              <p className="text-xs text-slate-400">No emails. Click + Add to add one.</p>
            )}
            {emails.map((e) => {
              const key = e._key ?? e.id;
              return (
                <div key={key} className="mb-2 flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <div className="flex-1">
                    <input value={e.email} onChange={(ev) => patchEmail(key, "email", ev.target.value)} placeholder="email@example.com" className="h-7 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                  </div>
                  <div className="w-28">
                    <input value={e.label ?? ""} onChange={(ev) => patchEmail(key, "label", ev.target.value)} placeholder="Label (e.g. PO)" className="h-7 w-full border border-slate-300 bg-white px-2 text-xs text-slate-900 outline-none focus:border-sky-500" />
                  </div>
                  <label className="flex items-center gap-1 text-xs text-slate-600">
                    <input type="checkbox" checked={Boolean(e.is_primary)} onChange={(ev) => patchEmail(key, "is_primary", ev.target.checked)} />
                    Primary
                  </label>
                  <button onClick={() => removeEmail(key)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                </div>
              );
            })}
          </Section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button onClick={onClose} className="h-8 border border-slate-300 px-4 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="h-8 border border-sky-600 bg-sky-600 px-5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : (isCreate ? "Create Vendor" : "Save Changes")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, action }) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between border-b border-slate-100 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</span>
        {action}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium text-slate-600">{label}</div>
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TAB 1 / 2 — Vendor Grid (Domestic or Import)
══════════════════════════════════════════════════════════════════════════ */

function VendorGridTab({ vendorType }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [panel, setPanel] = useState(null); // null | { mode: "create" | "edit", vendor: object | null }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async (pg = 0, q = search) => {
    setLoading(true);
    setError("");
    try {
      const result = await listVendors({
        vendor_type: vendorType,
        search: q || undefined,
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
  }, [vendorType, search]);

  useEffect(() => { load(0); }, [vendorType]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openEditPanel(vendor) {
    try {
      const result = await getVendor(vendor.id);
      setPanel({ mode: "edit", vendor: result?.data ?? vendor });
    } catch {
      setPanel({ mode: "edit", vendor });
    }
  }

  async function handleActivate() {
    if (selectedIds.size === 0) return;
    setSaving(true); setError("");
    let failed = 0;
    for (const id of selectedIds) {
      try { await changeVendorStatus({ id, new_status: "ACTIVE" }); }
      catch { failed++; }
    }
    setSaving(false);
    setSelectedIds(new Set());
    if (failed > 0) setError(`${failed} vendor(s) could not be activated.`);
    else setNotice("Selected vendors activated.");
    load(page);
  }

  async function handleDeactivate() {
    if (selectedIds.size === 0) return;
    setSaving(true); setError("");
    let failed = 0;
    for (const id of selectedIds) {
      try { await changeVendorStatus({ id, new_status: "INACTIVE" }); }
      catch { failed++; }
    }
    setSaving(false);
    setSelectedIds(new Set());
    if (failed > 0) setError(`${failed} vendor(s) could not be deactivated.`);
    else setNotice("Selected vendors deactivated.");
    load(page);
  }

  async function handleDelete() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} vendor(s)? This cannot be undone.`)) return;
    setSaving(true); setError("");
    try {
      const result = await deleteVendors([...selectedIds]);
      const failedRows = result?.errors ?? [];
      setSelectedIds(new Set());
      if (failedRows.length > 0) {
        setError(`${failedRows.length} vendor(s) could not be deleted — they may have active transactions.`);
      } else {
        setNotice(`${result?.deleted?.length ?? 0} vendor(s) deleted.`);
      }
      load(page);
    } catch (e) {
      setError(friendly(e.message));
    } finally {
      setSaving(false);
    }
  }

  const toggleSelect = (id) =>
    setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const toggleSelectAll = () =>
    setSelectedIds((prev) => prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)));

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") load(0, search); }}
          placeholder="Search vendor name / code…"
          className="h-8 w-64 border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-sky-500"
        />
        <button onClick={() => load(0, search)} className="h-8 border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50">Search</button>
        <div className="flex-1" />
        <button
          onClick={() => setPanel({ mode: "create", vendor: null })}
          className="h-8 border border-sky-500 bg-sky-500 px-3 text-sm text-white hover:bg-sky-600"
        >
          + New Vendor
        </button>
        {selectedIds.size > 0 && (
          <>
            <button onClick={handleActivate} disabled={saving} className="h-8 border border-emerald-500 bg-emerald-500 px-3 text-sm text-white hover:bg-emerald-600 disabled:opacity-50">
              Activate ({selectedIds.size})
            </button>
            <button onClick={handleDeactivate} disabled={saving} className="h-8 border border-amber-500 bg-amber-500 px-3 text-sm text-white hover:bg-amber-600 disabled:opacity-50">
              Deactivate ({selectedIds.size})
            </button>
            <button onClick={handleDelete} disabled={saving} className="h-8 border border-red-500 bg-red-500 px-3 text-sm text-white hover:bg-red-600 disabled:opacity-50">
              Delete ({selectedIds.size})
            </button>
          </>
        )}
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}

      {/* Grid */}
      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100">
            <tr>
              <th className="w-8 border-b border-slate-300 px-2 py-1.5">
                <input type="checkbox" checked={selectedIds.size === rows.length && rows.length > 0} onChange={toggleSelectAll} />
              </th>
              <th className="border-b border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-600">Vendor Code</th>
              <th className="border-b border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-600">Vendor Name</th>
              {vendorType === "DOMESTIC" ? (
                <>
                  <th className="border-b border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-600">BIN</th>
                  <th className="border-b border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-600">GST</th>
                </>
              ) : (
                <>
                  <th className="border-b border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-600">Country</th>
                  <th className="border-b border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-600">Currency</th>
                </>
              )}
              <th className="border-b border-slate-300 px-2 py-1.5 text-left text-xs font-semibold text-slate-600">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-slate-400">No vendors found.</td></tr>
            ) : rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => openEditPanel(row)}
                className={`cursor-pointer ${selectedIds.has(row.id) ? "bg-sky-50" : "hover:bg-slate-50"}`}
              >
                <td className="border-b border-slate-200 px-2 py-1 w-8" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggleSelect(row.id)} />
                </td>
                <td className="border-b border-slate-200 px-2 py-1 font-mono text-xs text-slate-500">{row.vendor_code}</td>
                <td className="border-b border-slate-200 px-2 py-1 font-medium text-slate-800">{row.vendor_name}</td>
                {vendorType === "DOMESTIC" ? (
                  <>
                    <td className="border-b border-slate-200 px-2 py-1 text-xs text-slate-500">{row.bin_number ?? "—"}</td>
                    <td className="border-b border-slate-200 px-2 py-1 text-xs text-slate-500">{row.gst_number ?? "—"}</td>
                  </>
                ) : (
                  <>
                    <td className="border-b border-slate-200 px-2 py-1 text-xs text-slate-500">{row.country_code ?? "—"}</td>
                    <td className="border-b border-slate-200 px-2 py-1 text-xs font-mono text-slate-500">{row.currency_code ?? "—"}</td>
                  </>
                )}
                <td className="border-b border-slate-200 px-2 py-1">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_BADGE[row.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <button onClick={() => load(page - 1)} disabled={page === 0 || loading} className="h-7 border border-slate-300 px-2 text-xs disabled:opacity-40">← Prev</button>
          <span>Page {page + 1} of {totalPages} ({total} total)</span>
          <button onClick={() => load(page + 1)} disabled={page >= totalPages - 1 || loading} className="h-7 border border-slate-300 px-2 text-xs disabled:opacity-40">Next →</button>
        </div>
      )}

      {/* Right Panel */}
      {panel && (
        <VendorPanel
          vendorType={vendorType}
          initialVendor={panel.mode === "edit" ? panel.vendor : null}
          onClose={() => setPanel(null)}
          onSaved={() => { load(page); setNotice("Vendor saved."); }}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TAB 3 — Company Mapping
══════════════════════════════════════════════════════════════════════════ */

function VendorCompanyMappingTab() {
  const companies = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [vendorTypeFilter, setVendorTypeFilter] = useState("");
  const [mappingData, setMappingData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedMapped, setSelectedMapped] = useState(new Set());
  const [selectedUnmapped, setSelectedUnmapped] = useState(new Set());

  const loadMapping = useCallback(async (companyId, q, vt) => {
    if (!companyId) return;
    setLoading(true); setError("");
    try {
      const result = await listVendorCompanyMapping({ company_id: companyId, search: q || undefined, vendor_type: vt || undefined });
      setMappingData(Array.isArray(result?.data) ? result.data : []);
    } catch (e) {
      setError(e.message ?? "Failed to load mapping.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCompanyId) loadMapping(selectedCompanyId, search, vendorTypeFilter);
  }, [selectedCompanyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const mapped = mappingData.filter((m) => m.is_mapped);
  const unmapped = mappingData.filter((m) => !m.is_mapped);
  const lc = search.toLowerCase();
  const filteredMapped = lc ? mapped.filter((m) => m.vendor_name?.toLowerCase().includes(lc) || m.vendor_code?.toLowerCase().includes(lc)) : mapped;
  const filteredUnmapped = lc ? unmapped.filter((m) => m.vendor_name?.toLowerCase().includes(lc) || m.vendor_code?.toLowerCase().includes(lc)) : unmapped;

  async function handleMap() {
    if (!selectedCompanyId || selectedUnmapped.size === 0) return;
    setSaving(true); setError("");
    try {
      await bulkMapVendors({ company_id: selectedCompanyId, vendor_ids: [...selectedUnmapped] });
      setSelectedUnmapped(new Set());
      setNotice(`${selectedUnmapped.size} vendor(s) mapped.`);
      loadMapping(selectedCompanyId, search, vendorTypeFilter);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  async function handleUnmap() {
    if (!selectedCompanyId || selectedMapped.size === 0) return;
    setSaving(true); setError("");
    try {
      await bulkUnmapVendors({ company_id: selectedCompanyId, vendor_ids: [...selectedMapped] });
      setSelectedMapped(new Set());
      setNotice(`${selectedMapped.size} vendor(s) unmapped.`);
      loadMapping(selectedCompanyId, search, vendorTypeFilter);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  async function handleMapAll() {
    if (!selectedCompanyId || unmapped.length === 0) return;
    setSaving(true); setError("");
    try {
      await bulkMapVendors({ company_id: selectedCompanyId, vendor_ids: unmapped.map((m) => m.id) });
      setNotice(`${unmapped.length} vendor(s) mapped.`);
      loadMapping(selectedCompanyId, search, vendorTypeFilter);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  const toggleMapped = (id) => setSelectedMapped((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleUnmapped = (id) => setSelectedUnmapped((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAllMapped = () => setSelectedMapped((prev) => prev.size === filteredMapped.length ? new Set() : new Set(filteredMapped.map((m) => m.id)));
  const toggleAllUnmapped = () => setSelectedUnmapped((prev) => prev.size === filteredUnmapped.length ? new Set() : new Set(filteredUnmapped.map((m) => m.id)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selectedCompanyId}
          onChange={(e) => { setSelectedCompanyId(e.target.value); setSelectedMapped(new Set()); setSelectedUnmapped(new Set()); }}
          className="h-8 border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-sky-500"
        >
          <option value="">— Select Company —</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.company_code} — {c.company_name}</option>)}
        </select>
        <select
          value={vendorTypeFilter}
          onChange={(e) => setVendorTypeFilter(e.target.value)}
          className="h-8 border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-sky-500"
        >
          <option value="">All Types</option>
          <option value="DOMESTIC">Domestic</option>
          <option value="IMPORT">Import</option>
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") loadMapping(selectedCompanyId, search, vendorTypeFilter); }}
          placeholder="Filter by name or code…"
          className="h-8 w-56 border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-sky-500"
        />
        <button onClick={() => loadMapping(selectedCompanyId, search, vendorTypeFilter)} disabled={!selectedCompanyId} className="h-8 border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">Filter</button>
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div>}

      {selectedCompanyId ? (
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3">
          {/* Mapped */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">Mapped ({filteredMapped.length})</span>
              {selectedMapped.size > 0 && (
                <button onClick={handleUnmap} disabled={saving} className="rounded border border-red-400 bg-red-50 px-2 py-0.5 text-xs text-red-600 hover:bg-red-100 disabled:opacity-40">
                  Unmap ({selectedMapped.size})
                </button>
              )}
            </div>
            <VendorMappingList rows={filteredMapped} selected={selectedMapped} onToggle={toggleMapped} onToggleAll={toggleAllMapped} loading={loading} />
          </div>

          {/* Controls */}
          <div className="flex flex-col items-center justify-center gap-2 pt-6">
            <button onClick={handleMap} disabled={saving || selectedUnmapped.size === 0} title="Map selected" className="h-8 w-8 border border-sky-400 bg-sky-50 text-sky-600 hover:bg-sky-100 disabled:opacity-40">←</button>
            <button onClick={handleMapAll} disabled={saving || unmapped.length === 0} title="Map all" className="h-8 w-8 border border-sky-400 bg-sky-50 text-xs text-sky-600 hover:bg-sky-100 disabled:opacity-40">←←</button>
          </div>

          {/* Unmapped */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">Not Mapped ({filteredUnmapped.length})</span>
              {selectedUnmapped.size > 0 && (
                <button onClick={handleMap} disabled={saving} className="rounded border border-sky-400 bg-sky-50 px-2 py-0.5 text-xs text-sky-600 hover:bg-sky-100 disabled:opacity-40">
                  Map ({selectedUnmapped.size})
                </button>
              )}
            </div>
            <VendorMappingList rows={filteredUnmapped} selected={selectedUnmapped} onToggle={toggleUnmapped} onToggleAll={toggleAllUnmapped} loading={loading} />
          </div>
        </div>
      ) : (
        <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
          Select a company to manage vendor mappings.
        </div>
      )}
    </div>
  );
}

function VendorMappingList({ rows, selected, onToggle, onToggleAll, loading }) {
  return (
    <div className="max-h-[calc(100vh-360px)] overflow-y-auto rounded border border-slate-200 bg-white">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-slate-100">
          <tr>
            <th className="w-8 border-b border-slate-200 px-2 py-1">
              <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={onToggleAll} />
            </th>
            <th className="border-b border-slate-200 px-2 py-1 text-left font-semibold text-slate-600">Code</th>
            <th className="border-b border-slate-200 px-2 py-1 text-left font-semibold text-slate-600">Vendor Name</th>
            <th className="border-b border-slate-200 px-2 py-1 text-left font-semibold text-slate-600">Type</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">Loading…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">—</td></tr>
          ) : rows.map((r) => (
            <tr key={r.id} onClick={() => onToggle(r.id)} className={`cursor-pointer ${selected.has(r.id) ? "bg-sky-50" : "hover:bg-slate-50"}`}>
              <td className="border-b border-slate-100 px-2 py-1">
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => onToggle(r.id)} onClick={(e) => e.stopPropagation()} />
              </td>
              <td className="border-b border-slate-100 px-2 py-1 font-mono text-slate-500">{r.vendor_code}</td>
              <td className="border-b border-slate-100 px-2 py-1 font-medium text-slate-800">{r.vendor_name}</td>
              <td className="border-b border-slate-100 px-2 py-1 text-slate-500">{r.vendor_type}</td>
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
  { key: "domestic", label: "Domestic" },
  { key: "import",   label: "Import" },
  { key: "mapping",  label: "Company Mapping" },
];

export default function SAVendorMaster() {
  const [activeTab, setActiveTab] = useState("domestic");

  return (
    <ErpScreenScaffold eyebrow="SA — Operation Management" title="Vendor Master">
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
        {activeTab === "domestic" && <VendorGridTab vendorType="DOMESTIC" />}
        {activeTab === "import"   && <VendorGridTab vendorType="IMPORT" />}
        {activeTab === "mapping"  && <VendorCompanyMappingTab />}
      </ErpSectionCard>
    </ErpScreenScaffold>
  );
}
