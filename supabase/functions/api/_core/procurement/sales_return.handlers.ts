/*
 * SO05 Sales Return — receipt, blocked-stock posting, deferred invoice detail,
 * and the PR01/PR22/PR23 pending queues (feasibility §134).
 */
import type { ContextResolution } from "../../_pipeline/context.ts";
import { serviceRoleClient } from "../../_shared/serviceRoleClient.ts";
import { generateMaterialDocNumber } from "../../_shared/materialDocument.ts";
import { todayIsoInKolkata } from "../../_shared/dateUtils.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { fetchInChunks } from "../../_shared/chunkedIn.ts";
import { errorResponse, okResponse } from "../response.ts";

type JsonRecord = Record<string, unknown>;
type Ctx = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

const RETURN_TYPES = new Set([
  "DEPENDENT_DIRECT",
  "DEPENDENT_DEPOT",
  "INDEPENDENT_PARTY",
  "INDEPENDENT_PARTY_ASIAN_BILLED",
  "STO",
]);
const MATERIAL_TYPES = new Set(["RM", "PM", "INT", "SFG", "FG"]);
const FG_TYPES = new Set(["MTO", "HPS", "MTEST", "MTS"]);
const BATCH_REQUIRED = new Set(["MTO", "HPS", "MTEST"]);
const text = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => text(value).toUpperCase();
const positive = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};
const fail = (
  req: Request,
  ctx: Ctx,
  code: string,
  status = 400,
  message = code,
) => errorResponse(code, message, ctx.request_id, "NONE", status, {}, req);
const parseBody = async (req: Request): Promise<JsonRecord> =>
  await req.json().catch(() => ({}));

async function requireCompany(ctx: Ctx, companyId: string): Promise<void> {
  await assertCompanyScope(ctx, companyId);
}

async function nextReceiptNumber(): Promise<string> {
  const { data, error } = await serviceRoleClient.schema("erp_procurement")
    .rpc("generate_doc_number", { p_doc_type: "SRET" });
  if (error || !data) throw new Error("SRET_NUMBER_FAILED");
  return String(data);
}

async function resolveSenderSnapshot(
  payload: JsonRecord,
  returnType: string,
): Promise<JsonRecord> {
  if (returnType === "STO") {
    const sendingCompanyId = text(payload.sending_company_id);
    if (!sendingCompanyId) throw new Error("SRET_SENDING_COMPANY_REQUIRED");
    const { data, error } = await serviceRoleClient.schema("erp_master").from(
      "companies",
    )
      .select("id, company_name, full_address, state_name, gst_number")
      .eq("id", sendingCompanyId).maybeSingle();
    if (error || !data) throw new Error("SRET_SENDING_COMPANY_NOT_FOUND");
    return {
      sending_company_id: sendingCompanyId,
      sending_name: text(data.company_name) || null,
      sending_address: text(data.full_address) || null,
      sending_state: text(data.state_name) || null,
      sending_gst_number: text(data.gst_number) || null,
    };
  }

  if (
    returnType === "INDEPENDENT_PARTY" ||
    returnType === "INDEPENDENT_PARTY_ASIAN_BILLED"
  ) {
    const customerId = text(payload.sending_customer_id);
    const addressId = text(payload.sending_customer_address_id);
    if (!customerId || !addressId) {
      throw new Error("SRET_CUSTOMER_ADDRESS_REQUIRED");
    }
    const [
      { data: address, error: addressError },
      { data: customer, error: customerError },
    ] = await Promise.all([
      serviceRoleClient.schema("erp_master").from("customer_address")
        .select(
          "id, customer_id, site_name, address_line, town, state, pin_code, status",
        )
        .eq("id", addressId).eq("status", "ACTIVE").maybeSingle(),
      serviceRoleClient.schema("erp_master").from("customer_master")
        .select("id, customer_name, gst_number").eq("id", customerId)
        .maybeSingle(),
    ]);
    if (
      addressError || customerError || !address || !customer ||
      text(address.customer_id) !== customerId
    ) {
      throw new Error("SRET_CUSTOMER_ADDRESS_NOT_FOUND");
    }
    const snapshot: JsonRecord = {
      sending_customer_id: customerId,
      sending_customer_address_id: addressId,
      sending_name: text(customer.customer_name) || text(address.site_name) ||
        null,
      sending_address:
        [text(address.address_line), text(address.town), text(address.pin_code)]
          .filter(Boolean).join(", ") || null,
      sending_state: text(address.state) || null,
      sending_gst_number: text(customer.gst_number) || null,
    };
    if (returnType === "INDEPENDENT_PARTY_ASIAN_BILLED") {
      const choice = upper(payload.asian_side_choice);
      if (!["VDC", "DC", "NONE"].includes(choice)) {
        throw new Error("SRET_ASIAN_SIDE_CHOICE_REQUIRED");
      }
      const parentId = text(payload.sending_parent_company_id);
      if (!parentId) throw new Error("SRET_PARENT_COMPANY_REQUIRED");
      const { data: parent, error: parentError } = await serviceRoleClient
        .schema("erp_master").from("fg_parent_company")
        .select("id, company_name, full_address, state, gst_number").eq(
          "id",
          parentId,
        ).maybeSingle();
      if (parentError || !parent) {
        throw new Error("SRET_PARENT_COMPANY_NOT_FOUND");
      }
      let asianParty: JsonRecord = parent as JsonRecord;
      if (choice !== "NONE") {
        const depotId = text(
          choice === "VDC" ? payload.sending_vdc_id : payload.sending_depot_id,
        );
        if (!depotId) throw new Error("SRET_ASIAN_SIDE_LOCATION_REQUIRED");
        const { data: depot, error } = await serviceRoleClient.schema(
          "erp_master",
        ).from("fg_depot_code")
          .select(
            "id, parent_company_id, dispatch_type, code, description, address_line, state, gst_number",
          )
          .eq("id", depotId).maybeSingle();
        if (
          error || !depot || text(depot.parent_company_id) !== parentId ||
          upper(depot.dispatch_type) !== (choice === "VDC" ? "DIRECT" : "DEPOT")
        ) {
          throw new Error("SRET_ASIAN_SIDE_LOCATION_INVALID");
        }
        asianParty = depot as JsonRecord;
      }
      Object.assign(snapshot, {
        sending_parent_company_id: parentId,
        sending_vdc_id: choice === "VDC" ? text(payload.sending_vdc_id) : null,
        sending_depot_id: choice === "DC"
          ? text(payload.sending_depot_id)
          : null,
        asian_side_choice: choice,
        asian_side_name: choice === "NONE"
          ? text(asianParty.company_name)
          : text(asianParty.description) || text(asianParty.code),
        asian_side_address: choice === "NONE"
          ? text(asianParty.full_address)
          : text(asianParty.address_line),
        asian_side_state: text(asianParty.state) || null,
        asian_side_gst_number: text(asianParty.gst_number) || null,
      });
    }
    return snapshot;
  }

  const parentId = text(payload.sending_parent_company_id);
  const depotId = text(
    returnType === "DEPENDENT_DIRECT"
      ? payload.sending_vdc_id
      : payload.sending_depot_id,
  );
  if (!parentId || !depotId) {
    throw new Error("SRET_DEPENDENT_LOCATION_REQUIRED");
  }
  const { data: depot, error } = await serviceRoleClient.schema("erp_master")
    .from("fg_depot_code")
    .select(
      "id, parent_company_id, dispatch_type, code, description, address_line, state, gst_number",
    )
    .eq("id", depotId).maybeSingle();
  const expectedType = returnType === "DEPENDENT_DIRECT" ? "DIRECT" : "DEPOT";
  if (
    error || !depot || text(depot.parent_company_id) !== parentId ||
    upper(depot.dispatch_type) !== expectedType
  ) {
    throw new Error("SRET_DEPENDENT_LOCATION_INVALID");
  }
  const snapshot: JsonRecord = {
    sending_parent_company_id: parentId,
    sending_vdc_id: returnType === "DEPENDENT_DIRECT" ? depotId : null,
    sending_depot_id: returnType === "DEPENDENT_DEPOT" ? depotId : null,
    sending_name: text(depot.description) || text(depot.code) || null,
    sending_address: text(depot.address_line) || null,
    sending_state: text(depot.state) || null,
    sending_gst_number: text(depot.gst_number) || null,
  };

  // business owner, 2026-09-26: the SO05 UI now lets the user pick which
  // specific customer (and site address) under this VDC/Depot the return is
  // actually coming from -- both optional (a Dependent return's sender-of-
  // record was, and remains, the VDC/Depot itself). When given, record the
  // customer/address as the actual sending site (more specific than the
  // depot's own generic description/address) and reject an address that
  // doesn't belong to the selected VDC/Depot, mirroring the existing
  // depot-scope check so_map.handlers.ts already does for the same table.
  const customerId = text(payload.sending_customer_id);
  const addressId = text(payload.sending_customer_address_id);
  if (customerId || addressId) {
    if (!customerId || !addressId) {
      throw new Error("SRET_CUSTOMER_ADDRESS_REQUIRED");
    }
    const [
      { data: address, error: addressError },
      { data: customer, error: customerError },
    ] = await Promise.all([
      serviceRoleClient.schema("erp_master").from("customer_address")
        .select("id, customer_id, depot_code_id, site_name, address_line, town, state, pin_code, status")
        .eq("id", addressId).eq("status", "ACTIVE").maybeSingle(),
      serviceRoleClient.schema("erp_master").from("customer_master")
        .select("id, customer_name, gst_number").eq("id", customerId)
        .maybeSingle(),
    ]);
    if (
      addressError || customerError || !address || !customer ||
      text(address.customer_id) !== customerId ||
      text(address.depot_code_id) !== depotId
    ) {
      throw new Error("SRET_CUSTOMER_ADDRESS_NOT_FOUND");
    }
    Object.assign(snapshot, {
      sending_customer_id: customerId,
      sending_customer_address_id: addressId,
      sending_name: text(customer.customer_name) || text(address.site_name) ||
        snapshot.sending_name,
      sending_address:
        [text(address.address_line), text(address.town), text(address.pin_code)]
          .filter(Boolean).join(", ") || snapshot.sending_address,
      sending_state: text(address.state) || snapshot.sending_state,
      sending_gst_number: text(customer.gst_number) || snapshot.sending_gst_number,
    });
  }

  return snapshot;
}

