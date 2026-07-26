/*
 * File-ID: 23.4
 * File-Path: frontend/src/pages/dashboard/procurement/transfer/PlantTransferListPage.jsx
 * Gate: 23
 * Phase: 23
 * Domain: PROCUREMENT
 * Purpose: List plant transfer orders - ONE_STEP and TWO_STEP
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { ErpSectionCard } from "../../../../components/templates/ErpScreenScaffold.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import { useMaterialOptionsQuery, useStorageLocationOptionsQuery } from "../../../../hooks/queries/useOmMasterQueries.js";
import { useErpScreenHotkeys } from "../../../../hooks/useErpScreenHotkeys.js";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { createPTO, listPTOs } from "../procurementApi.js";

const LIMIT = 50;

function normalizeSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function statusTone(status) {
  switch (String(status || "").toUpperCase()) {
    case "APPROVED":
      return "bg-sky-100 text-sky-800";
    case "ISSUED":
    case "IN_TRANSIT":
      return "bg-violet-100 text-violet-800";
    case "CLOSED":
      return "bg-emerald-100 text-emerald-800";
    case "CANCELLED":
      return "bg-rose-100 text-rose-800";
    case "DRAFT":
    default:
      return "bg-amber-100 text-amber-800";
  }
}

function transferTypeTone(transferType) {
  switch (String(transferType || "").toUpperCase()) {
    case "TWO_STEP":
      return "bg-violet-100 text-violet-800";
    case "ONE_STEP":
    default:
      return "bg-sky-100 text-sky-800";
  }
}

function formatQty(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3) : "0.000";
}

function buildInitialForm(selectedCompanyId) {
  return {
    transfer_type: "ONE_STEP",
    source_company_id: selectedCompanyId || "",
    source_sloc_id: "",
    target_company_id: "",
    target_sloc_id: "",
    material_id: "",
    transfer_qty: "",
    uom_code: "",
    expected_dispatch_date: "",
    expected_receipt_date: "",
    transport_required: false,
    vehicle_number: "",
    transporter_name: "",
    lr_number: "",
    remarks: "",
  };
}

export default function PlantTransferListPage() {
  const navigate = useNavigate();
  const { runtimeContext } = useMenu();
  const selectedCompanyId = runtimeContext?.selectedCompanyId || "";
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [transferType, setTransferType] = useState("");
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [formData, setFormData] = useState(() => buildInitialForm(selectedCompanyId));

  useErpScreenHotkeys({
    refresh: {
      disabled: loading,
      perform: () => setRefreshToken((value) => value + 1),
    },
  });

  const companies = runtimeContext?.availableCompanies ?? [];
  const companyOptions = useMemo(
    () => companies.map((entry) => ({ value: entry.id, label: entry.company_name || entry.company_code || entry.id })),
    [companies]
  );
  const materialQuery = useMaterialOptionsQuery({ limit: 200, offset: 0 });
  const materialOptions = useMemo(
    () => materialQuery.materials.map((entry) => ({ value: entry.id, label: `${entry.pace_code || ""} - ${entry.material_name || ""}`.trim() })),
    [materialQuery.materials]
  );
  const sourceSlocQuery = useStorageLocationOptionsQuery(
    { company_id: formData.source_company_id },
    { enabled: Boolean(formData.source_company_id) }
  );
  const sourceSlocOptions = useMemo(
    () => sourceSlocQuery.storageLocations.map((entry) => ({ value: entry.id, label: `${entry.code || ""} - ${entry.name || ""}`.trim() })),
    [sourceSlocQuery.storageLocations]
  );
  const targetSlocQuery = useStorageLocationOptionsQuery(
    { company_id: formData.target_company_id },
    { enabled: Boolean(formData.target_company_id) }
  );
  const targetSlocOptions = useMemo(
    () => targetSlocQuery.storageLocations.map((entry) => ({ value: entry.id, label: `${entry.code || ""} - ${entry.name || ""}`.trim() })),
    [targetSlocQuery.storageLocations]
  );

  useEffect(() => {
    setFormData((current) => (
      current.source_company_id ? current : buildInitialForm(selectedCompanyId)
    ));
  }, [selectedCompanyId]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await listPTOs({
          company_id: selectedCompanyId || undefined,
          status: status || undefined,
          transfer_type: transferType || undefined,
          limit: 200,
          offset: 0,
        });
        if (!active) return;
        const nextRows = Array.isArray(response?.data)
          ? response.data
          : Array.isArray(response?.items)
            ? response.items
            : [];
        setRows(nextRows);
        setTotal(Number(response?.total ?? nextRows.length ?? 0));
      } catch (loadError) {
        if (!active) return;
        setRows([]);
        setTotal(0);
        setError(loadError instanceof Error ? loadError.message : "PROCUREMENT_PTO_LIST_FAILED");
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
  }, [refreshToken, selectedCompanyId, status, transferType]);

  useEffect(() => {
    setPage(1);
  }, [search, status, transferType]);

  const filteredRows = useMemo(() => {
    const needle = normalizeSearch(search);
    if (!needle) {
      return rows;
    }
    return rows.filter((row) =>
      String(row.pto_number || "").toLowerCase().includes(needle)
    );
  }, [rows, search]);

  const displayTotal = search ? filteredRows.length : total;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / LIMIT));
  const safePage = Math.min(page, totalPages);
  const startIndex = filteredRows.length === 0 ? 0 : (safePage - 1) * LIMIT + 1;
  const endIndex = filteredRows.length === 0 ? 0 : Math.min(safePage * LIMIT, filteredRows.length);
  const pageRows = filteredRows.slice((safePage - 1) * LIMIT, safePage * LIMIT);

  function openDetail(row) {
    openScreen(OPERATION_SCREENS.PROC_PLANT_TRANSFER_DETAIL.screen_code, { context: { id: row.id } });
    navigate(`/dashboard/procurement/transfer/${encodeURIComponent(row.id)}`);
  }

  function handleFormChange(field, value) {
    setFormData((current) => {
      const next = { ...current, [field]: value };
      if (field === "material_id") {
        const material = materialQuery.materials.find((entry) => entry.id === value);
        next.uom_code = material?.base_uom_code || "";
      } else if (field === "source_company_id") {
        next.source_sloc_id = "";
      } else if (field === "target_company_id") {
        next.target_sloc_id = "";
      }
      return next;
    });
  }

  async function handleCreate(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await createPTO({
        ...formData,
        transfer_qty: Number(formData.transfer_qty),
      });
      setNotice("Plant transfer order created.");
      setShowCreate(false);
      setFormData(buildInitialForm(selectedCompanyId));
      setRefreshToken((value) => value + 1);
      openScreen(OPERATION_SCREENS.PROC_PLANT_TRANSFER_DETAIL.screen_code);
      navigate(`/dashboard/procurement/transfer/${encodeURIComponent(created.id)}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "PROCUREMENT_PTO_CREATE_FAILED");
    } finally {
      setSaving(false);
    }
  }

  function handleCancelCreate() {
    setShowCreate(false);
    setFormData(buildInitialForm(selectedCompanyId));
  }

  return (
    <ErpMasterListTemplate
      eyebrow="Procurement"
      title="Plant Transfers"
      notices={[
        ...(error ? [{ key: "pto-list-error", tone: "error", message: error }] : []),
        ...(notice ? [{ key: "pto-list-notice", tone: "success", message: notice }] : []),
      ]}
      actions={[
        {
          key: "refresh",
          label: loading ? "Refreshing..." : "Refresh",
          tone: "neutral",
          onClick: () => setRefreshToken((value) => value + 1),
        },
        {
          key: "create",
          label: showCreate ? "Hide Create Form" : "Create PTO",
          tone: "primary",
          onClick: () => setShowCreate((value) => !value),
        },
      ]}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Plant transfer order register",
        children: (
          <div className="grid gap-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_180px_180px]">
              <QuickFilterInput
                label="Search"
                value={search}
                onChange={setSearch}
                primaryFocus
                placeholder="Search PTO number"
              />
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Status
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">ALL</option>
                  {["DRAFT", "APPROVED", "ISSUED", "IN_TRANSIT", "CLOSED", "CANCELLED"].map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-slate-600">
                Transfer Type
                <select
                  value={transferType}
                  onChange={(event) => setTransferType(event.target.value)}
                  className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
                >
                  <option value="">ALL</option>
                  {["ONE_STEP", "TWO_STEP"].map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {showCreate ? (
              <ErpSectionCard eyebrow="Create PTO" title="New plant transfer order">
                <form onSubmit={handleCreate} className="grid gap-3">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <ErpDenseFormRow label="Transfer Type">
                      <select
                        value={formData.transfer_type}
                        onChange={(event) => handleFormChange("transfer_type", event.target.value)}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      >
                        <option value="ONE_STEP">ONE_STEP</option>
                        <option value="TWO_STEP">TWO_STEP</option>
                      </select>
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Source Company">
                      <ErpComboboxField
                        value={formData.source_company_id}
                        onChange={(value) => handleFormChange("source_company_id", value)}
                        options={companyOptions}
                        blankLabel="Select source company"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Source SLOC">
                      <ErpComboboxField
                        value={formData.source_sloc_id}
                        onChange={(value) => handleFormChange("source_sloc_id", value)}
                        options={sourceSlocOptions}
                        blankLabel="Select source SLOC"
                        disabled={!formData.source_company_id}
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Target Company">
                      <ErpComboboxField
                        value={formData.target_company_id}
                        onChange={(value) => handleFormChange("target_company_id", value)}
                        options={companyOptions}
                        blankLabel="Select target company"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Target SLOC">
                      <ErpComboboxField
                        value={formData.target_sloc_id}
                        onChange={(value) => handleFormChange("target_sloc_id", value)}
                        options={targetSlocOptions}
                        blankLabel="Select target SLOC"
                        disabled={!formData.target_company_id}
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Material">
                      <ErpComboboxField
                        value={formData.material_id}
                        onChange={(value) => handleFormChange("material_id", value)}
                        options={materialOptions}
                        blankLabel="Select material"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Transfer Qty">
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={formData.transfer_qty}
                        onChange={(event) => handleFormChange("transfer_qty", event.target.value)}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                        required
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="UOM Code">
                      <input
                        type="text"
                        value={formData.uom_code}
                        readOnly
                        className="h-8 w-full border border-slate-300 bg-slate-100 px-2 text-sm text-slate-700 outline-none"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Expected Dispatch Date">
                      <input
                        type="date"
                        value={formData.expected_dispatch_date}
                        onChange={(event) => handleFormChange("expected_dispatch_date", event.target.value)}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                    <ErpDenseFormRow label="Expected Receipt Date">
                      <input
                        type="date"
                        value={formData.expected_receipt_date}
                        onChange={(event) => handleFormChange("expected_receipt_date", event.target.value)}
                        className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                      />
                    </ErpDenseFormRow>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={Boolean(formData.transport_required)}
                      onChange={(event) => handleFormChange("transport_required", event.target.checked)}
                    />
                    Transport Required
                  </label>
                  {formData.transport_required ? (
                    <div className="grid gap-3 md:grid-cols-3">
                      <ErpDenseFormRow label="Vehicle Number">
                        <input
                          type="text"
                          value={formData.vehicle_number}
                          onChange={(event) => handleFormChange("vehicle_number", event.target.value)}
                          className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                        />
                      </ErpDenseFormRow>
                      <ErpDenseFormRow label="Transporter Name">
                        <input
                          type="text"
                          value={formData.transporter_name}
                          onChange={(event) => handleFormChange("transporter_name", event.target.value)}
                          className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                        />
                      </ErpDenseFormRow>
                      <ErpDenseFormRow label="LR Number">
                        <input
                          type="text"
                          value={formData.lr_number}
                          onChange={(event) => handleFormChange("lr_number", event.target.value)}
                          className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                        />
                      </ErpDenseFormRow>
                    </div>
                  ) : null}
                  <ErpDenseFormRow label="Remarks">
                    <input
                      type="text"
                      value={formData.remarks}
                      onChange={(event) => handleFormChange("remarks", event.target.value)}
                      className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
                    />
                  </ErpDenseFormRow>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={saving}
                      className="border border-sky-700 bg-sky-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {saving ? "Creating..." : "Create PTO"}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelCreate}
                      disabled={saving}
                      className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </ErpSectionCard>
            ) : null}
          </div>
        ),
      }}
      listSection={{
        eyebrow: "PTO Register",
        title: loading ? "Loading plant transfers" : `${displayTotal} plant transfer row${displayTotal === 1 ? "" : "s"}`,
        children: (
          <div className="grid gap-3">
            <ErpPaginationStrip
              page={safePage}
              setPage={setPage}
              totalPages={totalPages}
              startIndex={startIndex}
              endIndex={endIndex}
              totalItems={filteredRows.length}
            />
            <ErpDenseGrid
              columns={[
                { key: "pto_number", label: "PTO Number", width: "140px" },
                {
                  key: "transfer_type",
                  label: "Type",
                  width: "130px",
                  render: (row) => (
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${transferTypeTone(row.transfer_type)}`}>
                      {row.transfer_type || "—"}
                    </span>
                  ),
                },
                {
                  key: "status",
                  label: "Status",
                  width: "130px",
                  render: (row) => (
                    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${statusTone(row.status)}`}>
                      {row.status || "—"}
                    </span>
                  ),
                },
                { key: "material_display", label: "Material", render: (row) => row.material_display || row.material_id || "—" },
                {
                  key: "transfer_qty",
                  label: "Transfer Qty",
                  width: "110px",
                  align: "right",
                  render: (row) => formatQty(row.transfer_qty),
                },
                { key: "uom_code", label: "UOM", width: "90px" },
                { key: "created_at", label: "Created", width: "180px" },
              ]}
              rows={pageRows}
              rowKey={(row) => row.id}
              onRowActivate={openDetail}
              getRowProps={(row) => ({
                onDoubleClick: () => openDetail(row),
                className: "cursor-pointer hover:bg-sky-50",
              })}
              emptyMessage={loading ? "Loading plant transfers..." : "No plant transfers matched the current filter."}
            />
          </div>
        ),
      }}
    />
  );
}
