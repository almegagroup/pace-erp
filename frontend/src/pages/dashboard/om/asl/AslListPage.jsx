/*
 * File-ID: 15.8
 * File-Path: frontend/src/pages/dashboard/om/asl/AslListPage.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render the approved source list register with filters and pagination.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpDenseFormRow from "../../../../components/forms/ErpDenseFormRow.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listVendorMaterialInfos } from "../omApi.js";

const LIMIT = 50;

export default function AslListPage() {
  const [rows, setRows] = useState([]);
  const [vendorId, setVendorId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const result = await listVendorMaterialInfos({
          vendor_id: vendorId || undefined,
          material_id: materialId || undefined,
          status: status || undefined,
          limit: LIMIT,
          offset: (page - 1) * LIMIT,
        });
        if (!active) {
          return;
        }
        setRows(Array.isArray(result?.data) ? result.data : []);
        setTotal(Number(result?.total ?? 0));
      } catch (loadError) {
        if (!active) {
          return;
        }
        setRows([]);
        setTotal(0);
        setError(loadError instanceof Error ? loadError.message : "OM_VMI_LIST_FAILED");
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
  }, [materialId, page, status, vendorId]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / LIMIT)), [total]);
  const startIndex = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(page * LIMIT, total);

  return (
    <ErpMasterListTemplate
      eyebrow="Operation Management"
      title="Approved Source List"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => setPage((current) => current) },
        { key: "create", label: "Create ASL Row", tone: "primary", onClick: () => openScreen(OPERATION_SCREENS.OM_ASL_CREATE.screen_code) },
      ]}
      notices={error ? [{ key: "error", tone: "error", message: error }] : []}
      filterSection={{
        eyebrow: "Lookup Filters",
        title: "Vendor-material pair filter",
        children: (
          <div className="grid gap-3 lg:grid-cols-3">
            <ErpDenseFormRow label="Vendor ID">
              <input
                value={vendorId}
                onChange={(event) => {
                  setVendorId(event.target.value);
                  setPage(1);
                }}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Material ID">
              <input
                value={materialId}
                onChange={(event) => {
                  setMaterialId(event.target.value);
                  setPage(1);
                }}
                className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
            </ErpDenseFormRow>
            <ErpDenseFormRow label="Status">
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
                className="h-8 w-full border border-slate-300 bg-white px-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">ALL</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </ErpDenseFormRow>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "ASL Register",
        title: loading ? "Loading vendor-material rows" : `${total} ASL row${total === 1 ? "" : "s"}`,
        children: (
          <div className="grid gap-3">
            <ErpPaginationStrip
              page={page}
              setPage={setPage}
              totalPages={totalPages}
              startIndex={startIndex}
              endIndex={endIndex}
              totalItems={total}
            />
            <ErpDenseGrid
              columns={[
                { key: "vendor_id", label: "Vendor ID" },
                { key: "material_id", label: "Material ID" },
                { key: "po_uom_code", label: "PO UOM" },
                { key: "conversion_factor", label: "Factor" },
                { key: "status", label: "Status" },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
              onRowActivate={(row) =>
                openScreen(OPERATION_SCREENS.OM_ASL_DETAIL.screen_code, {
                  context: { id: row.id },
                })}
              getRowProps={(row) => ({
                onDoubleClick: () =>
                  openScreen(OPERATION_SCREENS.OM_ASL_DETAIL.screen_code, {
                    context: { id: row.id },
                  }),
                className: "cursor-pointer hover:bg-sky-50",
              })}
              emptyMessage={loading ? "Loading ASL rows..." : "No ASL row matched the current filter."}
            />
          </div>
        ),
      }}
    />
  );
}
