/*
 * Runtime Communication Automation visibility.
 *
 * This is deliberately separate from the SA/GA enrollment-management API.
 * It exposes one fail-closed read decision and never returns enrollment IDs,
 * surface configuration, or mutation capability to normal page users.
 */

import type { ContextResolution } from "../../_pipeline/context.ts";
import { assertCompanyScope } from "../../_shared/companyScope.ts";
import { canMaintainCompanyResource } from "../../_shared/companyResourceAccess.ts";
import { getServiceRoleClientWithContext } from "../../_shared/serviceRoleClient.ts";
import { okResponse } from "../response.ts";
import {
  assertCommunicationSurfaceSupported,
  type CommunicationChannel,
  type CommunicationManifestPageIdentity,
  type CommunicationSurface,
  type CommunicationSurfaceManifest,
  findCommunicationSurfaceManifest,
} from "./surface_manifest.ts";

type HandlerContext = {
  context: Extract<ContextResolution, { status: "RESOLVED" }>;
  request_id: string;
  auth_user_id: string;
  roleCode: string;
};

type RuntimeCatalogPage = {
  id: string;
  tx_code: string | null;
  resource_code: string;
  title: string;
};

type RuntimeEnrollment = {
  id: string;
  active: boolean;
  email_enabled: boolean;
};

export type CommunicationActionVisibilityInput = {
  tx_code: string;
  resource_code: string;
  surface_key: string;
  channel: string;
  company_id?: string;
};

export type CommunicationActionVisibilityResult =
  | { visible: false }
  | {
    visible: true;
    page: { tx_code: string; resource_code: string; title: string };
    surface: { key: string; label: string };
    channel: CommunicationChannel;
  };

export type CommunicationActionVisibilityDependencies = {
  findManifest(
    page: CommunicationManifestPageIdentity,
  ): CommunicationSurfaceManifest | null;
  resolveCatalogPage(
    page: CommunicationManifestPageIdentity,
  ): Promise<RuntimeCatalogPage | null>;
  resolveEnrollment(
    pageMenuId: string,
  ): Promise<RuntimeEnrollment | null>;
  isSurfaceEnrolled(
    enrollmentId: string,
    surfaceKey: string,
  ): Promise<boolean>;
  assertCompanyScope(companyId: string): Promise<void>;
  canAccessPage(
    companyId: string,
    resourceCode: string,
    action: "EDIT",
  ): Promise<boolean>;
};

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 160 ? normalized : null;
}

export function parseCommunicationActionVisibilityInput(
  value: unknown,
): CommunicationActionVisibilityInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const txCode = nonEmptyString(record.tx_code);
  const resourceCode = nonEmptyString(record.resource_code);
  const surfaceKey = nonEmptyString(record.surface_key);
  const channel = nonEmptyString(record.channel);
  const companyId =
    record.company_id === undefined || record.company_id === null
      ? undefined
      : nonEmptyString(record.company_id);

  if (!txCode || !resourceCode || !surfaceKey || !channel) return null;
  if (
    (record.company_id !== undefined && record.company_id !== null) &&
    !companyId
  ) {
    return null;
  }

  return {
    tx_code: txCode,
    resource_code: resourceCode,
    surface_key: surfaceKey,
    channel,
    company_id: companyId ?? undefined,
  };
}

/**
 * Resolves only the runtime action decision. Every invalid or unavailable
 * dependency fails closed so the optional UI action never grants information.
 */