async function validateStorageLocation(
  companyId: string,
  locationId: string,
): Promise<void> {
  const { data: mapping, error: mappingError } = await serviceRoleClient.schema(
    "erp_inventory",
  ).from(
    "storage_location_plant_map",
  ).select("storage_location_id").eq("storage_location_id", locationId)
    .eq("company_id", companyId).eq("active", true).maybeSingle();
  if (mappingError || !mapping) {
    throw new Error("SRET_STORAGE_LOCATION_INVALID");
  }
  const { data: location, error: locationError } = await serviceRoleClient
    .schema("erp_inventory").from(
      "storage_location_master",
    ).select("id").eq("id", locationId).eq("active", true).maybeSingle();
  if (locationError || !location) {
    throw new Error("SRET_STORAGE_LOCATION_INVALID");
  }
}

// FG material_id is the sellable SKU; process_order.material_id is its
// Prodshade. Resolve that relationship through the active pack config instead
// of comparing an FG SKU directly with a Process PO's SFG material.
async function deriveProdshadeMaterialId(materialId: string): Promise<string> {
  const { data: sku, error: skuError } = await serviceRoleClient.schema(
    "erp_master",
  ).from("material_master")
    .select("id, material_type, external_code, material_name, pack_code").eq(
      "id",
      materialId,
    ).maybeSingle();
  if (skuError || !sku) throw new Error("SRET_MATERIAL_LOOKUP_FAILED");
  if (upper(sku.material_type) !== "FG") return materialId;
  const packCode = text(sku.pack_code);
  const skuCode = upper(sku.external_code || sku.material_name);
  if (!packCode || !skuCode) return materialId;
  const { data: pack, error: packError } = await serviceRoleClient.schema(
    "erp_production",
  ).from("pack_code_master")
    .select("id").eq("pack_code", packCode).eq("active", true).maybeSingle();
  if (packError || !pack) return materialId;
  const { data: configs, error: configError } = await serviceRoleClient.schema(
    "erp_production",
  ).from("prodshade_pack_config")
    .select("material_id").eq("pack_code_id", pack.id).eq("active", true);
  if (configError || !configs?.length) return materialId;
  const candidateIds = [
    ...new Set(
      (configs as JsonRecord[]).map((row) => text(row.material_id)).filter(
        Boolean,
      ),
    ),
  ];
  const { data: candidates, error: candidateError } = await serviceRoleClient
    .schema("erp_master").from("material_master")
    .select("id, external_code, material_name").in("id", candidateIds);
  if (candidateError) throw new Error("SRET_MATERIAL_LOOKUP_FAILED");
  const match = (candidates as JsonRecord[] | null)?.find((row) =>
    `${upper(row.external_code || row.material_name)}${upper(packCode)}` ===
      skuCode
  );
  return text(match?.id) || materialId;
}

async function deriveProdshadeMap(materialIds: string[]): Promise<{
  prodshadeByMaterial: Map<string, string>;
  materialById: Map<string, JsonRecord>;
}> {
  const ids = [...new Set(materialIds.map(text).filter(Boolean))];
  if (!ids.length) {
    return { prodshadeByMaterial: new Map(), materialById: new Map() };
  }
  const materials = await fetchInChunks<JsonRecord>(
    ids,
    (chunk) =>
      serviceRoleClient.schema("erp_master").from("material_master")
        .select(
          "id, material_type, pace_code, external_code, material_name, pack_code",
        ).in("id", chunk),
  );
  const materialById = new Map(materials.map((row) => [text(row.id), row]));
  const prodshadeByMaterial = new Map<string, string>();
  for (const material of materials) {
    if (upper(material.material_type) !== "FG") {
      prodshadeByMaterial.set(text(material.id), text(material.id));
    }
  }
  const packCodes = [
    ...new Set(
      materials.filter((row) => upper(row.material_type) === "FG").map((row) =>
        text(row.pack_code)
      ).filter(Boolean),
    ),
  ];
  if (!packCodes.length) return { prodshadeByMaterial, materialById };
  const packRows = await fetchInChunks<JsonRecord>(
    packCodes,
    (chunk) =>
      serviceRoleClient.schema("erp_production").from("pack_code_master")
        .select("id, pack_code").in("pack_code", chunk).eq("active", true),
  );
  const packCodeById = new Map(
    packRows.map((row) => [text(row.id), upper(row.pack_code)]),
  );
  const configs = await fetchInChunks<JsonRecord>(
    [...packCodeById.keys()],
    (chunk) =>
      serviceRoleClient.schema("erp_production").from("prodshade_pack_config")
        .select("material_id, pack_code_id").in("pack_code_id", chunk).eq(
          "active",
          true,
        ),
  );
  const prodshadeIds = [
    ...new Set(configs.map((row) => text(row.material_id)).filter(Boolean)),
  ];
  const prodshades = prodshadeIds.length
    ? await fetchInChunks<JsonRecord>(
      prodshadeIds,
      (chunk) =>
        serviceRoleClient.schema("erp_master").from("material_master")
          .select("id, pace_code, external_code, material_name").in(
            "id",
            chunk,
          ),
    )
    : [];
  for (const row of prodshades) materialById.set(text(row.id), row);
  const prodshadeById = new Map(prodshades.map((row) => [text(row.id), row]));
  const prodshadeBySkuCode = new Map<string, string>();
  for (const config of configs) {
    const prodshade = prodshadeById.get(text(config.material_id));
    const packCode = packCodeById.get(text(config.pack_code_id));
    const prodshadeCode = upper(
      prodshade?.external_code || prodshade?.material_name,
    );
    if (prodshadeCode && packCode) {
      prodshadeBySkuCode.set(
        `${prodshadeCode}${packCode}`,
        text(config.material_id),
      );
    }
  }
  for (const material of materials) {
    if (upper(material.material_type) !== "FG") continue;
    const prodshadeId = prodshadeBySkuCode.get(
      upper(material.external_code || material.material_name),
    );
    if (prodshadeId) prodshadeByMaterial.set(text(material.id), prodshadeId);
  }
  return { prodshadeByMaterial, materialById };
}

