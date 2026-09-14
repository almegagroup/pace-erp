/*
 * Communication Automation — Phase 1 enrollment contracts.
 *
 * These routes are intentionally SA/admin-only.  They never expose direct
 * browser access to erp_communication, and they validate every selected
 * surface against the code-owned surface manifest.
 */

import type { ContextResolution } from "../../../_pipeline/context.ts";
import { getServiceRoleClientWithContext } from "../../../_shared/serviceRoleClient.ts";
import { errorResponse, okResponse } from "../../response.ts";
import {
  assertCommunicationChannelSupported,
  assertCommunicationSurfaceSupported,
  findCommunicationSurfaceManifest,
  listCommunicationSurfaces,
  type CommunicationSurfaceManifest,
  CommunicationManifestValidationError,
} from "../../communication/surface_manifest.ts";

type HandlerContext = {
  context: ContextResolution;
  request_id: string;
  auth_user_id: string;
};

type CatalogPageRow = {
  id: string;
  menu_code: string;
  tx_code: string | null;
  resource_code: string;
  title: string;
  route_path: string | null;
  menu_type: "GROUP" | "PAGE";
  universe: "SA" | "ACL";
  is_active: boolean;
};

type PageEnrollmentRow = {
  id: string;
  page_menu_id: string;
  email_enabled: boolean;
  active: boolean;
  created_at: string;
  last_updated_at: string;
};

type SurfaceEnrollmentRow = {
  id: string;
  surface_key: string;
  active: boolean;
};

type EnrollmentMutationInput = {
  page_menu_id: string;
  email_enabled: boolean;
  active: boolean;
  surface_keys: string[];
  channel?: string;
};

function assertAdmin(ctx: HandlerContext): asserts ctx is HandlerContext & {
  context: Extract<ContextResolution, { status: "RESOLVED" }> & { isAdmin: true };
} {
  if (ctx.context.status !== "RESOLVED" || ctx.context.isAdmin !== true) {
    throw new Error("ADMIN_ONLY");
  }
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseMutationInput(value: unknown): EnrollmentMutationInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_COMMUNICATION_ENROLLMENT_INPUT");
  }

  const body = value as Record<string, unknown>;
  const pageMenuId = asTrimmedString(body.page_menu_id);
  if (!pageMenuId || typeof body.email_enabled !== "boolean" || !Array.isArray(body.surface_keys)) {
    throw new Error("INVALID_COMMUNICATION_ENROLLMENT_INPUT");
  }
  if (body.active !== undefined && typeof body.active !== "boolean") {
    throw new Error("INVALID_COMMUNICATION_ENROLLMENT_INPUT");
  }
  if (body.channel !== undefined && typeof body.channel !== "string") {
    throw new Error("INVALID_COMMUNICATION_ENROLLMENT_INPUT");
  }

  const surfaceKeys = body.surface_keys.map(asTrimmedString);
  if (surfaceKeys.some((key) => key === null)) {
    throw new Error("INVALID_COMMUNICATION_ENROLLMENT_INPUT");
  }
  const normalizedSurfaceKeys = surfaceKeys as string[];
  if (new Set(normalizedSurfaceKeys).size !== normalizedSurfaceKeys.length) {
    throw new Error("DUPLICATE_COMMUNICATION_SURFACE");
  }

  return {
    page_menu_id: pageMenuId,
    email_enabled: body.email_enabled,
    active: body.active ?? true,
    surface_keys: normalizedSurfaceKeys,
    channel: body.channel as string | undefined,
  };
}

async function findActiveCatalogPage(
  db: ReturnType<typeof getServiceRoleClientWithContext>,
  pageMenuId: string,
): Promise<{ page: CatalogPageRow | null; error: string | null }> {
  const { data, error } = await db
    .schema("erp_menu")
    .from("menu_master")
    .select("id, menu_code, tx_code, resource_code, title, route_path, menu_type, universe, is_active")
    .eq("id", pageMenuId)
    .eq("menu_type", "PAGE")
    .eq("is_active", true)
    .maybeSingle();

  return {
    page: (data as CatalogPageRow | null) ?? null,
    error: error?.message ?? null,
  };
}