export async function resolveCommunicationActionVisibility(
  value: unknown,
  dependencies: CommunicationActionVisibilityDependencies,
): Promise<CommunicationActionVisibilityResult> {
  const input = parseCommunicationActionVisibilityInput(value);
  if (!input) return { visible: false };

  try {
    const page: CommunicationManifestPageIdentity = {
      tx_code: input.tx_code,
      resource_code: input.resource_code,
    };
    const manifest = dependencies.findManifest(page);
    if (!manifest) return { visible: false };

    let surface: CommunicationSurface;
    try {
      surface = assertCommunicationSurfaceSupported(
        manifest,
        input.surface_key,
        input.channel,
      );
    } catch {
      return { visible: false };
    }

    // The canonical runtime resource check today is company-specific. Do not
    // let a future non-company manifest become visible before a dedicated
    // global page-ACL resolver is introduced.
    if (manifest.page.company_scoped !== true) {
      return { visible: false };
    }
    if (!input.company_id) {
      return { visible: false };
    }
    const catalogPage = await dependencies.resolveCatalogPage(page);
    if (!catalogPage) return { visible: false };

    const enrollment = await dependencies.resolveEnrollment(catalogPage.id);
    if (
      !enrollment || enrollment.active !== true ||
      enrollment.email_enabled !== true
    ) {
      return { visible: false };
    }
    if (!await dependencies.isSurfaceEnrolled(enrollment.id, surface.key)) {
      return { visible: false };
    }

    const companyId = input.company_id;
    await dependencies.assertCompanyScope(companyId);
    if (
      !await dependencies.canAccessPage(companyId, catalogPage.resource_code, "EDIT")
    ) {
      return { visible: false };
    }

    return {
      visible: true,
      page: {
        tx_code: catalogPage.tx_code ?? manifest.page.tx_code,
        resource_code: catalogPage.resource_code,
        title: catalogPage.title,
      },
      surface: { key: surface.key, label: surface.label },
      channel: input.channel as CommunicationChannel,
    };
  } catch {
    return { visible: false };
  }
}

async function resolveActiveCatalogPage(
  ctx: HandlerContext,
  page: CommunicationManifestPageIdentity,
): Promise<RuntimeCatalogPage | null> {
  const db = getServiceRoleClientWithContext(ctx.context);
  const { data, error } = await db
    .schema("erp_menu")
    .from("menu_master")
    .select("id, tx_code, resource_code, title")
    .eq("tx_code", page.tx_code)
    .eq("resource_code", page.resource_code)
    .eq("menu_type", "PAGE")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error("COMMUNICATION_RUNTIME_PAGE_READ_FAILED");
  return (data as RuntimeCatalogPage | null) ?? null;
}

async function resolveActiveEnrollment(
  ctx: HandlerContext,
  pageMenuId: string,
): Promise<RuntimeEnrollment | null> {
  const db = getServiceRoleClientWithContext(ctx.context);
  const { data, error } = await db
    .schema("erp_communication")
    .from("page_enrollment")
    .select("id, active, email_enabled")
    .eq("page_menu_id", pageMenuId)
    .maybeSingle();
  if (error) throw new Error("COMMUNICATION_RUNTIME_ENROLLMENT_READ_FAILED");
  return (data as RuntimeEnrollment | null) ?? null;
}

async function isActiveSurfaceEnrollment(
  ctx: HandlerContext,
  enrollmentId: string,
  surfaceKey: string,
): Promise<boolean> {
  const db = getServiceRoleClientWithContext(ctx.context);
  const { data, error } = await db
    .schema("erp_communication")
    .from("surface_enrollment")
    .select("surface_key")
    .eq("page_enrollment_id", enrollmentId)
    .eq("surface_key", surfaceKey)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error("COMMUNICATION_RUNTIME_SURFACE_READ_FAILED");
  return Boolean(data);
}

export async function getCommunicationActionVisibilityHandler(
  req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  const url = new URL(req.url);
  const result = await resolveCommunicationActionVisibility(
    {
      tx_code: url.searchParams.get("tx_code"),
      resource_code: url.searchParams.get("resource_code"),
      surface_key: url.searchParams.get("surface_key"),
      channel: url.searchParams.get("channel"),
      company_id: url.searchParams.get("company_id"),
    },
    {
      findManifest: findCommunicationSurfaceManifest,
      resolveCatalogPage: (page) => resolveActiveCatalogPage(ctx, page),
      resolveEnrollment: (pageMenuId) =>
        resolveActiveEnrollment(ctx, pageMenuId),
      isSurfaceEnrolled: (enrollmentId, surfaceKey) =>
        isActiveSurfaceEnrollment(ctx, enrollmentId, surfaceKey),
      assertCompanyScope: (companyId) => assertCompanyScope(ctx, companyId),
      canAccessPage: (companyId, resourceCode) =>
        canMaintainCompanyResource(ctx, companyId, resourceCode, "EDIT"),
    },
  );

  return okResponse(result, ctx.request_id, req);
}
