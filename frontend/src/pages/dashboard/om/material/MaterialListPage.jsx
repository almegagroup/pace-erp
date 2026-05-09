/*
 * File-ID: 15.2
 * File-Path: frontend/src/pages/dashboard/om/material/MaterialListPage.jsx
 * Gate: 15
 * Phase: 15
 * Domain: OPERATION_MANAGEMENT
 * Purpose: Render the material master list with filters and pagination.
 * Authority: Frontend
 */

import { useEffect, useMemo, useState } from "react";
import QuickFilterInput from "../../../../components/inputs/QuickFilterInput.jsx";
import ErpPaginationStrip from "../../../../components/ErpPaginationStrip.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import ErpMasterListTemplate from "../../../../components/templates/ErpMasterListTemplate.jsx";
import { openScreen } from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { listMaterials } from "../omApi.js";

const LIMIT = 50;

export default function MaterialListPage() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [materialType, setMaterialType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const result = await listMaterials({
          material_type: materialType || undefined,
          status: status || undefined,
          search: debouncedSearch || undefined,
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
        setError(loadError instanceof Error ? loadError.message : "OM_MATERIAL_LIST_FAILED");
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
  }, [debouncedSearch, materialType, page, status]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / LIMIT)), [total]);
  const startIndex = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endIndex = total === 0 ? 0 : Math.min(page * LIMIT, total);

  return (
    <ErpMasterListTemplate
      eyebrow="Operation Management"
      title="Material Master"
      actions={[
        { key: "refresh", label: loading ? "Refreshing..." : "Refresh", tone: "neutral", onClick: () => setPage((current) => current) },
        { key: "create", label: "Create Material", tone: "primary", onClick: () => openScreen(OPERATION_SCREENS.OM_MATERIAL_CREATE.screen_code) },
      ]}
      notices={error ? [{ key: "error", tone: "error", message: error }] : []}
      filterSection={{
        eyebrow: "Search And Filter",
        title: "Material lookup",
        children: (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_180px_180px]">
            <QuickFilterInput
              label="Material Search"
              value={search}
              onChange={setSearch}
              primaryFocus
              placeholder="Search material code or material name"
            />
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Material Type
              <select
                value={materialType}
                onChange={(event) => {
                  setMaterialType(event.target.value);
                  setPage(1);
                }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">ALL</option>
                {["RM", "PM", "INT", "FG", "TRA", "CONS"].map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-slate-600">
              Status
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
                className="h-10 border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="">ALL</option>
                {["DRAFT", "PENDING_APPROVAL", "ACTIVE", "INACTIVE", "BLOCKED"].map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ),
      }}
      listSection={{
        eyebrow: "Material Register",
        title: loading ? "Loading materials" : `${total} material row${total === 1 ? "" : "s"}`,
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
                {
                  key: "material",
                  label: "Material",
                  render: (row) => (
                    <div>
                      <div className="font-semibold text-slate-900">{row.pace_code || "-"}</div>
                      <div className="text-[10px] text-slate-500">{row.material_name || "-"}</div>
                    </div>
                  ),
                },
                { key: "material_type", label: "Type" },
                { key: "base_uom_code", label: "Base UOM" },
                { key: "status", label: "Status" },
              ]}
              rows={rows}
              rowKey={(row) => row.id}
              onRowActivate={(row) =>
                openScreen(OPERATION_SCREENS.OM_MATERIAL_DETAIL.screen_code, {
                  context: { id: row.id },
                })}
              getRowProps={(row) => ({
                onDoubleClick: () =>
                  openScreen(OPERATION_SCREENS.OM_MATERIAL_DETAIL.screen_code, {
                    context: { id: row.id },
                  }),
                className: "cursor-pointer hover:bg-sky-50",
              })}
              emptyMessage={loading ? "Loading materials..." : "No material matched the current filter."}
            />
          </div>
        ),
      }}
    />
  );
}