async function readEnrollmentRows(
  db: ReturnType<typeof getServiceRoleClientWithContext>,
  pageMenuId: string,
): Promise<{
  enrollment: PageEnrollmentRow | null;
  surfaces: SurfaceEnrollmentRow[];
  error: string | null;
}> {
  const { data: enrollmentData, error: enrollmentError } = await db
    .schema("erp_communication")
    .from("page_enrollment")
    .select("id, page_menu_id, email_enabled, active, created_at, last_updated_at")
    .eq("page_menu_id", pageMenuId)
    .maybeSingle();

  if (enrollmentError) {
    return { enrollment: null, surfaces: [], error: enrollmentError.message };
  }

  const enrollment = (enrollmentData as PageEnrollmentRow | null) ?? null;
  if (!enrollment) {
    return { enrollment: null, surfaces: [], error: null };
  }

  const { data: surfaceData, error: surfaceError } = await db
    .schema("erp_communication")
    .from("surface_enrollment")
    .select("id, surface_key, active")
    .eq("page_enrollment_id", enrollment.id);

  return {
    enrollment,
    surfaces: (surfaceData as SurfaceEnrollmentRow[] | null) ?? [],
    error: surfaceError?.message ?? null,
  };
}

function statePayload(
  page: CatalogPageRow,
  manifest: CommunicationSurfaceManifest | null,
  enrollment: PageEnrollmentRow | null,
  surfaceRows: SurfaceEnrollmentRow[],
) {
  const selectedSurfaceKeys = new Set(
    enrollment?.active === true
      ? surfaceRows.filter((row) => row.active).map((row) => row.surface_key)
      : [],
  );

  return {
    page: {
      page_menu_id: page.id,
      tx_code: page.tx_code,
      resource_code: page.resource_code,
      title: page.title,
      route_path: page.route_path,
      communication_capable: manifest !== null,
      enlisted: enrollment?.active === true,
      email_enabled: enrollment?.active === true && enrollment.email_enabled === true,
      enrollment_active: enrollment?.active ?? false,
      enrollment_id: enrollment?.id ?? null,
      last_updated_at: enrollment?.last_updated_at ?? null,
    },
    surfaces: listCommunicationSurfaces(manifest).map((surface) => ({
      key: surface.key,
      label: surface.label,
      supported_channels: [...surface.supported_channels],
      selected: selectedSurfaceKeys.has(surface.key),
    })),
  };
}

export async function searchCommunicationPagesHandler(
  req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const query = asTrimmedString(new URL(req.url).searchParams.get("q"));
    if (!query || query.length > 100) {
      return errorResponse(
        "INVALID_COMMUNICATION_SEARCH",
        "Search text must be between 1 and 100 characters",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);
    const { data, error } = await db
      .schema("erp_menu")
      .from("menu_master")
      .select("id, menu_code, tx_code, resource_code, title, route_path, menu_type, universe, is_active")
      .eq("menu_type", "PAGE")
      .eq("is_active", true)
      .order("title", { ascending: true })
      .limit(500);

    if (error) {
      return errorResponse(
        "COMMUNICATION_PAGE_SEARCH_FAILED",
        "Unable to search PACE pages",
        ctx.request_id,
        "NONE",
        500,
      );
    }

    const normalizedQuery = query.toLocaleLowerCase();
    const pages = ((data ?? []) as CatalogPageRow[])
      .filter((page) =>
        page.menu_code.toLocaleLowerCase().includes(normalizedQuery) ||
        (page.tx_code ?? "").toLocaleLowerCase().includes(normalizedQuery) ||
        page.title.toLocaleLowerCase().includes(normalizedQuery)
      )
      .slice(0, 50);
    const pageIds = pages.map((page) => page.id);

    const { data: enrollmentData, error: enrollmentError } = pageIds.length === 0
      ? { data: [], error: null }
      : await db
        .schema("erp_communication")
        .from("page_enrollment")
        .select("page_menu_id, active")
        .in("page_menu_id", pageIds);

    if (enrollmentError) {
      return errorResponse(
        "COMMUNICATION_ENROLLMENT_READ_FAILED",
        "Unable to read page enrollment",
        ctx.request_id,
        "NONE",
        500,
      );
    }

    const enlistedPageIds = new Set(
      ((enrollmentData ?? []) as Array<{ page_menu_id: string; active: boolean }>)
        .filter((row) => row.active)
        .map((row) => row.page_menu_id),
    );

    return okResponse({
      pages: pages.map((page) => ({
        page_menu_id: page.id,
        tx_code: page.tx_code,
        resource_code: page.resource_code,
        title: page.title,
        route_path: page.route_path,
        enlisted: enlistedPageIds.has(page.id),
        communication_capable: findCommunicationSurfaceManifest(page) !== null,
      })),
    }, ctx.request_id, req);
  } catch (error) {
    const code = (error as Error).message || "COMMUNICATION_PAGE_SEARCH_EXCEPTION";
    return errorResponse(
      code,
      code === "ADMIN_ONLY" ? "Administrator access is required" : "Unable to search PACE pages",
      ctx.request_id,
      "NONE",
      code === "ADMIN_ONLY" ? 403 : 500,
      undefined,
      req,
    );
  }
}