// business owner, 2026-09-26, found via live Prod check (CMP003): PR23
// (Old Packing PO) has always had backfill_sales_return_packing_order() to
// clear a pending sales_return_item once the matching genealogy record
// exists -- PR22 (Old Process PO) never got the equivalent. Confirmed live:
// two CMP003 items posted via SO05, both PR22'd (process_order rows
// 9300000503/9300000504, status VERIFIED, correct batch numbers) AND
// PR23'd (packing_order rows correctly linked via packing_order_id) --
// PR23's own pending count cleared correctly, but batch_resolved stayed
// false forever on both sales_return_item rows because nothing ever set it.
// Unlike the PACKING backfill (a straight SQL join, since packing_order and
// sales_return_item both key on the exact FG SKU material_id),
// process_order.material_id is the PRODSHADE, while sales_return_item's own
// material_id is the FG SKU for an FG line -- the derivation only exists in
// TypeScript (deriveProdshadeMap, right above), so this backfill has to run
// here rather than as a plpgsql function like PR23's.
export async function backfillSalesReturnBatchResolved(
  companyId: string,
  prodshadeMaterialId: string,
  batchNumber: string,
): Promise<number> {
  const normalizedBatch = text(batchNumber);
  const normalizedProdshade = text(prodshadeMaterialId);
  if (!companyId || !normalizedProdshade || !normalizedBatch) return 0;
  const { data: candidates, error } = await serviceRoleClient
    .schema("erp_procurement").from("sales_return_item")
    .select(
      "id, material_id, invoice:sales_return_invoice!inner(receipt:sales_return_receipt!inner(company_id))",
    )
    .eq("batch_resolved", false)
    .eq("batch_number", normalizedBatch)
    .eq("invoice.receipt.company_id", companyId);
  if (error) throw new Error("SRET_BATCH_RESOLVE_BACKFILL_FAILED");
  const rows = (candidates ?? []) as JsonRecord[];
  if (rows.length === 0) return 0;
  const { prodshadeByMaterial } = await deriveProdshadeMap(
    rows.map((row) => text(row.material_id)),
  );
  const matchingIds = rows
    .filter((row) => {
      const materialId = text(row.material_id);
      const resolvedProdshade = prodshadeByMaterial.get(materialId) ||
        materialId;
      return resolvedProdshade === normalizedProdshade;
    })
    .map((row) => text(row.id));
  if (matchingIds.length === 0) return 0;
  const { error: updateError } = await serviceRoleClient
    .schema("erp_procurement").from("sales_return_item")
    .update({ batch_resolved: true })
    .in("id", matchingIds);
  if (updateError) throw new Error("SRET_BATCH_RESOLVE_BACKFILL_FAILED");
  return matchingIds.length;
}

async function resolveBatchAndPacking(
  companyId: string,
  item: JsonRecord,
): Promise<
  {
    batchResolved: boolean;
    packingOrderId: string | null;
    choices: JsonRecord[];
  }
> {
  const materialId = text(item.material_id);
  const batchNumber = text(item.batch_number);
  const fgType = upper(item.fg_type);
  if (
    !materialId || !batchNumber ||
    !["FG", "SFG"].includes(upper(item.line_material_type))
  ) {
    return { batchResolved: false, packingOrderId: null, choices: [] };
  }
  const processMaterialId = await deriveProdshadeMaterialId(materialId);
  const { data: processes, error: processError } = await serviceRoleClient
    .schema("erp_production").from("process_order")
    .select("id").eq("company_id", companyId).eq(
      "material_id",
      processMaterialId,
    )
    .eq("batch_number", batchNumber).eq("po_type", fgType).limit(1);
  if (processError) throw new Error("SRET_BATCH_LOOKUP_FAILED");
  if (upper(item.line_material_type) !== "FG" || !BATCH_REQUIRED.has(fgType)) {
    return {
      batchResolved: Boolean(processes?.length),
      packingOrderId: null,
      choices: [],
    };
  }
  const { data: packing, error: packingError } = await serviceRoleClient.schema(
    "erp_production",
  ).from("packing_order")
    .select("id, po_number, status, material_id, batch_number")
    .eq("company_id", companyId).eq("material_id", materialId).eq(
      "batch_number",
      batchNumber,
    )
    .neq("status", "CANCELLED").order("created_at", { ascending: false });
  if (packingError) throw new Error("SRET_PACKING_ORDER_LOOKUP_FAILED");
  const rows = (packing ?? []) as JsonRecord[];
  const selected = text(item.packing_order_id);
  if (selected && !rows.some((row) => text(row.id) === selected)) {
    throw new Error("SRET_PACKING_ORDER_INVALID");
  }
  return {
    batchResolved: Boolean(processes?.length),
    packingOrderId: selected || (rows.length === 1 ? text(rows[0].id) : null),
    choices: rows.length > 1 && !selected ? rows : [],
  };
}

async function currentBlockedRate(
  companyId: string,
  locationId: string,
  materialId: string,
): Promise<number> {
  const { data, error } = await serviceRoleClient.schema("erp_inventory").from(
    "stock_snapshot",
  )
    .select("stock_type_code, valuation_rate").eq("company_id", companyId).eq(
      "storage_location_id",
      locationId,
    )
    .eq("material_id", materialId).in("stock_type_code", [
      "BLOCKED",
      "UNRESTRICTED",
    ]);
  if (error) throw new Error("SRET_VALUATION_LOOKUP_FAILED");
  const snapshots = (data ?? []) as JsonRecord[];
  const preferred =
    snapshots.find((row) => upper(row.stock_type_code) === "BLOCKED") ??
      snapshots.find((row) => upper(row.stock_type_code) === "UNRESTRICTED");
  return Number(preferred?.valuation_rate ?? 0);
}

const RETURN_TYPE_LABELS: Record<string, string> = {
  DEPENDENT_DIRECT: "Dependent — Direct",
  DEPENDENT_DEPOT: "Dependent — Depot",
  INDEPENDENT_PARTY: "Independent Party",
  INDEPENDENT_PARTY_ASIAN_BILLED: "Independent Party — Asian Billed",
  STO: "STO",
};

