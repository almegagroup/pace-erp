import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ErpScreenScaffold, {
  ErpSectionCard,
} from "../../../../components/templates/ErpScreenScaffold.jsx";
import ErpComboboxField from "../../../../components/forms/ErpComboboxField.jsx";
import ErpDenseGrid from "../../../../components/data/ErpDenseGrid.jsx";
import TransactionCompanySelector from "../../../../components/inputs/TransactionCompanySelector.jsx";
import { useMenu } from "../../../../context/useMenu.js";
import {
  buildTransactionCompanyList,
  resolveDefaultTransactionCompanyId,
} from "../../../../components/inputs/transactionCompanyRuntime.js";
import { isRouteAllowed } from "../../../../router/routeIndex.js";
import {
  getActiveScreenContext,
  openScreen,
  popScreen,
  updateActiveScreenContext,
} from "../../../../navigation/screenStackEngine.js";
import { OPERATION_SCREENS } from "../../../../navigation/screens/projects/operationModule/operationScreens.js";
import { pushToast } from "../../../../store/uiToast.js";
import {
  createSalesReturn,
  listSalesReturnBatchOptions,
  listSalesReturnRepackSkuOptions,
  listSalesReturnStrokeCheckOptions,
  listTransporters,
  resolveSalesReturnProdshade,
} from "../procurementApi.js";
import {
  listCustomerAddresses,
  listCustomerAddressesByDepot,
  listCustomers,
  listFgDepotCodes,
  listFgParentCompanies,
  listMaterials,
  listStorageLocations,
} from "../../om/omApi.js";

