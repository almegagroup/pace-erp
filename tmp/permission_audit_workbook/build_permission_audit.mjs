import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..", "..");
const outputDir = path.join(workspaceRoot, "outputs", "permission-audit-20260801");
const previewDir = path.join(outputDir, "previews");

const projectRef = "bsjpvkigpllichlknmah";
const userCodes = [
  "P0002", "P0003", "P0004", "P0005", "P0006", "P0007", "P0008", "P0009", "P0010", "P0011",
  "P0025", "P0030", "P0058", "P0060", "P0062", "P0063", "P0064", "P0066", "P0067", "P0068",
  "P0069", "P0070", "P0071", "P0072", "P0073", "P0074", "P0075", "P0076",
];

function quoteSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildTargetCodesCte(codes) {
  return `select unnest(array[${codes.map(quoteSqlString).join(",")}]) as user_code`;
}

async function loadSupabaseToken() {
  const configPath = path.join(workspaceRoot, ".mcp.codex.local.json");
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = JSON.parse(raw);
  return parsed?.mcpServers?.["supabase-dev-codex"]?.args?.[3] ?? "";
}

async function runSql(token, query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SQL query failed: ${response.status} ${text}`);
  }
  const payload = await response.json();
  return payload;
}

function asRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.value)) return payload.value;
  return [];
}

function autoFilterAndFreeze(sheet, lastColLetter) {
  sheet.freezePanes.freezeRows(1);
  sheet.getRange(`A1:${lastColLetter}1`).dataValidation = null;
}

function applyHeaderStyle(range) {
  range.format.fill.color = "#1F4E78";
  range.format.font.color = "#FFFFFF";
  range.format.font.bold = true;
  range.format.horizontalAlignment = "Center";
  range.format.verticalAlignment = "Center";
  range.format.wrapText = true;
  range.format.rowHeight = 24;
  range.format.borders = { preset: "all", style: "thin", color: "#B7C9E2" };
}

function applyBodyBorders(range) {
  range.format.borders = { preset: "all", style: "thin", color: "#D9E2F3" };
  range.format.verticalAlignment = "Center";
}

function boolLabel(value) {
  return value === true ? "Yes" : value === false ? "No" : "";
}

function textValue(value) {
  return value == null ? "" : String(value);
}

function buildUserDirectorySheet(workbook, rows) {
  const sheet = workbook.worksheets.add("User Directory");
  const headers = [[
    "User Code", "Full Name", "Email", "User State", "Role Code", "Role Rank",
    "Primary Company Code", "Primary Company Name", "Primary Work Context Code", "Primary Work Context Name",
    "Auth User ID", "Last Sign In At", "User Created At", "Auth Created At",
  ]];
  const values = rows.map((row) => ([
    textValue(row.user_code),
    textValue(row.full_name),
    textValue(row.email),
    textValue(row.user_state),
    textValue(row.role_code),
    row.role_rank ?? null,
    textValue(row.primary_company_code),
    textValue(row.primary_company_name),
    textValue(row.primary_work_context_code),
    textValue(row.primary_work_context_name),
    textValue(row.auth_user_id),
    textValue(row.last_sign_in_at),
    textValue(row.user_created_at),
    textValue(row.auth_created_at),
  ]));

  sheet.getRange(`A1:N${values.length + 1}`).values = [...headers, ...values];
  applyHeaderStyle(sheet.getRange("A1:N1"));
  applyBodyBorders(sheet.getRange(`A2:N${values.length + 1}`));
  sheet.showGridLines = false;
  sheet.getRange("F2:F200").format.horizontalAlignment = "Right";
  sheet.getRange("A1:N1").format.autofitColumns();
  sheet.getRange("A1:N200").format.autofitRows();
  sheet.getRange("A1:N1").format.borders = { preset: "all", style: "thin", color: "#B7C9E2" };
  sheet.freezePanes.freezeRows(1);
  return sheet;
}

function buildGrantedAccessSheet(workbook, rows) {
  const sheet = workbook.worksheets.add("Granted Access");
  const headers = [[
    "User Code", "Full Name", "Role Code", "Role Rank", "Company Code", "Company Name",
    "Work Context Code", "Work Context Name", "TX Code", "Menu Code", "Page Title",
    "Route Path", "Allowed Actions", "Menu Visible", "Snapshot Version", "Snapshot Status",
  ]];
  const values = rows.map((row) => ([
    textValue(row.user_code),
    textValue(row.full_name),
    textValue(row.role_code),
    row.role_rank ?? null,
    textValue(row.company_code),
    textValue(row.company_name),
    textValue(row.work_context_code),
    textValue(row.work_context_name),
    textValue(row.tx_code),
    textValue(row.menu_code),
    textValue(row.title),
    textValue(row.route_path),
    textValue(row.allowed_actions),
    boolLabel(row.is_visible),
    row.snapshot_version ?? null,
    textValue(row.snapshot_status),
  ]));

  sheet.getRange(`A1:P${values.length + 1}`).values = [...headers, ...values];
  applyHeaderStyle(sheet.getRange("A1:P1"));
  applyBodyBorders(sheet.getRange(`A2:P${values.length + 1}`));
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  sheet.getRange(`A1:P${Math.min(values.length + 1, 3000)}`).format.autofitRows();
  sheet.getRange("A1:P1").format.autofitColumns();

  // Highlight snapshot mismatches.
  sheet.getRange(`P2:P${values.length + 1}`).conditionalFormats.add("cellIs", {
    operator: "equal",
    formula: '"NOT OK"',
    format: {
      fill: { color: "#F4CCCC" },
      font: { color: "#9C0006", bold: true },
    },
  });
  sheet.getRange(`P2:P${values.length + 1}`).conditionalFormats.add("cellIs", {
    operator: "equal",
    formula: '"OK"',
    format: {
      fill: { color: "#D9EAD3" },
      font: { color: "#274E13", bold: true },
    },
  });
  return sheet;
}

function buildSnapshotAuditSheet(workbook, rows) {
  const sheet = workbook.worksheets.add("Snapshot Audit");
  const headers = [[
    "User Code", "Full Name", "Role Code", "Company Code", "Company Name", "Work Context Code",
    "Work Context Name", "TX Code", "Menu Code", "Page Title", "Route Path",
    "Allowed Actions", "Menu Visible", "Snapshot Version", "Snapshot Status", "Status Note",
  ]];
  const values = rows.map((row) => {
    const note = row.snapshot_status === "OK"
      ? "Visibility matches active ACL VIEW expectation"
      : "Visibility does not match active ACL VIEW expectation";
    return [
      textValue(row.user_code),
      textValue(row.full_name),
      textValue(row.role_code),
      textValue(row.company_code),
      textValue(row.company_name),
      textValue(row.work_context_code),
      textValue(row.work_context_name),
      textValue(row.tx_code),
      textValue(row.menu_code),
      textValue(row.title),
      textValue(row.route_path),
      textValue(row.allowed_actions),
      boolLabel(row.is_visible),
      row.snapshot_version ?? null,
      textValue(row.snapshot_status),
      note,
    ];
  });

  sheet.getRange(`A1:P${values.length + 1}`).values = [...headers, ...values];
  applyHeaderStyle(sheet.getRange("A1:P1"));
  applyBodyBorders(sheet.getRange(`A2:P${values.length + 1}`));
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  sheet.getRange("A1:P1").format.autofitColumns();
  sheet.getRange(`A1:P${Math.min(values.length + 1, 4000)}`).format.autofitRows();
  sheet.getRange(`O2:O${values.length + 1}`).conditionalFormats.add("cellIs", {
    operator: "equal",
    formula: '"NOT OK"',
    format: {
      fill: { color: "#FCE5CD" },
      font: { color: "#783F04", bold: true },
    },
  });
  sheet.getRange(`O2:O${values.length + 1}`).conditionalFormats.add("cellIs", {
    operator: "equal",
    formula: '"OK"',
    format: {
      fill: { color: "#D9EAD3" },
      font: { color: "#274E13", bold: true },
    },
  });
  return sheet;
}

async function saveRenderPreview(workbook, sheetName, range, fileName) {
  const blob = await workbook.render({ sheetName, range, autoCrop: "all", scale: 1, format: "png" });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const filePath = path.join(previewDir, fileName);
  await fs.writeFile(filePath, bytes);
  return filePath;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(previewDir, { recursive: true });

  const token = await loadSupabaseToken();
  const targetCodesCte = buildTargetCodesCte(userCodes);

  const userDirectoryQuery = `
with target_codes as (
  ${targetCodesCte}
), primary_company as (
  select uc.auth_user_id, uc.company_id, cm.company_code, cm.company_name,
         row_number() over (partition by uc.auth_user_id order by uc.is_primary desc, uc.company_id) as rn
  from erp_map.user_companies uc
  left join erp_master.companies cm on cm.id = uc.company_id
), primary_work_context as (
  select uwc.auth_user_id, uwc.company_id, uwc.work_context_id, wc.work_context_code, wc.work_context_name,
         row_number() over (partition by uwc.auth_user_id order by uwc.is_primary desc, uwc.company_id, uwc.work_context_id) as rn
  from erp_acl.user_work_contexts uwc
  left join erp_acl.work_contexts wc on wc.work_context_id = uwc.work_context_id
), role_rows as (
  select ur.auth_user_id, ur.role_code, ur.role_rank,
         row_number() over (partition by ur.auth_user_id order by ur.role_rank desc, ur.assigned_at desc nulls last) as rn
  from erp_acl.user_roles ur
)
select
  tc.user_code,
  u.state as user_state,
  au.email,
  coalesce(nullif(trim(au.raw_user_meta_data->>'display_name'),''), nullif(trim(au.raw_user_meta_data->>'name'),''), nullif(trim(au.raw_user_meta_data->>'full_name'),'')) as full_name,
  rr.role_code,
  rr.role_rank,
  pc.company_code as primary_company_code,
  pc.company_name as primary_company_name,
  pwc.work_context_code as primary_work_context_code,
  pwc.work_context_name as primary_work_context_name,
  u.auth_user_id,
  u.created_at as user_created_at,
  au.last_sign_in_at,
  au.created_at as auth_created_at
from target_codes tc
left join erp_core.users u on u.user_code = tc.user_code
left join auth.users au on au.id = u.auth_user_id
left join role_rows rr on rr.auth_user_id = u.auth_user_id and rr.rn = 1
left join primary_company pc on pc.auth_user_id = u.auth_user_id and pc.rn = 1
left join primary_work_context pwc on pwc.auth_user_id = u.auth_user_id and pwc.rn = 1
order by tc.user_code;
`;

  const auditQuery = `
with target_users as (
  select
    tc.user_code,
    u.auth_user_id,
    coalesce(nullif(trim(au.raw_user_meta_data->>'display_name'),''), nullif(trim(au.raw_user_meta_data->>'name'),''), nullif(trim(au.raw_user_meta_data->>'full_name'),'')) as full_name,
    rr.role_code,
    rr.role_rank
  from (${targetCodesCte}) tc
  left join erp_core.users u on u.user_code = tc.user_code
  left join auth.users au on au.id = u.auth_user_id
  left join lateral (
    select role_code, role_rank
    from erp_acl.user_roles ur
    where ur.auth_user_id = u.auth_user_id
    order by role_rank desc, assigned_at desc nulls last
    limit 1
  ) rr on true
), active_actions as (
  select pav.auth_user_id, pav.company_id, pav.work_context_id, pav.resource_code,
         string_agg(pav.action_code, ',' order by pav.action_code) as allowed_actions
  from acl.precomputed_acl_view pav
  join acl.acl_versions av on av.acl_version_id = pav.acl_version_id and av.is_active = true
  where pav.decision = 'ALLOW'
  group by pav.auth_user_id, pav.company_id, pav.work_context_id, pav.resource_code
), latest_menu as (
  select *
  from (
    select
      ms.user_id,
      ms.company_id,
      ms.work_context_id,
      ms.menu_code,
      ms.tx_code,
      ms.title,
      ms.route_path,
      ms.is_visible,
      ms.snapshot_version,
      row_number() over (
        partition by ms.user_id, ms.company_id, ms.work_context_id, ms.menu_code
        order by ms.snapshot_version desc, ms.created_at desc
      ) as rn
    from erp_menu.menu_snapshot ms
    where ms.universe = 'ACL'
  ) ranked
  where rn = 1
)
select
  tu.user_code,
  tu.full_name,
  tu.role_code,
  tu.role_rank,
  co.company_code,
  co.company_name,
  wc.work_context_code,
  wc.work_context_name,
  lm.tx_code,
  lm.menu_code,
  lm.title,
  lm.route_path,
  aa.allowed_actions,
  lm.is_visible,
  lm.snapshot_version,
  case
    when aa.allowed_actions like '%VIEW%' and lm.is_visible = true then 'OK'
    when (aa.allowed_actions is null or aa.allowed_actions not like '%VIEW%') and lm.is_visible = false then 'OK'
    else 'NOT OK'
  end as snapshot_status
from target_users tu
join latest_menu lm on lm.user_id = tu.auth_user_id
left join active_actions aa
  on aa.auth_user_id = lm.user_id
 and aa.company_id = lm.company_id
 and aa.work_context_id = lm.work_context_id
 and aa.resource_code = lm.menu_code
left join erp_master.companies co on co.id = lm.company_id
left join erp_acl.work_contexts wc on wc.work_context_id = lm.work_context_id
order by tu.user_code, co.company_code, wc.work_context_code, lm.menu_code;
`;

  const userDirectoryRows = asRows(await runSql(token, userDirectoryQuery));
  const auditRows = asRows(await runSql(token, auditQuery));
  const grantedRows = auditRows.filter((row) => row.allowed_actions);

  const workbook = Workbook.create();
  buildUserDirectorySheet(workbook, userDirectoryRows);
  buildGrantedAccessSheet(workbook, grantedRows);
  buildSnapshotAuditSheet(workbook, auditRows);

  const summarySheet = workbook.worksheets.add("Summary");
  summarySheet.getRange("A1:F8").values = [
    ["Permission Audit Summary", "", "", "", "", ""],
    ["Generated On", new Date("2026-08-01T00:00:00Z"), "", "", "", ""],
    ["Users Requested", userCodes.length, "", "", "", ""],
    ["Granted Access Rows", grantedRows.length, "", "", "", ""],
    ["Snapshot Audit Rows", auditRows.length, "", "", "", ""],
    ["Snapshot OK Rows", auditRows.filter((row) => row.snapshot_status === "OK").length, "", "", "", ""],
    ["Snapshot NOT OK Rows", auditRows.filter((row) => row.snapshot_status === "NOT OK").length, "", "", "", ""],
    ["Source", "Production active ACL snapshot + latest ACL menu snapshot", "", "", "", ""],
  ];
  summarySheet.getRange("A1:F1").merge();
  summarySheet.getRange("A1:F1").format.fill.color = "#0B5394";
  summarySheet.getRange("A1:F1").format.font.color = "#FFFFFF";
  summarySheet.getRange("A1:F1").format.font.bold = true;
  summarySheet.getRange("A1:F1").format.font.size = 16;
  summarySheet.getRange("A2:B8").format.borders = { preset: "all", style: "thin", color: "#D9E2F3" };
  summarySheet.getRange("A2:A8").format.font.bold = true;
  summarySheet.getRange("B2:B8").format.horizontalAlignment = "Right";
  summarySheet.getRange("B2").setNumberFormat("yyyy-mm-dd");
  summarySheet.showGridLines = false;
  summarySheet.freezePanes.freezeRows(1);
  summarySheet.getRange("A1:F10").format.autofitColumns();
  summarySheet.getRange("A1:F10").format.autofitRows();

  const workbookCheck = await workbook.inspect({
    kind: "table",
    range: "A1:P12",
    sheetId: "Granted Access",
    include: "values",
    tableMaxRows: 12,
    tableMaxCols: 16,
  });
  await fs.writeFile(path.join(outputDir, "inspect-granted-access.txt"), workbookCheck.ndjson, "utf8");

  await saveRenderPreview(workbook, "Summary", "A1:F8", "summary.png");
  await saveRenderPreview(workbook, "Granted Access", "A1:P40", "granted-access.png");
  await saveRenderPreview(workbook, "Snapshot Audit", "A1:P40", "snapshot-audit.png");

  const output = await SpreadsheetFile.exportXlsx(workbook);
  const workbookPath = path.join(outputDir, "prod-permission-audit.xlsx");
  await output.save(workbookPath);

  await fs.writeFile(
    path.join(outputDir, "build-metadata.json"),
    JSON.stringify(
      {
        workbookPath,
        userCount: userCodes.length,
        grantedRows: grantedRows.length,
        auditRows: auditRows.length,
        notOkRows: auditRows.filter((row) => row.snapshot_status === "NOT OK").length,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(JSON.stringify({ workbookPath, previewDir }, null, 2));
}

await main();
