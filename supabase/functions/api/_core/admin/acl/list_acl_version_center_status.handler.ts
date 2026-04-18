/*
 * File-ID: 9.11G
 * File-Path: supabase/functions/api/_core/admin/acl/list_acl_version_center_status.handler.ts
 * Gate: 9
 * Phase: 9
 * Domain: ACL
 * Purpose: Return company-wise ACL publish status, active versions, and system recommendations for the ACL Version Center.
 * Authority: Backend
 */

import type { ContextResolution } from "../../../_pipeline/context.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import { okResponse, errorResponse } from "../../response.ts";
import { generateRequestId } from "../../../_lib/request_id.ts";

type HandlerContext = {
  context: ContextResolution;
};

type CompanyRow = {
  id: string;
  company_code: string;
  company_name: string;
  status: string | null;
};

type VersionRow = {
  acl_version_id: string;
  company_id: string;
  version_number: number;
  description: string;
  is_active: boolean;
  created_at: string | null;
  created_by: string | null;
  source_captured_at: string | null;
  source_captured_by: string | null;
};

type VersionChangeEventRow = {
  event_id: string;
  company_id: string | null;
  source_table: string;
  reason_code: string;
  change_kind: string;
  summary: string;
  created_at: string;
};

function assertAdmin(
  ctx: HandlerContext,
): asserts ctx is {
  context: Extract<ContextResolution, { status: "RESOLVED" }> & { isAdmin: true };
} {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

function asTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dedupePendingReasons(events: VersionChangeEventRow[]) {
  const latestByReason = new Map<string, VersionChangeEventRow>();

  for (const event of events) {
    const current = latestByReason.get(event.reason_code);
    if (!current || asTimestamp(event.created_at) > asTimestamp(current.created_at)) {
      latestByReason.set(event.reason_code, event);
    }
  }

  return [...latestByReason.values()].sort(
    (left, right) => asTimestamp(right.created_at) - asTimestamp(left.created_at),
  );
}

function summarizeRecommendation(status: string, pendingReasons: VersionChangeEventRow[]) {
  if (status === "NO_ACTIVE_VERSION") {
    return "No active ACL version exists for this company. Capture and activate a publish snapshot before runtime users depend on this access setup.";
  }

  if (pendingReasons.length === 0) {
    return "Published ACL version is in sync with tracked access-governance sources.";
  }

  const summaries = pendingReasons
    .slice(0, 3)
    .map((reason) => reason.summary)
    .filter(Boolean);

  return summaries.length > 0
    ? `Publish recommended because ${summaries.join(" | ")}.`
    : "Publish recommended because tracked access-governance changes landed after the active ACL version was frozen.";
}

export async function listAclVersionCenterStatusHandler(
  _req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  const requestId = generateRequestId();

  try {
    assertAdmin(ctx);

    const db = getServiceRoleClientWithContext(ctx.context);

    const { data: companyData, error: companyError } = await db
      .schema("erp_master")
      .from("companies")
      .select("id, company_code, company_name, status")
      .eq("company_kind", "BUSINESS")
      .order("company_name", { ascending: true });

    if (companyError) {
      return errorResponse(
        "ACL_VERSION_CENTER_COMPANY_READ_FAILED",
        companyError.message,
        requestId,
      );
    }

    const companies = (companyData ?? []) as CompanyRow[];
    const companyIds = companies.map((company) => company.id);

    const { data: versionData, error: versionError } = companyIds.length === 0
      ? { data: [], error: null }
      : await db
        .schema("acl")
        .from("acl_versions")
        .select(`
          acl_version_id,
          company_id,
          version_number,
          description,
          is_active,
          created_at,
          created_by,
          source_captured_at,
          source_captured_by
        `)
        .in("company_id", companyIds)
        .order("version_number", { ascending: false });

    if (versionError) {
      return errorResponse(
        "ACL_VERSION_CENTER_VERSION_READ_FAILED",
        versionError.message,
        requestId,
      );
    }

    const { data: eventData, error: eventError } = await db
      .schema("acl")
      .from("version_change_events")
      .select(`
        event_id,
        company_id,
        source_table,
        reason_code,
        change_kind,
        summary,
        created_at
      `)
      .order("created_at", { ascending: false });

    if (eventError) {
      return errorResponse(
        "ACL_VERSION_CENTER_EVENT_READ_FAILED",
        eventError.message,
        requestId,
      );
    }

    const versions = (versionData ?? []) as VersionRow[];
    const events = (eventData ?? []) as VersionChangeEventRow[];
    const globalEvents = events.filter((event) => !event.company_id);
    const versionsByCompany = new Map<string, VersionRow[]>();
    const eventsByCompany = new Map<string, VersionChangeEventRow[]>();

    for (const version of versions) {
      const current = versionsByCompany.get(version.company_id) ?? [];
      current.push(version);
      versionsByCompany.set(version.company_id, current);
    }

    for (const event of events) {
      if (!event.company_id) continue;
      const current = eventsByCompany.get(event.company_id) ?? [];
      current.push(event);
      eventsByCompany.set(event.company_id, current);
    }

    const payload = companies.map((company) => {
      const companyVersions = versionsByCompany.get(company.id) ?? [];
      const activeVersion = companyVersions.find((version) => version.is_active) ?? null;
      const latestVersion = companyVersions[0] ?? null;
      const relevantEvents = [
        ...(eventsByCompany.get(company.id) ?? []),
        ...globalEvents,
      ];

      const pendingEvents = activeVersion?.source_captured_at
        ? relevantEvents.filter(
          (event) => asTimestamp(event.created_at) > asTimestamp(activeVersion.source_captured_at),
        )
        : relevantEvents;

      const pendingReasons = dedupePendingReasons(pendingEvents);
      const status = !activeVersion
        ? "NO_ACTIVE_VERSION"
        : pendingReasons.length > 0
          ? "PUBLISH_REQUIRED"
          : "CLEAN";

      return {
        company_id: company.id,
        company_code: company.company_code,
        company_name: company.company_name,
        company_status: company.status ?? "UNKNOWN",
        status,
        publish_required: status !== "CLEAN",
        recommendation: summarizeRecommendation(status, pendingReasons),
        latest_pending_change_at: pendingReasons[0]?.created_at ?? null,
        pending_change_count: pendingReasons.length,
        pending_reasons: pendingReasons.map((reason) => ({
          reason_code: reason.reason_code,
          source_table: reason.source_table,
          summary: reason.summary,
          change_kind: reason.change_kind,
          created_at: reason.created_at,
          is_global: !reason.company_id,
        })),
        active_version: activeVersion
          ? {
            acl_version_id: activeVersion.acl_version_id,
            version_number: activeVersion.version_number,
            description: activeVersion.description,
            created_at: activeVersion.created_at,
            source_captured_at: activeVersion.source_captured_at,
          }
          : null,
        latest_version: latestVersion
          ? {
            acl_version_id: latestVersion.acl_version_id,
            version_number: latestVersion.version_number,
            description: latestVersion.description,
            is_active: latestVersion.is_active,
            created_at: latestVersion.created_at,
            source_captured_at: latestVersion.source_captured_at,
          }
          : null,
        versions: companyVersions.map((version) => ({
          acl_version_id: version.acl_version_id,
          version_number: version.version_number,
          description: version.description,
          is_active: version.is_active,
          created_at: version.created_at,
          source_captured_at: version.source_captured_at,
        })),
      };
    });

    return okResponse({ companies: payload }, requestId);
  } catch (err) {
    return errorResponse(
      (err as Error).message || "ACL_VERSION_CENTER_EXCEPTION",
      "acl version center status exception",
      requestId,
    );
  }
}
