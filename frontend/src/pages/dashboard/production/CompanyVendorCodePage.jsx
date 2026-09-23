/*
 * File-ID: 27.27-FE
 * File-Path: frontend/src/pages/dashboard/production/CompanyVendorCodePage.jsx
 * Gate: 27.27 | Domain: PRODUCTION / COSTING (Accounts ACL, AC11)
 * Purpose: per-company Vendor Code workspace (feasibility §140) -- pick which
 *          globally-created vendor codes (SA's Vendor Code Master) apply to
 *          this company, choose exactly one Primary, and override specific
 *          Prodshade+Stroke combinations onto a non-primary vendor code.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import TransactionCompanySelector from "../../../components/inputs/TransactionCompanySelector.jsx";
import ErpDenseGrid from "../../../components/data/ErpDenseGrid.jsx";
import ErpComboboxField from "../../../components/forms/ErpComboboxField.jsx";
import ErpMasterListTemplate from "../../../components/templates/ErpMasterListTemplate.jsx";
import { pushToast } from "../../../store/uiToast.js";
import { useMenu } from "../../../context/useMenu.js";
import {
  getCompanyVendorCodeWorkspace,
  mapCompanyVendorCode,
  setCompanyVendorCodePrimary,
  unmapCompanyVendorCode,
  createVendorCodeOverride,
  deleteVendorCodeOverride,
  listApprovedProdshades,
  listStrokeMasters,
} from "./prodApi.js";

const EMPTY = [];
const unwrap = (payload) => payload?.data ?? payload ?? {};

export default function CompanyVendorCodePage() {
  const { runtimeContext } = useMenu();
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState(runtimeContext?.selectedCompanyId ? String(runtimeContext.selectedCompanyId) : "");
  const [addVendorCodeId, setAddVendorCodeId] = useState("");
  const [overrideMapId, setOverrideMapId] = useState("");
  const [overrideProdshadeId, setOverrideProdshadeId] = useState("");
  const [overrideStrokeId, setOverrideStrokeId] = useState("");
  const [busy, setBusy] = useState(false);

  function notice(message, tone = "success") {
    pushToast({ message, tone });
  }

  const workspaceQ = useQuery({
    queryKey: ["company-vendor-code", companyId],
    queryFn: () => getCompanyVendorCodeWorkspace({ company_id: companyId }),
    enabled: Boolean(companyId),
    select: unwrap,
  });
  const prodshadesQ = useQuery({
    queryKey: ["company-vendor-code-prodshades", companyId],
    queryFn: () => listApprovedProdshades({ company_id: companyId }),
    enabled: Boolean(companyId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? EMPTY),
  });
  const strokesQ = useQuery({
    queryKey: ["company-vendor-code-strokes", companyId, overrideProdshadeId],
    queryFn: () => listStrokeMasters({ company_id: companyId, material_id: overrideProdshadeId, status: "APPROVED" }),
    enabled: Boolean(companyId && overrideProdshadeId),
    select: (payload) => (Array.isArray(payload) ? payload : payload?.data ?? EMPTY),
  });

  const mapped = workspaceQ.data?.mapped ?? EMPTY;
  const available = workspaceQ.data?.available ?? EMPTY;
  const overrides = workspaceQ.data?.overrides ?? EMPTY;
  const prodshades = prodshadesQ.data ?? EMPTY;
  const strokes = strokesQ.data ?? EMPTY;

  const availableOptions = available.map((row) => ({ value: row.id, label: `${row.vendor_code}${row.description ? ` — ${row.description}` : ""}` }));
  const nonPrimaryMapOptions = mapped.filter((row) => !row.is_primary).map((row) => ({ value: row.map_id, label: row.vendor_code }));
  const prodshadeOptions = prodshades.map((material) => ({
    value: material.material_id,
    label: [material.external_code ?? "-", material.material_name, material.document_name].filter(Boolean).join(" — "),
  }));
  const strokeOptions = strokes.map((stroke) => ({ value: stroke.id, label: `Stroke ${stroke.stroke_number}` }));

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["company-vendor-code", companyId] });
  }

  async function withBusy(action) {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (error) {
      notice(error?.message || "Request failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ErpMasterListTemplate
      eyebrow="AC11"
      title="Company Vendor Code"
      actions={[{ key: "refresh", label: "Refresh", tone: "neutral", onClick: () => void refresh() }]}
      filterSection={{
        eyebrow: "Controls",
        title: "Company",
        children: (
          <TransactionCompanySelector
            runtimeContext={runtimeContext}
            value={companyId}
            onChange={(value) => {
              setCompanyId(value);
              setOverrideMapId("");
              setOverrideProdshadeId("");
              setOverrideStrokeId("");
            }}
            label="Company"
          />
        ),
      }}
      listSection={{
        eyebrow: "AC11",
        title: "Vendor Codes",
        children: !companyId ? (
          <div className="rounded border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
            Select a company first.
          </div>
        ) : (
          <div className="grid gap-6">
            <div className="grid gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-72">
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Add a vendor code to this company</label>
                  <ErpComboboxField value={addVendorCodeId} onChange={setAddVendorCodeId} options={availableOptions} placeholder="Select vendor code..." />
                </div>
                <button
                  type="button"
                  disabled={busy || !addVendorCodeId}
                  onClick={() =>
                    void withBusy(async () => {
                      await mapCompanyVendorCode({ company_id: companyId, vendor_code_id: addVendorCodeId });
                      setAddVendorCodeId("");
                      notice("Vendor code added.");
                    })
                  }
                  className="h-10 border border-sky-700 bg-sky-100 px-4 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Add
                </button>
              </div>
              <ErpDenseGrid
                columns={[
                  { key: "vendor_code", label: "Vendor Code", width: "140px", render: (row) => <span className="font-mono font-semibold">{row.vendor_code}</span> },
                  { key: "description", label: "Description", width: "220px", render: (row) => row.description || "-" },
                  {
                    key: "primary",
                    label: "Primary",
                    width: "110px",
                    render: (row) =>
                      row.is_primary ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Primary</span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void withBusy(() => setCompanyVendorCodePrimary({ company_id: companyId, map_id: row.map_id }))}
                          className="text-xs text-sky-600 hover:underline disabled:opacity-40"
                        >
                          Set Primary
                        </button>
                      ),
                  },
                  {
                    key: "action",
                    label: "",
                    width: "90px",
                    render: (row) =>
                      row.is_primary ? null : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void withBusy(() => unmapCompanyVendorCode({ company_id: companyId, map_id: row.map_id }))}
                          className="text-xs text-rose-600 hover:underline disabled:opacity-40"
                        >
                          Remove
                        </button>
                      ),
                  },
                ]}
                rows={mapped}
                rowKey={(row) => row.map_id}
                emptyMessage="No vendor code mapped to this company yet -- add one above."
              />
            </div>

            <div className="grid gap-3 border-t border-slate-200 pt-4">
              <h3 className="text-sm font-semibold text-slate-900">Prodshade + Stroke Overrides</h3>
              <p className="text-xs text-slate-500">
                Every Prodshade/Stroke uses this company&apos;s Primary vendor code unless overridden here onto a
                non-primary one.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-56">
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Vendor Code (non-primary)</label>
                  <ErpComboboxField value={overrideMapId} onChange={setOverrideMapId} options={nonPrimaryMapOptions} placeholder="Select..." />
                </div>
                <div className="w-72">
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Prodshade</label>
                  <ErpComboboxField
                    value={overrideProdshadeId}
                    onChange={(value) => {
                      setOverrideProdshadeId(value);
                      setOverrideStrokeId("");
                    }}
                    options={prodshadeOptions}
                    placeholder="Select..."
                  />
                </div>
                <div className="w-56">
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Stroke</label>
                  <ErpComboboxField
                    value={overrideStrokeId}
                    onChange={setOverrideStrokeId}
                    options={strokeOptions}
                    disabled={!overrideProdshadeId}
                    placeholder={overrideProdshadeId ? "Select..." : "Select a Prodshade first"}
                  />
                </div>
                <button
                  type="button"
                  disabled={busy || !overrideMapId || !overrideStrokeId}
                  onClick={() =>
                    void withBusy(async () => {
                      await createVendorCodeOverride({ company_id: companyId, company_vendor_code_map_id: overrideMapId, stroke_master_id: overrideStrokeId });
                      setOverrideStrokeId("");
                      notice("Override saved.");
                    })
                  }
                  className="h-10 border border-sky-700 bg-sky-100 px-4 text-sm font-semibold text-sky-950 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Add Override
                </button>
              </div>
              <ErpDenseGrid
                columns={[
                  { key: "prodshade_name", label: "Prodshade", width: "260px", render: (row) => row.prodshade_name || "-" },
                  { key: "stroke_number", label: "Stroke", width: "100px", render: (row) => row.stroke_number ?? "-" },
                  { key: "vendor_code", label: "Vendor Code", width: "140px", render: (row) => <span className="font-mono font-semibold">{row.vendor_code}</span> },
                  {
                    key: "action",
                    label: "",
                    width: "90px",
                    render: (row) => (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void withBusy(() => deleteVendorCodeOverride({ company_id: companyId, id: row.id }))}
                        className="text-xs text-rose-600 hover:underline disabled:opacity-40"
                      >
                        Remove
                      </button>
                    ),
                  },
                ]}
                rows={overrides}
                rowKey={(row) => row.id}
                emptyMessage="No Prodshade/Stroke override yet -- every Stroke uses the Primary vendor code."
              />
            </div>
          </div>
        ),
      }}
    />
  );
}