// Transporter search + keyboard nav — copied from DO01CreatePage.jsx's
// TransporterPicker (§137, 2026-09-06 keyboard-nav fix), same local-copy
// convention as that file already uses (kept per-page, not extracted to a
// shared component, since each page's props are tightly coupled to its own
// state shape). "Add to Transporter Master" pushes via the screen-stack
// context-stash pattern (onAddNew, wired below to
// handleAddTransporterToMaster) -- opening it in a new browser tab/window
// was tried first but this app's session enforces single-window ownership
// (Secure Window Guard), so a second tab can never load the workspace at
// all. Found live 2026-09-26, business owner.
function TransporterPicker({
  transporterId,
  transporterName,
  onSelect,
  onClear,
  companyId,
  canManageTransporters,
  onAddNew,
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [panelRect, setPanelRect] = useState(null);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const wrapperRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(
      () => setDebouncedSearch(search.trim()),
      300,
    );
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const open = debouncedSearch.length >= 2;
  const transporterQuery = useQuery({
    queryKey: [
      "procurement",
      "transporters",
      "so05-search",
      debouncedSearch,
      companyId,
    ],
    queryFn: () =>
      listTransporters({ search: debouncedSearch, company_id: companyId, limit: 20 }),
    enabled: open,
  });
  const results = Array.isArray(transporterQuery.data)
    ? transporterQuery.data
    : (transporterQuery.data?.data ?? transporterQuery.data?.items ?? []);
  const safeHighlightIndex =
    highlightIndex >= 0 && highlightIndex < results.length
      ? highlightIndex
      : -1;

  function handleSearchInputChange(event) {
    setSearch(event.target.value);
    setHighlightIndex(-1);
  }

  function handleSearchKeyDown(event) {
    if (!open || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((current) => (current + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      const pick = results[safeHighlightIndex] ?? (results.length === 1 ? results[0] : null);
      if (pick) {
        event.preventDefault();
        onSelect(pick);
        setSearch("");
      }
    } else if (event.key === "Escape") {
      setSearch("");
    }
  }

  useLayoutEffect(() => {
    if (!open) return undefined;
    function updateRect() {
      const el = wrapperRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPanelRect({ top: rect.bottom, left: rect.left, width: rect.width });
    }
    updateRect();
    window.addEventListener("scroll", updateRect, true);
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("scroll", updateRect, true);
      window.removeEventListener("resize", updateRect);
    };
  }, [open]);

  if (transporterId && transporterName) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex h-8 flex-1 items-center border border-emerald-300 bg-emerald-50 px-2 text-xs text-emerald-900">
          {transporterName}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="h-8 border border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-600"
        >
          Clear
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        placeholder="Type 2+ characters to search transporter master…"
        value={search}
        onChange={handleSearchInputChange}
        onKeyDown={handleSearchKeyDown}
        className="h-8 w-full border border-slate-300 bg-[#fffef7] px-2 text-xs text-slate-900 outline-none focus:border-sky-500"
      />
      {open && panelRect &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: panelRect.top,
              left: panelRect.left,
              width: panelRect.width,
              zIndex: 1000200,
            }}
            className="max-h-52 overflow-y-auto border border-slate-400 bg-white shadow-md"
          >
            {transporterQuery.isLoading && (
              <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>
            )}
            {!transporterQuery.isLoading && results.length === 0 && (
              <div className="px-3 py-2 text-xs text-slate-500">
                No match found.
                {canManageTransporters ? (
                  <button
                    type="button"
                    onClick={onAddNew}
                    className="ml-2 text-sky-600 underline"
                  >
                    Add to Transporter Master →
                  </button>
                ) : (
                  <span className="ml-2 text-slate-400">(Contact manager to add)</span>
                )}
              </div>
            )}
            {results.map((t, index) => (
              <button
                key={t.id}
                type="button"
                onMouseEnter={() => setHighlightIndex(index)}
                onClick={() => {
                  onSelect(t);
                  setSearch("");
                }}
                className={`block w-full border-b border-slate-100 px-3 py-2 text-left text-xs last:border-0 hover:bg-sky-50 ${
                  index === safeHighlightIndex ? "bg-sky-100" : ""
                }`}
              >
                <span className="font-mono text-[10px] text-slate-500">
                  {t.transporter_code}
                </span>{" "}
                {t.transporter_name}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

const TYPES = [
  ["DEPENDENT_DIRECT", "Dependent — Direct"],
  ["DEPENDENT_DEPOT", "Dependent — Depot"],
  ["INDEPENDENT_PARTY", "Independent Party"],
  ["INDEPENDENT_PARTY_ASIAN_BILLED", "Independent Party — Asian Billed"],
  ["STO", "STO"],
];
const MATERIAL_TYPES = ["RM", "PM", "INT", "SFG", "FG"];
const FG_TYPES = ["MTO", "HPS", "MTEST", "MTS"];
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const id = () => `${Date.now()}-${Math.random()}`;
const emptyRepack = () => ({
  __key: id(),
  target_material_id: "",
  num_packs: "",
  per_pack_qty: "",
  quantity: "",
  uom_code: "KG",
  storage_location_id: "",
});
const emptyItem = () => ({
  __key: id(),
  line_material_type: "FG",
  fg_type: "MTO",
  material_id: "",
  declared_stroke_number: "",
  batch_number: "",
  expiry_date: "",
  num_packs: "",
  per_pack_qty: "",
  quantity: "",
  uom_code: "KG",
  storage_location_id: "",
  is_repacked: false,
  packing_order_id: "",
  repack_lines: [],
});
const emptyInvoice = () => ({
  __key: id(),
  tick_on: true,
  invoice_number: "",
  invoice_date: today(),
  reference_document_number: "",
  amount: "",
  gst_treatment: "EXCLUSIVE",
  gst_rate: "",
  gst_amount: "",
  state: "",
  freight_term: "FOR",
  items: [emptyItem()],
});
const input = "border border-slate-300 rounded px-2 py-1.5 text-sm w-full";
const optionLabel = (row) =>
  [
    row.pace_code || row.external_code || row.code || row.company_code,
    row.material_name || row.company_name || row.description ||
    row.customer_name || row.transporter_name,
  ].filter(Boolean).join(" — ");
// Item Name + Document Name — business owner, 2026-09-26: never lead with
// pace_code for a material row, it's often blank/meaningless (e.g. an FG
// SKU's vendor-invoice barcode landed in material_name instead of a
// readable name, while document_name -- material_master's own "vendor
// invoice name" column, added alongside pace_code going nullable in the
// 2026-06-18 redesign -- is the one that reads sensibly). Only for
// materials; optionLabel above still serves companies/customers/
// transporters, which have no pace_code at all.
const materialOptionLabel = (row) =>
  [row.material_name, row.document_name].filter(Boolean).join(" — ");
const toComboOptions = (list, label = optionLabel) =>
  list.map((row) => ({ value: row.id, label: label(row) }));
const rows = (value) => Array.isArray(value) ? value : value?.data ?? [];

function BatchNumberField({ companyId, item, onChange }) {
  const optionsQ = useQuery({
    queryKey: [
      "so05-batch-options",
      companyId,
      item.material_id,
      item.fg_type,
      item.batch_number,
    ],
    queryFn: () =>
      listSalesReturnBatchOptions({
        company_id: companyId,
        material_id: item.material_id,
        po_type: item.fg_type,
        q: item.batch_number,
      }),
    enabled: !!companyId && !!item.material_id &&
      ["FG", "SFG"].includes(item.line_material_type) && !!item.fg_type,
    select: rows,
  });
  const listId = `so05-batches-${item.__key}`;
  return (
    <>
      <input
        list={listId}
        className={input}
        value={item.batch_number}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
      />
      <datalist id={listId}>
        {(optionsQ.data ?? []).map((row) => (
          <option key={row.id} value={row.batch_number}>{row.po_number}</option>
        ))}
      </datalist>
    </>
  );
}

// business owner, 2026-09-26: same green/red Stroke Number dot SO01 already
// has (§133.21, SO01CreatePage.jsx's strokeCheckStatus) -- resolves to an
// approved stroke_master row for this item's own Prodshade, or not. A
// non-FG material (RM/PM/INT/SFG) IS its own Prodshade (matches
// deriveProdshadeMaterialId()'s own rule on the backend), so only an FG
// line needs the extra prodshade lookup round trip.
function StrokeNumberField({ companyId, item, onChange }) {
  const applicable = ["FG", "SFG"].includes(item.line_material_type) &&
    !!item.fg_type;
  const strokeCheckQ = useQuery({
    queryKey: ["so05-stroke-check-options", companyId],
    queryFn: () => listSalesReturnStrokeCheckOptions({ company_id: companyId }),
    enabled: !!companyId && applicable,
    staleTime: 60_000,
    select: rows,
  });
  const isFg = item.line_material_type === "FG";
  const prodshadeQ = useQuery({
    queryKey: ["so05-prodshade", item.material_id],
    queryFn: () => resolveSalesReturnProdshade({ material_id: item.material_id }),
    enabled: applicable && isFg && !!item.material_id,
    staleTime: 60_000,
  });
  if (!applicable) {
    return (
      <input
        className={input}
        value={item.declared_stroke_number}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  const prodshadeId = isFg
    ? prodshadeQ.data?.prodshade_material_id
    : item.material_id;
  const validKeys = new Set(
    (strokeCheckQ.data ?? []).map((row) =>
      `${row.prodshade_material_id}|${row.po_type}|${row.stroke_number}`
    ),
  );
  const status = item.material_id && item.declared_stroke_number?.trim() &&
      prodshadeId
    ? validKeys.has(
      `${prodshadeId}|${item.fg_type}|${item.declared_stroke_number.trim()}`,
    )
    : null;
  return (
    <div className="flex items-center gap-1.5">
      {status !== null && (
        <span
          title={status
            ? "Resolves to an approved Stroke Master row"
            : "Not found in Stroke Master for this item's Prodshade — reconcile later"}
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${
            status ? "bg-emerald-500" : "bg-rose-500"
          }`}
        />
      )}
      <input
        className={input}
        value={item.declared_stroke_number}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function RepackTargetSelect({ companyId, sourceMaterialId, value, onChange }) {
  const optionsQ = useQuery({
    queryKey: ["so05-repack-targets", companyId, sourceMaterialId],
    queryFn: () =>
      listSalesReturnRepackSkuOptions({
        company_id: companyId,
        source_material_id: sourceMaterialId,
        exclude_material_id: sourceMaterialId,
      }),
    enabled: !!companyId && !!sourceMaterialId,
    select: rows,
  });
  const options = toComboOptions(optionsQ.data ?? [], materialOptionLabel);
  return (
    <ErpComboboxField
      className="text-xs"
      inputClassName="h-8"
      placeholder="Target SKU"
      value={value}
      options={options}
      onChange={(nextValue) =>
        onChange(
          nextValue,
          (optionsQ.data ?? []).find((row) => row.id === nextValue) ?? null,
        )}
    />
  );
}

export default function SO05CreatePage() {
  const qc = useQueryClient();
  const { runtimeContext, allowedRoutes } = useMenu();
  const canManageTransporters = isRouteAllowed(
    allowedRoutes ?? new Set(),
    "/dashboard/procurement/masters/transporters",
  );
  const canManageCustomers = isRouteAllowed(
    allowedRoutes ?? new Set(),
    "/dashboard/om/customers",
  );
  const companies = useMemo(() => buildTransactionCompanyList(runtimeContext), [
    runtimeContext,
  ]);
  // Restored after a round trip to "Add to Transporter Master" (stashed by
  // handleAddTransporterToMaster below) -- see PROC_DO_EDIT's own comment on
  // this pattern for why a bare openScreen() would otherwise wipe the form.
  const _savedForm = getActiveScreenContext()?.so05FormValues?.form ?? null;
  const [form, setForm] = useState(_savedForm ?? {
    company_id: "",
    receipt_date: today(),
    return_type: "DEPENDENT_DIRECT",
    sending_parent_company_id: "",
    sending_vdc_id: "",
    sending_depot_id: "",
    sending_customer_id: "",
    sending_customer_address_id: "",
    sending_company_id: "",
    asian_side_choice: "NONE",
    vehicle_number: "",
    transporter_id: "",
    transporter_name_freetext: "",
    lr_number: "",
    lr_date: "",
    gross_weight: "",
    net_weight: "",
    driver_number: "",
    driver_contact_number: "",
    remarks: "",
    invoices: [emptyInvoice()],
  });
  const companyId = form.company_id ||
    resolveDefaultTransactionCompanyId(runtimeContext);
  useEffect(() => {
    if (!form.company_id && companyId) {
      setForm((current) => ({ ...current, company_id: companyId }));
    }
  }, [companyId, form.company_id]);

  const materialsQ = useQuery({
    queryKey: ["so05-materials"],
    queryFn: () => listMaterials({ limit: 1000 }),
    select: rows,
  });
  const locationsQ = useQuery({
    queryKey: ["so05-locations", companyId],
    queryFn: () =>
      listStorageLocations({ company_id: companyId, is_active: true }),
    enabled: !!companyId,
    select: rows,
  });
  const parentsQ = useQuery({
    queryKey: ["so05-parents"],
    queryFn: () => listFgParentCompanies({ status: "ACTIVE" }),
    select: rows,
  });
  const depotsQ = useQuery({
    queryKey: ["so05-depots", form.sending_parent_company_id],
    queryFn: () =>
      listFgDepotCodes({
        parent_company_id: form.sending_parent_company_id,
        status: "ACTIVE",
      }),
    enabled: !!form.sending_parent_company_id,
    select: rows,
  });
  const customersQ = useQuery({
    queryKey: ["so05-customers", companyId],
    queryFn: () =>
      listCustomers({ company_id: companyId, status: "ACTIVE", limit: 500 }),
    enabled: !!companyId,
    select: rows,
  });
  const addressesQ = useQuery({
    queryKey: ["so05-addresses", form.sending_customer_id],
    queryFn: () => listCustomerAddresses(form.sending_customer_id),
    enabled: !!form.sending_customer_id,
    select: rows,
  });
  // Used only to resolve the already-picked transporter's display name —
  // TransporterPicker below does its own live search for the picker UI.
  const transportersQ = useQuery({
    queryKey: ["so05-transporters", companyId],
    queryFn: () =>
      listTransporters({ company_id: companyId, status: "ACTIVE" }),
    enabled: !!companyId,
    select: rows,
  });
  const transporterName = useMemo(() => {
    const match = (transportersQ.data ?? []).find((row) =>
      row.id === form.transporter_id
    );
    return match
      ? `${match.transporter_code ?? ""} — ${match.transporter_name ?? ""}`
        .replace(/^— /, "").replace(/ —$/, "")
      : "";
  }, [transportersQ.data, form.transporter_id]);
  const locations = locationsQ.data ?? [];
  const materials = materialsQ.data ?? [];

  function handleAddTransporterToMaster() {
    updateActiveScreenContext({ so05FormValues: { form } });
    openScreen(OPERATION_SCREENS.PROC_TRANSPORTER_MASTER.screen_code);
  }

  function handleAddCustomerToMaster() {
    updateActiveScreenContext({ so05FormValues: { form } });
    openScreen(OPERATION_SCREENS.OM_CUSTOMER_LIST.screen_code);
  }

  const patchInvoice = (key, patch) =>
    setForm((current) => ({
      ...current,
      invoices: current.invoices.map((invoice) =>
        invoice.__key === key ? { ...invoice, ...patch } : invoice
      ),
    }));
  const patchItem = (invoiceKey, itemKey, patch) =>
    setForm((current) => ({
      ...current,
      invoices: current.invoices.map((invoice) =>
        invoice.__key !== invoiceKey ? invoice : {
          ...invoice,
          items: invoice.items.map((item) =>
            item.__key === itemKey ? { ...item, ...patch } : item
          ),
        }
      ),
    }));
  const patchRepack = (invoiceKey, itemKey, repackKey, patch) =>
    setForm((current) => ({
      ...current,
      invoices: current.invoices.map((invoice) =>
        invoice.__key !== invoiceKey ? invoice : {
          ...invoice,
          items: invoice.items.map((item) =>
            item.__key !== itemKey ? item : {
              ...item,
              repack_lines: item.repack_lines.map((line) =>
                line.__key === repackKey ? { ...line, ...patch } : line
              ),
            }
          ),
        }
      ),
    }));

  const saveM = useMutation({
    mutationFn: () => createSalesReturn({ ...form, company_id: companyId }),
    onSuccess: (result) => {
      if (result?.requires_packing_order_selection) {
        setForm((current) => ({
          ...current,
          invoices: current.invoices.map((invoice, invoiceIndex) => {
            const ambiguities = result.ambiguous_items?.filter((row) =>
              row.invoice_index === invoiceIndex
            ) ?? [];
            if (ambiguities.length === 0) return invoice;
            return {
              ...invoice,
              items: invoice.items.map((item, index) => {
                const ambiguity = ambiguities.find((row) =>
                  row.line_number === index + 1
                );
                return ambiguity
                  ? { ...item, packing_choices: ambiguity.choices }
                  : item;
              }),
            };
          }),
        }));
        pushToast({
          tone: "warning",
          message:
            "More than one Packing PO matches. Select one on the highlighted item and save again.",
        });
        return;
      }
      qc.invalidateQueries({ queryKey: ["so05-list"] });
      qc.invalidateQueries({ queryKey: ["so05-pending-invoices"] });
      pushToast({
        tone: "success",
        message: `Sales Return ${
          result?.receipt_number ?? ""
        } posted to Blocked stock.`,
      });
      popScreen();
    },
    onError: (error) =>
      pushToast({
        tone: "error",
        message: error.message || "Sales Return could not be saved.",
      }),
  });

  const dependent = form.return_type.startsWith("DEPENDENT_");
  const independent = form.return_type.startsWith("INDEPENDENT_");
  const asian = form.return_type === "INDEPENDENT_PARTY_ASIAN_BILLED";
  const depotRows = (depotsQ.data ?? []).filter((row) =>
    !dependent ||
    String(row.dispatch_type).toUpperCase() ===
      (form.return_type === "DEPENDENT_DIRECT" ? "DIRECT" : "DEPOT")
  );
  const isDepotChoice = form.return_type === "DEPENDENT_DEPOT" ||
    form.asian_side_choice === "DC";
  const selectedDepotOrVdcId = isDepotChoice
    ? form.sending_depot_id
    : form.sending_vdc_id;
  // business owner, 2026-09-26: once a VDC/Depot is picked, the Customer and
  // Customer Address fields must come from THAT location's own mapped
  // addresses (erp_master.customer_address.depot_code_id), not the
  // company-wide customer list the Independent flow uses -- a Dependent
  // return only ever comes from a customer already sitting under that VDC.
  const dependentAddressesQ = useQuery({
    queryKey: ["so05-dependent-addresses", selectedDepotOrVdcId],
    queryFn: () => listCustomerAddressesByDepot(selectedDepotOrVdcId),
    enabled: !!selectedDepotOrVdcId,
    select: rows,
  });
  const dependentCustomerOptions = useMemo(() => {
    const seen = new Map();
    for (const row of dependentAddressesQ.data ?? []) {
      if (!row.customer_id || seen.has(row.customer_id)) continue;
      seen.set(row.customer_id, {
        value: row.customer_id,
        label: [row.customer_code, row.customer_name].filter(Boolean).join(
          " — ",
        ),
      });
    }
    return [...seen.values()];
  }, [dependentAddressesQ.data]);
  const dependentAddressOptions = useMemo(() =>
    (dependentAddressesQ.data ?? [])
      .filter((row) => row.customer_id === form.sending_customer_id)
      .map((row) => ({
        value: row.id,
        label: [row.site_name, row.address_line, row.town].filter(Boolean)
          .join(" — "),
      })), [dependentAddressesQ.data, form.sending_customer_id]);

  // business owner, 2026-09-26: this table must be an ErpDenseGrid, like
  // every other editable line-item grid in the app (POCreatePage.jsx's
  // lineColumns, SO01CreatePage.jsx's line columns) -- not a hand-rolled
  // <table>. Each column's render(item) receives the row directly, since
  // rows={invoice.items} passes items straight through.
  function itemColumns(invoice) {
    return [
      {
        key: "line_material_type",
        label: "Type",
        width: "90px",
        render: (item) => (
          <ErpComboboxField
            inputClassName="rounded px-1.5 py-1"
            hideBlank
            value={item.line_material_type}
            options={MATERIAL_TYPES.map((value) => ({ value, label: value }))}
            onChange={(value) =>
              patchItem(invoice.__key, item.__key, {
                line_material_type: value,
              })}
          />
        ),
      },
      {
        key: "fg_type",
        label: "FG Type",
        width: "90px",
        render: (item) => (
          <ErpComboboxField
            inputClassName="rounded px-1.5 py-1"
            disabled={!["FG", "SFG"].includes(item.line_material_type)}
            hideBlank
            value={item.fg_type}
            options={FG_TYPES.map((value) => ({ value, label: value }))}
            onChange={(value) =>
              patchItem(invoice.__key, item.__key, { fg_type: value })}
          />
        ),
      },
      {
        key: "material_id",
        label: "Material",
        width: "240px",
        render: (item) => (
          <ErpComboboxField
            inputClassName="rounded px-1.5 py-1"
            placeholder="Select material"
            value={item.material_id}
            options={toComboOptions(
              materials.filter((row) =>
                String(row.material_type).toUpperCase() ===
                  item.line_material_type
              ),
              materialOptionLabel,
            )}
            onChange={(value) =>
              patchItem(invoice.__key, item.__key, { material_id: value })}
          />
        ),
      },
      {
        key: "declared_stroke_number",
        label: "Stroke",
        width: "150px",
        render: (item) => (
          <StrokeNumberField
            companyId={companyId}
            item={item}
            onChange={(value) =>
              patchItem(invoice.__key, item.__key, {
                declared_stroke_number: value,
              })}
          />
        ),
      },
      {
        key: "batch_number",
        label: "Batch",
        width: "150px",
        render: (item) => (
          <BatchNumberField
            companyId={companyId}
            item={item}
            onChange={(value) =>
              patchItem(invoice.__key, item.__key, { batch_number: value })}
          />
        ),
      },
      {
        key: "num_packs",
        label: "Packs",
        width: "90px",
        render: (item) => (
          <input
            type="number"
            className={input}
            value={item.num_packs}
            onChange={(e) =>
              patchItem(invoice.__key, item.__key, {
                num_packs: e.target.value,
                quantity: Number(e.target.value) *
                    Number(item.per_pack_qty || 0) || item.quantity,
              })}
          />
        ),
      },
      {
        key: "per_pack_qty",
        label: "Per Pack",
        width: "90px",
        render: (item) => (
          <input
            type="number"
            className={input}
            value={item.per_pack_qty}
            onChange={(e) =>
              patchItem(invoice.__key, item.__key, {
                per_pack_qty: e.target.value,
                quantity: Number(item.num_packs || 0) *
                    Number(e.target.value) || item.quantity,
              })}
          />
        ),
      },
      {
        key: "quantity",
        label: "Qty",
        width: "100px",
        render: (item) => {
          const derivedQty = Number(item.num_packs) > 0 &&
              Number(item.per_pack_qty) > 0
            ? String(Number(item.num_packs) * Number(item.per_pack_qty))
            : item.quantity;
          return (
            <input
              type="number"
              className={input}
              value={derivedQty}
              onChange={(e) =>
                patchItem(invoice.__key, item.__key, {
                  quantity: e.target.value,
                })}
            />
          );
        },
      },
      {
        key: "storage_location_id",
        label: "Storage Location",
        width: "220px",
        render: (item) => (
          <ErpComboboxField
            inputClassName="rounded px-1.5 py-1"
            placeholder="Select receiving location"
            value={item.storage_location_id}
            options={toComboOptions(locations)}
            onChange={(value) =>
              patchItem(invoice.__key, item.__key, {
                storage_location_id: value,
              })}
          />
        ),
      },
      {
        key: "is_repacked",
        label: "Repack",
        width: "70px",
        align: "center",
        render: (item) => (
          <input
            type="checkbox"
            checked={item.is_repacked}
            onChange={(e) =>
              patchItem(invoice.__key, item.__key, {
                is_repacked: e.target.checked,
                repack_lines: e.target.checked && !item.repack_lines.length
                  ? [emptyRepack()]
                  : item.repack_lines,
              })}
          />
        ),
      },
      {
        key: "actions",
        label: "",
        width: "50px",
        render: (item) => (
          <button
            className="text-rose-600"
            onClick={() =>
              patchInvoice(invoice.__key, {
                items: invoice.items.filter((row) =>
                  row.__key !== item.__key
                ),
              })}
          >
            ×
          </button>
        ),
      },
    ];
  }

  return (
    <ErpScreenScaffold
      title="Create Sales Return"
      eyebrow="SO05"
      subtitle="Capture the sender, invoice and item details, then post P651 into Blocked stock."
      actions={[{
        label: "Back to list",
        tone: "neutral",
        onClick: () => popScreen(),
      }]}
    >
      <ErpSectionCard title="Page 1 · Sending location and transporter">
        <div className="grid gap-3 md:grid-cols-3">
          <TransactionCompanySelector
            value={companyId}
            onChange={(value) =>
              setForm((current) => ({ ...current, company_id: value }))}
            runtimeContext={runtimeContext}
            label="Receiving Company"
          />
          <label className="text-xs text-slate-600">
            Receipt Date<input
              type="date"
              className={input}
              value={form.receipt_date}
              onChange={(event) =>
                setForm({ ...form, receipt_date: event.target.value })}
            />
          </label>
          <label className="text-xs text-slate-600">
            Return Type
            <ErpComboboxField
              inputClassName="rounded px-2 py-1.5 text-sm"
              hideBlank
              value={form.return_type}
              options={TYPES.map(([value, label]) => ({ value, label }))}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  return_type: value,
                  sending_parent_company_id: "",
                  sending_vdc_id: "",
                  sending_depot_id: "",
                  sending_customer_id: "",
                  sending_customer_address_id: "",
                  sending_company_id: "",
                }))}
            />
          </label>
          {form.return_type === "STO" && (
            <label className="text-xs text-slate-600">
              Sending Company
              <ErpComboboxField
                inputClassName="rounded px-2 py-1.5 text-sm"
                placeholder="Select company"
                value={form.sending_company_id}
                options={toComboOptions(
                  companies.filter((row) => row.id !== companyId),
                )}
                onChange={(value) =>
                  setForm({ ...form, sending_company_id: value })}
              />
            </label>
          )}
          {(dependent || asian) && (
            <label className="text-xs text-slate-600">
              Parent Company
              <ErpComboboxField
                inputClassName="rounded px-2 py-1.5 text-sm"
                placeholder="Select parent"
                value={form.sending_parent_company_id}
                options={(parentsQ.data ?? []).map((row) => ({
                  value: row.id,
                  label: row.company_name,
                }))}
                onChange={(value) =>
                  setForm({
                    ...form,
                    sending_parent_company_id: value,
                    sending_vdc_id: "",
                    sending_depot_id: "",
                    sending_customer_id: "",
                    sending_customer_address_id: "",
                  })}
              />
            </label>
          )}
          {independent && (
            <>
              <label className="text-xs text-slate-600">
                Customer
                <ErpComboboxField
                  inputClassName="rounded px-2 py-1.5 text-sm"
                  placeholder="Select customer"
                  value={form.sending_customer_id}
                  options={toComboOptions(customersQ.data ?? [])}
                  onChange={(value) =>
                    setForm({
                      ...form,
                      sending_customer_id: value,
                      sending_customer_address_id: "",
                    })}
                />
              </label>
              <label className="text-xs text-slate-600">
                Customer Address
                <ErpComboboxField
                  inputClassName="rounded px-2 py-1.5 text-sm"
                  placeholder="Select address"
                  disabled={!form.sending_customer_id}
                  value={form.sending_customer_address_id}
                  options={(addressesQ.data ?? []).map((row) => ({
                    value: row.id,
                    label: [row.site_name, row.address_line, row.town].filter(
                      Boolean,
                    ).join(" — "),
                  }))}
                  onChange={(value) =>
                    setForm({ ...form, sending_customer_address_id: value })}
                />
              </label>
            </>
          )}
          {asian && (
            <label className="text-xs text-slate-600">
              Asian-side Location
              <ErpComboboxField
                inputClassName="rounded px-2 py-1.5 text-sm"
                hideBlank
                value={form.asian_side_choice}
                options={[
                  { value: "NONE", label: "Parent Company" },
                  { value: "VDC", label: "VDC" },
                  { value: "DC", label: "Depot" },
                ]}
                onChange={(value) =>
                  setForm({
                    ...form,
                    asian_side_choice: value,
                    sending_vdc_id: "",
                    sending_depot_id: "",
                    sending_customer_id: "",
                    sending_customer_address_id: "",
                  })}
              />
            </label>
          )}
          {(dependent || (asian && form.asian_side_choice !== "NONE")) && (
            <label className="text-xs text-slate-600">
              {isDepotChoice ? "Depot" : "VDC"}
              <ErpComboboxField
                inputClassName="rounded px-2 py-1.5 text-sm"
                placeholder="Select location"
                value={selectedDepotOrVdcId}
                options={toComboOptions(depotRows)}
                onChange={(value) =>
                  setForm({
                    ...form,
                    [isDepotChoice ? "sending_depot_id" : "sending_vdc_id"]:
                      value,
                    sending_customer_id: "",
                    sending_customer_address_id: "",
                  })}
              />
            </label>
          )}
          {(dependent || (asian && form.asian_side_choice !== "NONE")) &&
            selectedDepotOrVdcId && (
            <>
              <label className="text-xs text-slate-600">
                Customer (under this {isDepotChoice ? "Depot" : "VDC"})
                <ErpComboboxField
                  inputClassName="rounded px-2 py-1.5 text-sm"
                  placeholder="Select customer"
                  value={form.sending_customer_id}
                  options={dependentCustomerOptions}
                  emptyStateLabel="No customer mapped to this location yet."
                  onChange={(value) =>
                    setForm({
                      ...form,
                      sending_customer_id: value,
                      sending_customer_address_id: "",
                    })}
                />
                {canManageCustomers && (
                  <button
                    type="button"
                    onClick={handleAddCustomerToMaster}
                    className="mt-1 block text-[11px] text-sky-600 underline"
                  >
                    Not listed? Add in Customer Master →
                  </button>
                )}
              </label>
              <label className="text-xs text-slate-600">
                Customer Address
                <ErpComboboxField
                  inputClassName="rounded px-2 py-1.5 text-sm"
                  placeholder="Select address"
                  disabled={!form.sending_customer_id}
                  value={form.sending_customer_address_id}
                  options={dependentAddressOptions}
                  onChange={(value) =>
                    setForm({ ...form, sending_customer_address_id: value })}
                />
              </label>
            </>
          )}
          <label className="text-xs text-slate-600">
            Transporter
            <TransporterPicker
              transporterId={form.transporter_id}
              transporterName={transporterName}
              companyId={companyId}
              canManageTransporters={canManageTransporters}
              onAddNew={handleAddTransporterToMaster}
              onSelect={(t) =>
                setForm({
                  ...form,
                  transporter_id: t.id,
                  transporter_name_freetext: "",
                })}
              onClear={() => setForm({ ...form, transporter_id: "" })}
            />
          </label>
          <label className="text-xs text-slate-600">
            Transporter Free Text<input
              className={input}
              value={form.transporter_name_freetext}
              onChange={(e) =>
                setForm({ ...form, transporter_name_freetext: e.target.value })}
            />
          </label>
          {[
            ["vehicle_number", "Vehicle No."],
            ["lr_number", "LR No."],
            ["lr_date", "LR Date"],
            ["gross_weight", "Gross Weight"],
            ["net_weight", "Net Weight"],
            ["driver_number", "Driver No."],
            ["driver_contact_number", "Driver Contact"],
          ].map(([key, label]) => (
            <label key={key} className="text-xs text-slate-600">
              {label}
              <input
                type={key.includes("date")
                  ? "date"
                  : key.includes("weight")
                  ? "number"
                  : "text"}
                className={input}
                value={form[key]}
                onChange={(e) =>
                  setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
      </ErpSectionCard>

      <ErpSectionCard title="Page 2 · Invoices and material rows">
        <div className="space-y-5">
          {form.invoices.map((invoice, invoiceIndex) => (
            <div
              key={invoice.__key}
              className="border rounded-lg p-3 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">
                  Invoice {invoiceIndex + 1}
                </h3>
                <div className="flex gap-2">
                  <label className="text-xs">
                    <input
                      type="checkbox"
                      checked={invoice.tick_on}
                      onChange={(e) =>
                        patchInvoice(invoice.__key, {
                          tick_on: e.target.checked,
                        })}
                    />{" "}
                    Full details now
                  </label>
                  {form.invoices.length > 1 && (
                    <button
                      className="text-rose-600 text-xs"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          invoices: current.invoices.filter((row) =>
                            row.__key !== invoice.__key
                          ),
                        }))}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-4">
                <label className="text-xs">
                  Invoice No.<input
                    className={input}
                    value={invoice.invoice_number}
                    onChange={(e) =>
                      patchInvoice(invoice.__key, {
                        invoice_number: e.target.value,
                      })}
                  />
                </label>
                {invoice.tick_on
                  ? (
                    <>
                      <label className="text-xs">
                        Invoice Date<input
                          type="date"
                          className={input}
                          value={invoice.invoice_date}
                          onChange={(e) =>
                            patchInvoice(invoice.__key, {
                              invoice_date: e.target.value,
                            })}
                        />
                      </label>
                      <label className="text-xs">
                        Amount<input
                          type="number"
                          className={input}
                          value={invoice.amount}
                          onChange={(e) =>
                            patchInvoice(invoice.__key, {
                              amount: e.target.value,
                            })}
                        />
                      </label>
                      <label className="text-xs">
                        Freight
                        <ErpComboboxField
                          inputClassName="rounded px-2 py-1.5 text-sm"
                          hideBlank
                          value={invoice.freight_term}
                          options={[
                            { value: "FOR", label: "FOR" },
                            { value: "TO_PAY", label: "TO_PAY" },
                          ]}
                          onChange={(value) =>
                            patchInvoice(invoice.__key, {
                              freight_term: value,
                            })}
                        />
                      </label>
                    </>
                  )
                  : (
                    <label className="text-xs">
                      Reference Document<input
                        className={input}
                        value={invoice.reference_document_number}
                        onChange={(e) =>
                          patchInvoice(invoice.__key, {
                            reference_document_number: e.target.value,
                          })}
                      />
                    </label>
                  )}
              </div>
              <ErpDenseGrid
                columns={itemColumns(invoice)}
                rows={invoice.items}
                rowKey={(item) => item.__key}
                maxHeight="none"
                emptyMessage="No material rows yet — click Add material row."
              />
              {invoice.items.filter((item) =>
                item.packing_choices?.length > 0 || item.is_repacked
              ).map((item) => {
                const derivedQty = Number(item.num_packs) > 0 &&
                    Number(item.per_pack_qty) > 0
                  ? String(
                    Number(item.num_packs) * Number(item.per_pack_qty),
                  )
                  : item.quantity;
                return (
                  <div key={item.__key} className="space-y-2">
                    {item.packing_choices?.length > 0 && (
                      <div className="border border-amber-300 bg-amber-50 p-2 text-xs">
                        <label>
                          <strong>{materialOptionLabel(
                            materials.find((row) =>
                              row.id === item.material_id
                            ) ?? {},
                          ) || "This item"}</strong> — Select Packing PO:{" "}
                          <ErpComboboxField
                            className="inline-block w-64"
                            inputClassName="rounded px-2 py-1"
                            placeholder="Choose matching PO"
                            value={item.packing_order_id}
                            options={item.packing_choices.map((row) => ({
                              value: row.id,
                              label: row.po_number,
                            }))}
                            onChange={(value) =>
                              patchItem(invoice.__key, item.__key, {
                                packing_order_id: value,
                              })}
                          />
                        </label>
                      </div>
                    )}
                    {item.is_repacked && (
                      <div className="border border-indigo-300 bg-indigo-50 p-2 text-xs space-y-2">
                        <div className="flex justify-between">
                          <strong>
                            {materialOptionLabel(
                              materials.find((row) =>
                                row.id === item.material_id
                              ) ?? {},
                            ) || "This item"} — Repack targets, total must
                            equal {derivedQty || 0}
                          </strong>
                          <button
                            className="text-indigo-700"
                            onClick={() =>
                              patchItem(invoice.__key, item.__key, {
                                repack_lines: [
                                  ...item.repack_lines,
                                  emptyRepack(),
                                ],
                              })}
                          >
                            Add target
                          </button>
                        </div>
                        {item.repack_lines.map((line) => (
                          <div
                            key={line.__key}
                            className="grid md:grid-cols-5 gap-2"
                          >
                            <RepackTargetSelect
                              companyId={companyId}
                              sourceMaterialId={item.material_id}
                              value={line.target_material_id}
                              onChange={(value, selected) => {
                                const fixedBom = selected
                                  ?.pack_config?.pack_code
                                  ?.bom_required === true;
                                const perPackQty = fixedBom
                                  ? selected.pack_config?.fill_qty ??
                                    ""
                                  : "";
                                patchRepack(
                                  invoice.__key,
                                  item.__key,
                                  line.__key,
                                  {
                                    target_material_id: value,
                                    per_pack_qty: perPackQty,
                                    per_pack_readonly: fixedBom,
                                    quantity: fixedBom
                                      ? Number(line.num_packs || 0) *
                                        Number(perPackQty || 0)
                                      : line.quantity,
                                  },
                                );
                              }}
                            />
                            <input
                              type="number"
                              className={input}
                              placeholder="Packs"
                              value={line.num_packs}
                              onChange={(e) =>
                                patchRepack(
                                  invoice.__key,
                                  item.__key,
                                  line.__key,
                                  { num_packs: e.target.value },
                                )}
                            />
                            <input
                              type="number"
                              className={input}
                              placeholder="Per pack"
                              value={line.per_pack_qty}
                              readOnly={line.per_pack_readonly}
                              title={line.per_pack_readonly
                                ? "Fixed by the selected pack BOM"
                                : undefined}
                              onChange={(e) =>
                                patchRepack(
                                  invoice.__key,
                                  item.__key,
                                  line.__key,
                                  {
                                    per_pack_qty: e.target.value,
                                    quantity:
                                      Number(line.num_packs || 0) *
                                        Number(e.target.value) ||
                                      line.quantity,
                                  },
                                )}
                            />
                            <input
                              type="number"
                              className={input}
                              placeholder="Quantity"
                              value={line.quantity}
                              onChange={(e) =>
                                patchRepack(
                                  invoice.__key,
                                  item.__key,
                                  line.__key,
                                  { quantity: e.target.value },
                                )}
                            />
                            <ErpComboboxField
                              inputClassName="rounded px-1.5 py-1"
                              placeholder="Receiving location"
                              value={line.storage_location_id}
                              options={toComboOptions(locations)}
                              onChange={(value) =>
                                patchRepack(
                                  invoice.__key,
                                  item.__key,
                                  line.__key,
                                  { storage_location_id: value },
                                )}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                className="border rounded px-2 py-1 text-xs"
                onClick={() =>
                  patchInvoice(invoice.__key, {
                    items: [...invoice.items, emptyItem()],
                  })}
              >
                Add material row
              </button>
            </div>
          ))}
        </div>
        <button
          className="mt-3 border rounded px-3 py-1.5 text-sm"
          onClick={() =>
            setForm((current) => ({
              ...current,
              invoices: [...current.invoices, emptyInvoice()],
            }))}
        >
          Add invoice
        </button>
      </ErpSectionCard>
      <div className="flex justify-end">
        <button
          disabled={saveM.isPending}
          onClick={() => saveM.mutate()}
          className="bg-indigo-600 text-white rounded px-5 py-2 disabled:opacity-50"
        >
          {saveM.isPending ? "Saving & posting…" : "Save & Post Return"}
        </button>
      </div>
    </ErpScreenScaffold>
  );
}
