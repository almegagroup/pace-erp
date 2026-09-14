import {
  type CommunicationActionVisibilityDependencies,
  resolveCommunicationActionVisibility,
} from "./runtime_visibility.handlers.ts";
import { findCommunicationSurfaceManifest } from "./surface_manifest.ts";

function assertEquals<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const VALID_INPUT = {
  tx_code: "PO11",
  resource_code: "PROC_PLANNING_VIEW",
  surface_key: "planning_dashboard",
  channel: "EMAIL",
  company_id: "company-1",
};

function dependencies(
  overrides: Partial<CommunicationActionVisibilityDependencies> = {},
): CommunicationActionVisibilityDependencies {
  return {
    findManifest: findCommunicationSurfaceManifest,
    resolveCatalogPage: async () => ({
      id: "po11-menu-id",
      tx_code: "PO11",
      resource_code: "PROC_PLANNING_VIEW",
      title: "Procurement Planning",
    }),
    resolveEnrollment: async () => ({
      id: "enrollment-1",
      active: true,
      email_enabled: true,
    }),
    isSurfaceEnrolled: async (_enrollmentId, surfaceKey) =>
      surfaceKey === "planning_dashboard",
    assertCompanyScope: async () => undefined,
    canAccessPage: async () => true,
    ...overrides,
  };
}

async function resolve(
  overrides: Partial<CommunicationActionVisibilityDependencies> = {},
  input: unknown = VALID_INPUT,
) {
  return resolveCommunicationActionVisibility(input, dependencies(overrides));
}

Deno.test("runtime visibility allows an authorized user with active Email enrollment", async () => {
  const result = await resolve();
  assertEquals(result, {
    visible: true,
    page: {
      tx_code: "PO11",
      resource_code: "PROC_PLANNING_VIEW",
      title: "Procurement Planning",
    },
    surface: { key: "planning_dashboard", label: "Planning Dashboard" },
    channel: "EMAIL",
  });
});

Deno.test("runtime visibility fails closed without a communication surface manifest", async () => {
  assertEquals(await resolve({ findManifest: () => null }), { visible: false });
});

Deno.test("runtime visibility fails closed for unknown surface", async () => {
  assertEquals(await resolve({}, { ...VALID_INPUT, surface_key: "invented" }), {
    visible: false,
  });
});

Deno.test("runtime visibility fails closed for unsupported channel", async () => {
  assertEquals(await resolve({}, { ...VALID_INPUT, channel: "WHATSAPP" }), {
    visible: false,
  });
});

Deno.test("runtime visibility requires a page enrollment", async () => {
  assertEquals(await resolve({ resolveEnrollment: async () => null }), {
    visible: false,
  });
});

Deno.test("runtime visibility requires an active page enrollment", async () => {
  assertEquals(
    await resolve({
      resolveEnrollment: async () => ({
        id: "enrollment-1",
        active: false,
        email_enabled: true,
      }),
    }),
    { visible: false },
  );
});

Deno.test("runtime visibility requires Email enabled", async () => {
  assertEquals(
    await resolve({
      resolveEnrollment: async () => ({
        id: "enrollment-1",
        active: true,
        email_enabled: false,
      }),
    }),
    { visible: false },
  );
});

Deno.test("runtime visibility requires the exact active surface enrollment", async () => {
  assertEquals(await resolve({ isSurfaceEnrolled: async () => false }), {
    visible: false,
  });
  assertEquals(
    await resolve({}, { ...VALID_INPUT, surface_key: "monthly_plan_input" }),
    { visible: false },
  );
});

Deno.test("runtime visibility respects page-local company scope and ACL", async () => {
  assertEquals(await resolve({ canAccessPage: async () => false }), {
    visible: false,
  });
  assertEquals(
    await resolve({
      assertCompanyScope: async () => {
        throw new Error("COMPANY_SCOPE_VIOLATION");
      },
    }),
    { visible: false },
  );
});

Deno.test("runtime visibility does not require SA or GA enrollment authority", async () => {
  let accessChecks = 0;
  const result = await resolve({
    canAccessPage: async (companyId, resourceCode) => {
      accessChecks += 1;
      return companyId === "company-1" && resourceCode === "PROC_PLANNING_VIEW";
    },
  });
  assertEquals(result.visible, true);
  assertEquals(accessChecks, 1);
});

Deno.test("runtime visibility has no enrollment mutation dependency", async () => {
  const source = dependencies();
  assertEquals("saveEnrollment" in source, false);
  assertEquals("updateEnrollment" in source, false);
  assertEquals("deleteEnrollment" in source, false);
});

Deno.test("runtime visibility rejects malformed identity without catalog or enrollment reads", async () => {
  let catalogReads = 0;
  let enrollmentReads = 0;
  const result = await resolve({
    resolveCatalogPage: async () => {
      catalogReads += 1;
      return null;
    },
    resolveEnrollment: async () => {
      enrollmentReads += 1;
      return null;
    },
  }, { ...VALID_INPUT, company_id: "" });
  assertEquals(result, { visible: false });
  assertEquals(catalogReads, 0);
  assertEquals(enrollmentReads, 0);
});