// business owner, 2026-09-26: SO05's list must show one row per ITEM (not
// one row per receipt) -- company code, item type/name/document name, qty,
// packs, invoice number/date, and every sending-location field, so a return
// receipt with several invoices/items is fully visible without opening it.
// §8A -- every FK bulk-resolved here, never a raw id in the response.
export async function listSalesReturnReceiptsHandler(
  req: Request,
  ctx: Ctx,
): Promise<Response> {
  const companyId = text(new URL(req.url).searchParams.get("company_id"));
  if (!companyId) return fail(req, ctx, "SRET_COMPANY_REQUIRED");
  try {
    await requireCompany(ctx, companyId);

    const { data: receipts, error: receiptsError } = await serviceRoleClient
      .schema("erp_procurement").from("sales_return_receipt")
      .select(
        "id, receipt_number, receipt_date, status, return_type, " +
          "sending_parent_company_id, sending_vdc_id, sending_depot_id, " +
          "sending_customer_id, sending_customer_address_id, sending_company_id, " +
          "sending_name, sending_address, sending_state, sending_gst_number, " +
          "vehicle_number, lr_number, created_at",
      )
      .eq("company_id", companyId).order("receipt_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (receiptsError) throw new Error("SRET_LIST_FAILED");
    const receiptRows = (receipts ?? []) as JsonRecord[];
    if (receiptRows.length === 0) {
      return okResponse({ data: [] }, ctx.request_id, req);
    }
    const receiptIds = receiptRows.map((r) => text(r.id));

    const invoiceRows = await fetchInChunks<JsonRecord>(
      receiptIds,
      (chunk) =>
        serviceRoleClient.schema("erp_procurement").from(
          "sales_return_invoice",
        )
          .select("id, receipt_id, invoice_number, invoice_date")
          .in("receipt_id", chunk),
    );
    const invoiceIds = invoiceRows.map((r) => text(r.id));
    const itemRows = invoiceIds.length
      ? await fetchInChunks<JsonRecord>(
        invoiceIds,
        (chunk) =>
          serviceRoleClient.schema("erp_procurement").from(
            "sales_return_item",
          )
            .select(
              "id, invoice_id, line_number, line_material_type, material_id, manual_sku_name, quantity, uom_code, num_packs",
            )
            .in("invoice_id", chunk),
      )
      : [];

    // §8B -- every lookup below is independent of the others, resolved in
    // one parallel round.
    const materialIds = [
      ...new Set(itemRows.map((r) => text(r.material_id)).filter(Boolean)),
    ];
    const parentIds = [
      ...new Set(
        receiptRows.map((r) => text(r.sending_parent_company_id)).filter(
          Boolean,
        ),
      ),
    ];
    const depotIds = [
      ...new Set(
        receiptRows.flatMap((r) => [
          text(r.sending_vdc_id),
          text(r.sending_depot_id),
        ]).filter(Boolean),
      ),
    ];
    const customerIds = [
      ...new Set(
        receiptRows.map((r) => text(r.sending_customer_id)).filter(Boolean),
      ),
    ];
    const addressIds = [
      ...new Set(
        receiptRows.map((r) => text(r.sending_customer_address_id)).filter(
          Boolean,
        ),
      ),
    ];
    const sendingCompanyIds = [
      ...new Set(
        receiptRows.map((r) => text(r.sending_company_id)).filter(Boolean),
      ),
    ];

    const [
      materials,
      parents,
      depots,
      customers,
      addresses,
      sendingCompanies,
      ownCompany,
    ] = await Promise.all([
      materialIds.length
        ? fetchInChunks<JsonRecord>(
          materialIds,
          (chunk) =>
            serviceRoleClient.schema("erp_master").from("material_master")
              .select("id, material_name, document_name").in("id", chunk),
        )
        : Promise.resolve([] as JsonRecord[]),
      parentIds.length
        ? fetchInChunks<JsonRecord>(
          parentIds,
          (chunk) =>
            serviceRoleClient.schema("erp_master").from("fg_parent_company")
              .select("id, company_name").in("id", chunk),
        )
        : Promise.resolve([] as JsonRecord[]),
      depotIds.length
        ? fetchInChunks<JsonRecord>(
          depotIds,
          (chunk) =>
            serviceRoleClient.schema("erp_master").from("fg_depot_code")
              .select("id, code, description").in("id", chunk),
        )
        : Promise.resolve([] as JsonRecord[]),
      customerIds.length
        ? fetchInChunks<JsonRecord>(
          customerIds,
          (chunk) =>
            serviceRoleClient.schema("erp_master").from("customer_master")
              .select("id, customer_code, customer_name").in("id", chunk),
        )
        : Promise.resolve([] as JsonRecord[]),
      addressIds.length
        ? fetchInChunks<JsonRecord>(
          addressIds,
          (chunk) =>
            serviceRoleClient.schema("erp_master").from("customer_address")
              .select("id, site_name, address_line, town").in("id", chunk),
        )
        : Promise.resolve([] as JsonRecord[]),
      sendingCompanyIds.length
        ? fetchInChunks<JsonRecord>(
          sendingCompanyIds,
          (chunk) =>
            serviceRoleClient.schema("erp_master").from("companies")
              .select("id, company_code, company_name").in("id", chunk),
        )
        : Promise.resolve([] as JsonRecord[]),
      serviceRoleClient.schema("erp_master").from("companies")
        .select("id, company_code").eq("id", companyId).maybeSingle(),
    ]);

    const materialMap = new Map(materials.map((m) => [text(m.id), m]));
    const parentMap = new Map(parents.map((p) => [text(p.id), p]));
    const depotMap = new Map(depots.map((d) => [text(d.id), d]));
    const customerMap = new Map(customers.map((c) => [text(c.id), c]));
    const addressMap = new Map(addresses.map((a) => [text(a.id), a]));
    const sendingCompanyMap = new Map(
      sendingCompanies.map((c) => [text(c.id), c]),
    );
    const invoicesByReceipt = new Map<string, JsonRecord[]>();
    for (const invoice of invoiceRows) {
      const key = text(invoice.receipt_id);
      const list = invoicesByReceipt.get(key) ?? [];
      list.push(invoice);
      invoicesByReceipt.set(key, list);
    }
    const itemsByInvoice = new Map<string, JsonRecord[]>();
    for (const item of itemRows) {
      const key = text(item.invoice_id);
      const list = itemsByInvoice.get(key) ?? [];
      list.push(item);
      itemsByInvoice.set(key, list);
    }

    const addressLabel = (row: JsonRecord | undefined) =>
      row
        ? [row.site_name, row.address_line, row.town].filter(Boolean).join(
          ", ",
        ) || null
        : null;

    const rows: JsonRecord[] = [];
    for (const receipt of receiptRows) {
      const receiptId = text(receipt.id);
      const parent = parentMap.get(text(receipt.sending_parent_company_id));
      const vdc = depotMap.get(text(receipt.sending_vdc_id));
      const depot = depotMap.get(text(receipt.sending_depot_id));
      const customer = customerMap.get(text(receipt.sending_customer_id));
      const address = addressMap.get(
        text(receipt.sending_customer_address_id),
      );
      const sendingCompany = sendingCompanyMap.get(
        text(receipt.sending_company_id),
      );
      const receiptInvoices = invoicesByReceipt.get(receiptId) ?? [];
      for (const invoice of receiptInvoices) {
        const invoiceId = text(invoice.id);
        const invoiceItems = itemsByInvoice.get(invoiceId) ?? [];
        for (const item of invoiceItems) {
          const material = materialMap.get(text(item.material_id));
          rows.push({
            item_id: item.id,
            receipt_id: receiptId,
            receipt_number: receipt.receipt_number,
            receipt_date: receipt.receipt_date,
            status: receipt.status,
            return_type: receipt.return_type,
            return_type_label: RETURN_TYPE_LABELS[text(receipt.return_type)] ??
              receipt.return_type,
            company_code: (ownCompany.data as JsonRecord | null)
              ?.company_code ?? null,
            line_material_type: item.line_material_type,
            material_name: material?.material_name ??
              (text(item.manual_sku_name) || null),
            document_name: material?.document_name ?? null,
            quantity: item.quantity,
            uom_code: item.uom_code,
            num_packs: item.num_packs,
            invoice_number: invoice.invoice_number,
            invoice_date: invoice.invoice_date,
            sending_parent_company_name: parent?.company_name ?? null,
            sending_vdc_code: vdc?.code ?? null,
            sending_vdc_name: vdc?.description ?? null,
            sending_depot_code: depot?.code ?? null,
            sending_depot_name: depot?.description ?? null,
            sending_customer_name: customer
              ? [customer.customer_code, customer.customer_name].filter(
                Boolean,
              ).join(" — ")
              : null,
            sending_customer_address: addressLabel(address),
            sending_company_name: sendingCompany
              ? [sendingCompany.company_code, sendingCompany.company_name]
                .filter(Boolean).join(" — ")
              : null,
            sending_name: receipt.sending_name,
            sending_address: receipt.sending_address,
            sending_state: receipt.sending_state,
            sending_gst_number: receipt.sending_gst_number,
            vehicle_number: receipt.vehicle_number,
            lr_number: receipt.lr_number,
          });
        }
      }
    }
    return okResponse({ data: rows }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SRET_LIST_FAILED";
    return fail(req, ctx, code, code === "SRET_SCOPE_VIOLATION" ? 403 : 500);
  }
}

// business owner, 2026-09-26: SO05's item row needs the same green/red
// Stroke Number dot SO01 already has (§133.21) -- resolves to an approved
// stroke_master row for this item's own Prodshade, or not. Same mechanism
// as listSalesOrderStrokeCheckOptionsHandler in sales_order.handlers.ts,
// but that one only checks MTO/HPS (SO01's own scope) -- SO05 covers all
// four FG_TYPES (MTEST/MTS included), so this is its own copy rather than
// widening SO01's endpoint for an unrelated page.
export async function listSalesReturnStrokeCheckOptionsHandler(
  req: Request,
  ctx: Ctx,
): Promise<Response> {
  const companyId = text(new URL(req.url).searchParams.get("company_id"));
  if (!companyId) return fail(req, ctx, "SRET_COMPANY_REQUIRED");
  try {
    await requireCompany(ctx, companyId);
    const { data: strokes, error: strokesError } = await serviceRoleClient
      .schema("erp_production").from("stroke_master")
      .select("id, prodshade_material_id, stroke_number")
      .eq("company_id", companyId).eq("status", "APPROVED");
    if (strokesError) throw new Error("SRET_STROKE_CHECK_OPTIONS_FAILED");
    const strokeById = new Map(
      ((strokes ?? []) as JsonRecord[]).map((row) => [text(row.id), row]),
    );
    const strokeIds = [...strokeById.keys()];
    const { data: applicabilities, error: applicabilityError } =
      strokeIds.length > 0
        ? await serviceRoleClient
          .schema("erp_production").from("stroke_po_type_applicability")
          .select("stroke_master_id, target_po_type").eq("is_active", true)
          .in("stroke_master_id", strokeIds).in("target_po_type", [
            ...FG_TYPES,
          ])
        : { data: [] as JsonRecord[], error: null };
    if (applicabilityError) throw new Error("SRET_STROKE_CHECK_OPTIONS_FAILED");
    const output = ((applicabilities ?? []) as JsonRecord[]).map((row) => {
      const stroke = strokeById.get(text(row.stroke_master_id));
      return {
        prodshade_material_id: stroke?.prodshade_material_id ?? null,
        po_type: row.target_po_type,
        stroke_number: stroke?.stroke_number ?? null,
      };
    });
    return okResponse({ data: output }, ctx.request_id, req);
  } catch (error) {
    const code = error instanceof Error
      ? error.message
      : "SRET_STROKE_CHECK_OPTIONS_FAILED";
    return fail(req, ctx, code, code === "SRET_SCOPE_VIOLATION" ? 403 : 500);
  }
}

// Thin wrapper over the existing deriveProdshadeMaterialId() (already used
// by the batch/packing-order resolution logic in this same file) so the
// frontend's per-row Stroke dot can resolve one FG SKU's own Prodshade
// without needing to reimplement that external-code/pack-config matching.
export async function resolveSalesReturnProdshadeHandler(
  req: Request,
  ctx: Ctx,
): Promise<Response> {
  const materialId = text(new URL(req.url).searchParams.get("material_id"));
  if (!materialId) return fail(req, ctx, "SRET_MATERIAL_REQUIRED");
  try {
    const prodshadeMaterialId = await deriveProdshadeMaterialId(materialId);
    return okResponse(
      { data: { material_id: materialId, prodshade_material_id: prodshadeMaterialId } },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof Error
      ? error.message
      : "SRET_PRODSHADE_LOOKUP_FAILED";
    return fail(req, ctx, code, 500);
  }
}

export async function createSalesReturnReceiptHandler(
  req: Request,
  ctx: Ctx,
): Promise<Response> {
  const payload = await parseBody(req);
  const companyId = text(payload.company_id);
  const returnType = upper(payload.return_type);
  const invoices = Array.isArray(payload.invoices)
    ? payload.invoices as JsonRecord[]
    : [];
  if (!companyId || !RETURN_TYPES.has(returnType) || invoices.length === 0) {
    return fail(req, ctx, "SRET_CREATE_INVALID");
  }
  try {
    await requireCompany(ctx, companyId);
  } catch {
    return fail(req, ctx, "SRET_SCOPE_VIOLATION", 403);
  }

  let receiptId = "";
  try {
    const sender = await resolveSenderSnapshot(payload, returnType);
    const prepared: Array<
      {
        invoice: JsonRecord;
        items: Array<JsonRecord & { __repack: JsonRecord[] }>;
      }
    > = [];
    const ambiguous: JsonRecord[] = [];
    for (let invoiceIndex = 0; invoiceIndex < invoices.length; invoiceIndex += 1) {
      const invoice = invoices[invoiceIndex];
      if (!text(invoice.invoice_number)) {
        throw new Error("SRET_INVOICE_NUMBER_REQUIRED");
      }
      if (invoice.tick_on && !text(invoice.invoice_date)) {
        throw new Error("SRET_INVOICE_DATE_REQUIRED");
      }
      const items = Array.isArray(invoice.items)
        ? invoice.items as JsonRecord[]
        : [];
      if (items.length === 0) throw new Error("SRET_ITEM_REQUIRED");
      const preparedItems: Array<JsonRecord & { __repack: JsonRecord[] }> = [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const materialType = upper(item.line_material_type);
        const fgType = upper(item.fg_type) || null;
        const quantity = positive(item.quantity);
        const materialId = text(item.material_id);
        const manualName = text(item.manual_sku_name);
        const locationId = text(item.storage_location_id);
        if (
          !MATERIAL_TYPES.has(materialType) || !quantity ||
          (!materialId && !manualName) || !locationId
        ) throw new Error("SRET_ITEM_INVALID");
        if (
          (materialType === "FG" || materialType === "SFG") && fgType &&
          !FG_TYPES.has(fgType)
        ) throw new Error("SRET_FG_TYPE_INVALID");
        if (
          (materialType === "SFG" ||
            (materialType === "FG" && BATCH_REQUIRED.has(fgType ?? ""))) &&
          !text(item.batch_number)
        ) throw new Error("SRET_BATCH_REQUIRED");
        if (!materialId) throw new Error("SRET_MANUAL_SKU_CANNOT_POST");
        await validateStorageLocation(companyId, locationId);
        const resolved = await resolveBatchAndPacking(companyId, item);
        if (resolved.choices.length > 0) {
          ambiguous.push({
            invoice_index: invoiceIndex,
            invoice_number: text(invoice.invoice_number),
            line_number: index + 1,
            choices: resolved.choices,
          });
        }
        const repackRows = Array.isArray(item.repack_lines)
          ? item.repack_lines as JsonRecord[]
          : [];
        if (item.is_repacked) {
          if (repackRows.length === 0) {
            throw new Error("SRET_REPACK_LINE_REQUIRED");
          }
          let repackTotal = 0;
          for (const repack of repackRows) {
            const repackQty = positive(repack.quantity);
            const repackMaterial = text(repack.target_material_id);
            const repackLocation = text(repack.storage_location_id);
            if (!repackQty || !repackMaterial || !repackLocation) {
              throw new Error("SRET_REPACK_LINE_INVALID");
            }
            await validateStorageLocation(companyId, repackLocation);
            repackTotal += repackQty;
          }
          if (Math.abs(repackTotal - quantity) > 0.000001) {
            throw new Error("SRET_REPACK_QUANTITY_MISMATCH");
          }
        }
        preparedItems.push({
          ...item,
          line_number: index + 1,
          line_material_type: materialType,
          fg_type: fgType,
          quantity,
          material_id: materialId,
          storage_location_id: locationId,
          batch_resolved: resolved.batchResolved,
          packing_order_id: resolved.packingOrderId,
          __repack: repackRows,
        });
      }
      prepared.push({ invoice, items: preparedItems });
    }
    if (ambiguous.length > 0) {
      return okResponse(
        { requires_packing_order_selection: true, ambiguous_items: ambiguous },
        ctx.request_id,
        req,
      );
    }

    const receiptNumber = await nextReceiptNumber();
    const { data: receipt, error: receiptError } = await serviceRoleClient
      .schema("erp_procurement").from("sales_return_receipt").insert({
        receipt_number: receiptNumber,
        receipt_date: text(payload.receipt_date) || todayIsoInKolkata(),
        company_id: companyId,
        return_type: returnType,
        ...sender,
        vehicle_number: text(payload.vehicle_number) || null,
        transporter_id: text(payload.transporter_id) || null,
        transporter_name_freetext: text(payload.transporter_name_freetext) ||
          null,
        lr_number: text(payload.lr_number) || null,
        lr_date: text(payload.lr_date) || null,
        gross_weight: positive(payload.gross_weight),
        net_weight: positive(payload.net_weight),
        driver_number: text(payload.driver_number) || null,
        driver_contact_number: text(payload.driver_contact_number) || null,
        remarks: text(payload.remarks) || null,
        created_by: ctx.auth_user_id,
      }).select("id, receipt_number, receipt_date").single();
    if (receiptError || !receipt) throw new Error("SRET_CREATE_FAILED");
    receiptId = text(receipt.id);
    const matDoc = await generateMaterialDocNumber(companyId);
    const itemGroups: JsonRecord[] = [];

    for (const block of prepared) {
      const invoice = block.invoice;
      const { data: savedInvoice, error: invoiceError } =
        await serviceRoleClient.schema("erp_procurement").from(
          "sales_return_invoice",
        ).insert({
          receipt_id: receiptId,
          tick_on: Boolean(invoice.tick_on),
          invoice_number: text(invoice.invoice_number),
          invoice_date: text(invoice.invoice_date) || null,
          reference_document_number: text(invoice.reference_document_number) ||
            null,
          amount: positive(invoice.amount),
          gst_treatment: upper(invoice.gst_treatment) || null,
          gst_rate: positive(invoice.gst_rate),
          gst_amount: positive(invoice.gst_amount),
          state: text(invoice.state) || null,
          freight_term: upper(invoice.freight_term) || null,
          detail_status: invoice.tick_on ? "DETAIL_CAPTURED" : "PENDING",
          created_by: ctx.auth_user_id,
        }).select("id").single();
      if (invoiceError || !savedInvoice) {
        throw new Error("SRET_INVOICE_CREATE_FAILED");
      }

      for (const item of block.items) {
        const { __repack, ...itemInput } = item;
        const { data: savedItem, error: itemError } = await serviceRoleClient
          .schema("erp_procurement").from("sales_return_item").insert({
            invoice_id: savedInvoice.id,
            line_number: itemInput.line_number,
            line_material_type: itemInput.line_material_type,
            fg_type: itemInput.fg_type,
            material_id: itemInput.material_id,
            manual_sku_name: text(itemInput.manual_sku_name) || null,
            declared_stroke_number: text(itemInput.declared_stroke_number) ||
              null,
            batch_number: text(itemInput.batch_number) || null,
            batch_resolved: Boolean(itemInput.batch_resolved),
            packing_order_id: itemInput.packing_order_id || null,
            expiry_date: text(itemInput.expiry_date) || null,
            num_packs: positive(itemInput.num_packs),
            per_pack_qty: positive(itemInput.per_pack_qty),
            quantity: itemInput.quantity,
            uom_code: text(itemInput.uom_code) || "KG",
            storage_location_id: itemInput.storage_location_id,
            is_repacked: Boolean(itemInput.is_repacked),
            created_by: ctx.auth_user_id,
          }).select("id").single();
        if (itemError || !savedItem) throw new Error("SRET_ITEM_CREATE_FAILED");
        const movements: JsonRecord[] = [];
        if (itemInput.is_repacked) {
          const rows = __repack.map((row) => ({
            item_id: savedItem.id,
            target_material_id: text(row.target_material_id),
            target_manual_sku_name: text(row.target_manual_sku_name) || null,
            num_packs: positive(row.num_packs),
            per_pack_qty: positive(row.per_pack_qty),
            quantity: positive(row.quantity),
            uom_code: text(row.uom_code) || "KG",
            storage_location_id: text(row.storage_location_id),
            created_by: ctx.auth_user_id,
          }));
          const { data: savedRepack, error: repackError } =
            await serviceRoleClient.schema("erp_procurement").from(
              "sales_return_repack_line",
            )
              .insert(rows).select(
                "id, target_material_id, quantity, uom_code, storage_location_id",
              );
          if (repackError || !savedRepack) {
            throw new Error("SRET_REPACK_CREATE_FAILED");
          }
          for (const row of savedRepack as JsonRecord[]) {
            movements.push({
              line_ref: `repack:${text(row.id)}`,
              material_id: text(row.target_material_id),
              quantity: Number(row.quantity),
              base_uom_code: text(row.uom_code),
              storage_location_id: text(row.storage_location_id),
            });
          }
        } else {movements.push({
            line_ref: `item:${text(savedItem.id)}`,
            material_id: text(itemInput.material_id),
            quantity: Number(itemInput.quantity),
            base_uom_code: text(itemInput.uom_code) || "KG",
            storage_location_id: text(itemInput.storage_location_id),
          });}
        for (const movement of movements) {
          movement.unit_value = await currentBlockedRate(
            companyId,
            text(movement.storage_location_id),
            text(movement.material_id),
          );
          Object.assign(movement, {
            document_number: receiptNumber,
            document_date: text(receipt.receipt_date),
            posting_date: text(receipt.receipt_date),
            movement_type_code: "P651",
            company_id: companyId,
            stock_type_code: "BLOCKED",
            direction: "IN",
            reversal_of_id: null,
            batch_number: text(itemInput.batch_number) || null,
            material_doc_number: matDoc.docNumber,
            material_doc_year: matDoc.docYear,
            reference_document_number: receiptNumber,
          });
        }
        itemGroups.push({ item_id: text(savedItem.id), movements });
      }
    }
    const { error: postError } = await serviceRoleClient.schema(
      "erp_procurement",
    )
      .rpc("post_sales_return_receipt", {
        p_receipt_id: receiptId,
        p_item_groups: itemGroups,
        p_posted_by: ctx.auth_user_id,
      });
    if (postError) {
      console.error(
        "[sales_return.create] post failed",
        JSON.stringify(postError),
      );
      throw new Error("SRET_POST_FAILED");
    }
    return okResponse(
      { data: { ...receipt, status: "POSTED" } },
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "SRET_CREATE_FAILED";
    if (receiptId) {
      await serviceRoleClient.schema("erp_procurement").from(
        "sales_return_receipt",
      ).delete().eq("id", receiptId).eq("status", "DRAFT");
    }
    const validation = code.includes("REQUIRED") || code.includes("INVALID") ||
      code.includes("MISMATCH") || code.includes("CANNOT_POST");
    return fail(req, ctx, code, validation ? 400 : 500);
  }
}

export async function resolveBatchNumberOptionsHandler(
  req: Request,
  ctx: Ctx,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const companyId = text(params.get("company_id"));
  const materialId = text(params.get("material_id"));
  const poType = upper(params.get("po_type"));
  const query = text(params.get("q")).replace(/[%_]/g, "");
  if (!companyId || !materialId || !poType) {
    return fail(req, ctx, "SRET_BATCH_OPTIONS_INVALID");
  }
  try {
    await requireCompany(ctx, companyId);
    const processMaterialId = await deriveProdshadeMaterialId(materialId);
    const baseQuery = serviceRoleClient.schema("erp_production").from(
      "process_order",
    )
      .select("id, po_number, batch_number, po_type, status, material_id")
      .eq("company_id", companyId).eq("material_id", processMaterialId).eq(
        "po_type",
        poType,
      )
      .not("batch_number", "is", null);
    const filteredQuery = query
      ? baseQuery.or(`batch_number.ilike.%${query}%`)
      : baseQuery;
    const { data, error } = await filteredQuery
      .order("created_at", { ascending: false }).limit(50);
    if (error) throw new Error("SRET_BATCH_OPTIONS_FAILED");
    const seen = new Set<string>();
    return okResponse(
      {
        data: ((data ?? []) as JsonRecord[]).filter((row) => {
          const key = text(row.batch_number);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    return fail(
      req,
      ctx,
      error instanceof Error ? error.message : "SRET_BATCH_OPTIONS_FAILED",
      500,
    );
  }
}

export async function listRepackTargetSkuOptionsHandler(
  req: Request,
  ctx: Ctx,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const companyId = text(params.get("company_id"));
  const sourceMaterialId = text(params.get("source_material_id"));
  let prodshadeId = text(params.get("prodshade_material_id"));
  const excludeMaterialId = text(params.get("exclude_material_id"));
  if (!companyId || (!prodshadeId && !sourceMaterialId)) {
    return fail(req, ctx, "SRET_REPACK_OPTIONS_INVALID");
  }
  try {
    await requireCompany(ctx, companyId);
    if (!prodshadeId) {
      prodshadeId = await deriveProdshadeMaterialId(sourceMaterialId);
    }
    const { data: configs, error: configError } = await serviceRoleClient
      .schema("erp_production").from("prodshade_pack_config")
      .select(
        "pack_code_id, fill_qty, pack_code:pack_code_master!pack_code_id(id, pack_code, pack_name, bom_required, outer_uom_code)",
      )
      .eq("material_id", prodshadeId).eq("active", true);
    if (configError) throw new Error("SRET_REPACK_OPTIONS_FAILED");
    const packCodes = (configs ?? []).map((row: JsonRecord) =>
      text((row.pack_code as JsonRecord | null)?.pack_code)
    ).filter(Boolean);
    if (packCodes.length === 0) {
      return okResponse({ data: [] }, ctx.request_id, req);
    }
    const { data: prodshade, error: prodshadeError } = await serviceRoleClient
      .schema("erp_master").from("material_master")
      .select("external_code, material_name").eq("id", prodshadeId)
      .maybeSingle();
    if (prodshadeError || !prodshade) {
      throw new Error("SRET_REPACK_OPTIONS_FAILED");
    }
    const prodshadeCode = upper(
      prodshade.external_code || prodshade.material_name,
    );
    let materialQuery = serviceRoleClient.schema("erp_master").from(
      "material_master",
    )
      .select(
        "id, pace_code, external_code, material_name, pack_code, base_uom_code",
      ).in("pack_code", packCodes).limit(200);
    if (excludeMaterialId) {
      materialQuery = materialQuery.neq("id", excludeMaterialId);
    }
    const { data: materials, error: materialError } = await materialQuery;
    if (materialError) throw new Error("SRET_REPACK_OPTIONS_FAILED");
    const configByCode = new Map(
      (configs ?? []).map((
        row: JsonRecord,
      ) => [text((row.pack_code as JsonRecord | null)?.pack_code), row]),
    );
    return okResponse(
      {
        data: ((materials ?? []) as JsonRecord[]).filter((row) =>
          upper(row.external_code || row.material_name).startsWith(
            prodshadeCode,
          )
        ).map((row) => ({
          ...row,
          pack_config: configByCode.get(text(row.pack_code)) ?? null,
        })),
      },
      ctx.request_id,
      req,
    );
  } catch (error) {
    return fail(
      req,
      ctx,
      error instanceof Error ? error.message : "SRET_REPACK_OPTIONS_FAILED",
      500,
    );
  }
}

export async function listPendingReturnInvoicesHandler(
  req: Request,
  ctx: Ctx,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const companyId = text(params.get("company_id"));
  const showAll = params.get("show_all") === "true";
  if (!companyId) return fail(req, ctx, "SRET_COMPANY_REQUIRED");
  try {
    await requireCompany(ctx, companyId);
    let query = serviceRoleClient.schema("erp_procurement").from(
      "sales_return_invoice",
    )
      .select(
        "id, invoice_number, invoice_date, reference_document_number, amount, gst_treatment, gst_rate, gst_amount, state, freight_term, detail_status, receipt:sales_return_receipt!inner(receipt_number, receipt_date, company_id, sending_name)",
      )
      .eq("receipt.company_id", companyId).order("created_at", {
        ascending: false,
      });
    if (!showAll) query = query.eq("detail_status", "PENDING");
    const { data, error } = await query;
    if (error) throw new Error("SRET_PENDING_INVOICES_FAILED");
    return okResponse({ data: data ?? [] }, ctx.request_id, req);
  } catch (error) {
    return fail(
      req,
      ctx,
      error instanceof Error ? error.message : "SRET_PENDING_INVOICES_FAILED",
      500,
    );
  }
}

export async function saveReturnInvoiceDetailHandler(
  req: Request,
  ctx: Ctx,
): Promise<Response> {
  const payload = await parseBody(req);
  const invoiceId = text(payload.invoice_id);
  if (!invoiceId || !text(payload.invoice_date)) {
    return fail(req, ctx, "SRET_INVOICE_DETAIL_INVALID");
  }
  // business owner, 2026-09-26: Accounts must be able to correct a mistyped
  // invoice number from this page too. invoice_number has no other copy
  // anywhere in the schema (not on sales_return_item, not on any posting/
  // stock row) -- every screen that shows it (SO05 list, this queue) reads
  // it live via a join, so updating this one column is the whole fix, no
  // cascade needed. Optional here (only set when the caller sends a
  // non-blank value) so a plain detail-only save keeps working unchanged.
  const nextInvoiceNumber = text(payload.invoice_number);
  const { data: invoice, error: lookupError } = await serviceRoleClient.schema(
    "erp_procurement",
  ).from("sales_return_invoice")
    .select("id, receipt:sales_return_receipt!inner(company_id)").eq(
      "id",
      invoiceId,
    ).maybeSingle();
  if (lookupError || !invoice) {
    return fail(req, ctx, "SRET_INVOICE_NOT_FOUND", 404);
  }
  const receipt = invoice.receipt as JsonRecord;
  try {
    await requireCompany(ctx, text(receipt.company_id));
  } catch {
    return fail(req, ctx, "SRET_SCOPE_VIOLATION", 403);
  }
  // TODO §134.10: persist invoice detail only; never create a return-payable/ledger here.
  const { data, error } = await serviceRoleClient.schema("erp_procurement")
    .from("sales_return_invoice").update({
      tick_on: true,
      ...(nextInvoiceNumber ? { invoice_number: nextInvoiceNumber } : {}),
      invoice_date: text(payload.invoice_date),
      amount: positive(payload.amount),
      gst_treatment: upper(payload.gst_treatment) || null,
      gst_rate: positive(payload.gst_rate),
      gst_amount: positive(payload.gst_amount),
      state: text(payload.state) || null,
      freight_term: upper(payload.freight_term) || null,
      detail_status: "DETAIL_CAPTURED",
    }).eq("id", invoiceId).select("id, invoice_number, detail_status").single();
  if (error) return fail(req, ctx, "SRET_INVOICE_SAVE_FAILED", 500);
  return okResponse({ data }, ctx.request_id, req);
}

async function salesReturnPendingItems(
  companyId: string,
): Promise<JsonRecord[]> {
  const { data, error } = await serviceRoleClient.schema("erp_procurement")
    .from("sales_return_item")
    .select(
      "id, line_material_type, fg_type, material_id, manual_sku_name, declared_stroke_number, batch_number, batch_resolved, packing_order_id, quantity, uom_code, invoice:sales_return_invoice!inner(receipt:sales_return_receipt!inner(company_id, receipt_number))",
    )
    .eq("invoice.receipt.company_id", companyId);
  if (error) throw new Error("SRET_PENDING_ENTRIES_FAILED");
  const rows = (data ?? []) as JsonRecord[];
  const { prodshadeByMaterial, materialById } = await deriveProdshadeMap(
    rows.map((row) => text(row.material_id)),
  );
  return rows.map((row) => {
    const materialId = text(row.material_id);
    const prodshadeId = prodshadeByMaterial.get(materialId) || materialId;
    const material = materialById.get(materialId);
    const prodshade = materialById.get(prodshadeId);
    return {
      ...row,
      prodshade_material_id: prodshadeId || null,
      material_code: text(material?.pace_code || material?.external_code) ||
        null,
      material_name: text(material?.material_name) || null,
      prodshade_code: text(prodshade?.pace_code || prodshade?.external_code) ||
        null,
      prodshade_name: text(prodshade?.material_name) || null,
    };
  });
}

export async function listPendingStrokesHandler(
  req: Request,
  ctx: Ctx,
): Promise<Response> {
  const companyId = text(new URL(req.url).searchParams.get("company_id"));
  if (!companyId) return fail(req, ctx, "SRET_COMPANY_REQUIRED");
  try {
    await requireCompany(ctx, companyId);
    const [returns, ordersResult, strokesResult] = await Promise.all([
      salesReturnPendingItems(companyId),
      serviceRoleClient.schema("erp_procurement").from("sales_order_line")
        .select(
          "material_id, fg_type, declared_stroke_number, so:sales_order!inner(company_id)",
        )
        .eq("so.company_id", companyId).not(
          "declared_stroke_number",
          "is",
          null,
        ),
      serviceRoleClient.schema("erp_production").from("stroke_master")
        .select("prodshade_material_id, po_type, stroke_number").eq(
          "company_id",
          companyId,
        ).eq("status", "APPROVED"),
    ]);
    if (ordersResult.error || strokesResult.error) {
      throw new Error("SRET_PENDING_STROKES_FAILED");
    }
    const orderRows = (ordersResult.data ?? []) as JsonRecord[];
    const orderProdshades = await deriveProdshadeMap(
      orderRows.map((row) => text(row.material_id)),
    );
    const approved = new Set(
      ((strokesResult.data ?? []) as JsonRecord[]).map((row) =>
        `${text(row.prodshade_material_id)}|${upper(row.po_type)}|${
          upper(row.stroke_number)
        }`
      ),
    );
    const candidates = [
      ...returns.map((row) => ({
        material_id: row.prodshade_material_id,
        material_code: row.prodshade_code,
        material_name: row.prodshade_name,
        po_type: row.fg_type,
        stroke_number: row.declared_stroke_number,
        source: "SO05",
      })),
      ...orderRows.map((row) => {
        const sourceMaterialId = text(row.material_id);
        const prodshadeId =
          orderProdshades.prodshadeByMaterial.get(sourceMaterialId) ||
          sourceMaterialId;
        const prodshade = orderProdshades.materialById.get(prodshadeId);
        return {
          material_id: prodshadeId,
          material_code: prodshade?.pace_code || prodshade?.external_code,
          material_name: prodshade?.material_name,
          po_type: row.fg_type,
          stroke_number: row.declared_stroke_number,
          source: "SO01",
        };
      }),
    ].filter((row) =>
      text(row.material_id) && text(row.po_type) && text(row.stroke_number)
    );
    const pending = new Map<string, JsonRecord>();
    for (const row of candidates) {
      const key = `${text(row.material_id)}|${upper(row.po_type)}|${
        upper(row.stroke_number)
      }`;
      if (!approved.has(key) && !pending.has(key)) pending.set(key, row);
    }
    return okResponse({ data: [...pending.values()] }, ctx.request_id, req);
  } catch (error) {
    return fail(
      req,
      ctx,
      error instanceof Error ? error.message : "SRET_PENDING_STROKES_FAILED",
      500,
    );
  }
}

export async function listPendingGenealogyEntriesHandler(
  req: Request,
  ctx: Ctx,
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const companyId = text(params.get("company_id"));
  const kind = upper(params.get("kind")) ||
    (new URL(req.url).pathname.endsWith("pending-process-entries")
      ? "PROCESS"
      : "PACKING");
  if (!companyId || !["PROCESS", "PACKING"].includes(kind)) {
    return fail(req, ctx, "SRET_PENDING_ENTRIES_INVALID");
  }
  try {
    await requireCompany(ctx, companyId);
    const rows = await salesReturnPendingItems(companyId);
    const filtered = kind === "PROCESS"
      ? rows.filter((row) => !row.batch_resolved && text(row.batch_number))
      : rows.filter((row) =>
        upper(row.line_material_type) === "FG" &&
        BATCH_REQUIRED.has(upper(row.fg_type)) && !text(row.packing_order_id)
      );
    const grouped = new Map<string, JsonRecord>();
    for (const row of filtered) {
      const groupingMaterialId = kind === "PROCESS"
        ? text(row.prodshade_material_id)
        : text(row.material_id);
      const key = `${groupingMaterialId}|${upper(row.fg_type)}|${
        upper(row.declared_stroke_number)
      }|${text(row.batch_number)}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.quantity = Number(existing.quantity) +
          Number(row.quantity ?? 0);
      } else {grouped.set(key, {
          material_id: groupingMaterialId,
          material_code: kind === "PROCESS"
            ? row.prodshade_code
            : row.material_code,
          material_name: kind === "PROCESS"
            ? row.prodshade_name
            : row.material_name,
          sku_material_id: kind === "PACKING" ? row.material_id : null,
          manual_sku_name: row.manual_sku_name,
          po_type: row.fg_type,
          stroke_number: row.declared_stroke_number,
          batch_number: row.batch_number,
          quantity: Number(row.quantity ?? 0),
          uom_code: row.uom_code,
          source: "SO05",
        });}
    }
    return okResponse({ data: [...grouped.values()] }, ctx.request_id, req);
  } catch (error) {
    return fail(
      req,
      ctx,
      error instanceof Error ? error.message : "SRET_PENDING_ENTRIES_FAILED",
      500,
    );
  }
}