export async function getCommunicationEnrollmentHandler(
  req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  try {
    assertAdmin(ctx);

    const pageMenuId = asTrimmedString(new URL(req.url).searchParams.get("page_menu_id"));
    if (!pageMenuId) {
      return errorResponse(
        "INVALID_COMMUNICATION_PAGE",
        "page_menu_id is required",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    const db = getServiceRoleClientWithContext(ctx.context);
    const pageResult = await findActiveCatalogPage(db, pageMenuId);
    if (pageResult.error) {
      return errorResponse(
        "COMMUNICATION_PAGE_READ_FAILED",
        "Unable to read PACE page",
        ctx.request_id,
        "NONE",
        500,
      );
    }
    if (!pageResult.page) {
      return errorResponse(
        "COMMUNICATION_PAGE_NOT_FOUND",
        "PACE page not found or inactive",
        ctx.request_id,
        "NONE",
        404,
      );
    }

    const enrollmentResult = await readEnrollmentRows(db, pageResult.page.id);
    if (enrollmentResult.error) {
      return errorResponse(
        "COMMUNICATION_ENROLLMENT_READ_FAILED",
        "Unable to read page enrollment",
        ctx.request_id,
        "NONE",
        500,
      );
    }

    return okResponse(
      statePayload(
        pageResult.page,
        findCommunicationSurfaceManifest(pageResult.page),
        enrollmentResult.enrollment,
        enrollmentResult.surfaces,
      ),
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = (error as Error).message || "COMMUNICATION_ENROLLMENT_READ_EXCEPTION";
    return errorResponse(
      code,
      code === "ADMIN_ONLY" ? "Administrator access is required" : "Unable to read page enrollment",
      ctx.request_id,
      "NONE",
      code === "ADMIN_ONLY" ? 403 : 500,
      undefined,
      req,
    );
  }
}

export async function upsertCommunicationEnrollmentHandler(
  req: Request,
  ctx: HandlerContext,
): Promise<Response> {
  try {
    assertAdmin(ctx);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse(
        "INVALID_COMMUNICATION_ENROLLMENT_INPUT",
        "Invalid enrollment request",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    const input = parseMutationInput(body);
    const db = getServiceRoleClientWithContext(ctx.context);
    const pageResult = await findActiveCatalogPage(db, input.page_menu_id);
    if (pageResult.error) {
      return errorResponse(
        "COMMUNICATION_PAGE_READ_FAILED",
        "Unable to read PACE page",
        ctx.request_id,
        "NONE",
        500,
      );
    }
    if (!pageResult.page) {
      return errorResponse(
        "COMMUNICATION_PAGE_NOT_FOUND",
        "PACE page not found or inactive",
        ctx.request_id,
        "NONE",
        404,
      );
    }

    const manifest = findCommunicationSurfaceManifest(pageResult.page);
    if (!manifest) {
      return errorResponse(
        "COMMUNICATION_MANIFEST_NOT_FOUND",
        "This PACE page is not communication-capable",
        ctx.request_id,
        "NONE",
        400,
      );
    }

    const requestedChannel = input.channel ?? "EMAIL";
    assertCommunicationChannelSupported(manifest, requestedChannel);
    for (const surfaceKey of input.surface_keys) {
      assertCommunicationSurfaceSupported(manifest, surfaceKey, requestedChannel);
    }

    const current = await readEnrollmentRows(db, pageResult.page.id);
    if (current.error) {
      return errorResponse(
        "COMMUNICATION_ENROLLMENT_READ_FAILED",
        "Unable to read page enrollment",
        ctx.request_id,
        "NONE",
        500,
      );
    }

    const timestamp = new Date().toISOString();
    let enrollmentId = current.enrollment?.id ?? null;
    if (enrollmentId) {
      const { error } = await db
        .schema("erp_communication")
        .from("page_enrollment")
        .update({
          menu_code_snapshot: pageResult.page.menu_code,
          resource_code_snapshot: pageResult.page.resource_code,
          email_enabled: input.email_enabled,
          active: input.active,
          last_updated_at: timestamp,
          last_updated_by: ctx.auth_user_id,
        })
        .eq("id", enrollmentId);
      if (error) {
        return errorResponse(
          "COMMUNICATION_ENROLLMENT_UPDATE_FAILED",
          "Unable to update page enrollment",
          ctx.request_id,
          "NONE",
          500,
        );
      }
    } else {
      const { data, error } = await db
        .schema("erp_communication")
        .from("page_enrollment")
        .insert({
          page_menu_id: pageResult.page.id,
          menu_code_snapshot: pageResult.page.menu_code,
          resource_code_snapshot: pageResult.page.resource_code,
          email_enabled: input.email_enabled,
          active: input.active,
          created_at: timestamp,
          created_by: ctx.auth_user_id,
          last_updated_at: timestamp,
          last_updated_by: ctx.auth_user_id,
        })
        .select("id")
        .single();
      if (error || !data) {
        return errorResponse(
          "COMMUNICATION_ENROLLMENT_CREATE_FAILED",
          "Unable to create page enrollment",
          ctx.request_id,
          "NONE",
          500,
        );
      }
      enrollmentId = (data as { id: string }).id;
    }

    const selectedSurfaceKeys = new Set(input.surface_keys);
    const currentSurfaceByKey = new Map(
      current.surfaces.map((surface) => [surface.surface_key, surface]),
    );

    for (const surfaceKey of input.surface_keys) {
      const currentSurface = currentSurfaceByKey.get(surfaceKey);
      if (currentSurface) {
        const { error } = await db
          .schema("erp_communication")
          .from("surface_enrollment")
          .update({
            active: input.active,
            last_updated_at: timestamp,
            last_updated_by: ctx.auth_user_id,
          })
          .eq("id", currentSurface.id);
        if (error) {
          return errorResponse(
            "COMMUNICATION_SURFACE_UPDATE_FAILED",
            "Unable to update communication surface",
            ctx.request_id,
            "NONE",
            500,
          );
        }
      } else {
        const { error } = await db
          .schema("erp_communication")
          .from("surface_enrollment")
          .insert({
            page_enrollment_id: enrollmentId,
            surface_key: surfaceKey,
            active: input.active,
            created_at: timestamp,
            created_by: ctx.auth_user_id,
            last_updated_at: timestamp,
            last_updated_by: ctx.auth_user_id,
          });
        if (error) {
          return errorResponse(
            "COMMUNICATION_SURFACE_CREATE_FAILED",
            "Unable to create communication surface",
            ctx.request_id,
            "NONE",
            500,
          );
        }
      }
    }

    for (const currentSurface of current.surfaces) {
      if (selectedSurfaceKeys.has(currentSurface.surface_key)) continue;
      const { error } = await db
        .schema("erp_communication")
        .from("surface_enrollment")
        .update({
          active: false,
          last_updated_at: timestamp,
          last_updated_by: ctx.auth_user_id,
        })
        .eq("id", currentSurface.id);
      if (error) {
        return errorResponse(
          "COMMUNICATION_SURFACE_UPDATE_FAILED",
          "Unable to update communication surface",
          ctx.request_id,
          "NONE",
          500,
        );
      }
    }

    const refreshed = await readEnrollmentRows(db, pageResult.page.id);
    if (refreshed.error) {
      return errorResponse(
        "COMMUNICATION_ENROLLMENT_READ_FAILED",
        "Enrollment was saved but could not be re-read",
        ctx.request_id,
        "NONE",
        500,
      );
    }

    return okResponse(
      statePayload(pageResult.page, manifest, refreshed.enrollment, refreshed.surfaces),
      ctx.request_id,
      req,
    );
  } catch (error) {
    const code = error instanceof CommunicationManifestValidationError
      ? error.code
      : (error as Error).message || "COMMUNICATION_ENROLLMENT_EXCEPTION";
    const status = [
      "ADMIN_ONLY",
      "INVALID_COMMUNICATION_ENROLLMENT_INPUT",
      "DUPLICATE_COMMUNICATION_SURFACE",
      "UNSUPPORTED_COMMUNICATION_CHANNEL",
      "INVALID_COMMUNICATION_SURFACE",
    ].includes(code)
      ? (code === "ADMIN_ONLY" ? 403 : 400)
      : 500;
    return errorResponse(
      code,
      code === "ADMIN_ONLY" ? "Administrator access is required" : "Invalid communication enrollment request",
      ctx.request_id,
      "NONE",
      status,
      undefined,
      req,
    );
  }
}
