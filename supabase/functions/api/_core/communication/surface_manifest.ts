/*
 * Communication Automation — Phase 1 surface contract.
 *
 * This is deliberately code-owned.  `erp_menu.menu_master` remains the
 * discoverable PACE page catalog; this file only says which stable surfaces
 * of an enrolled page may later expose Communication Automation.
 */

export const COMMUNICATION_CHANNELS = ["EMAIL"] as const;

export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export type CommunicationSurface = {
  key: string;
  label: string;
  supported_channels: readonly CommunicationChannel[];
  activation: {
    kind: "TAB" | "ROUTE";
    tab_id?: string;
    route_path?: string;
  };
};

export type CommunicationSurfaceManifest = {
  page: {
    tx_code: string;
    resource_code: string;
    /** Whether runtime visibility requires an explicit page-local company. */
    company_scoped?: boolean;
  };
  surfaces: readonly CommunicationSurface[];
};

export type CommunicationManifestPageIdentity = {
  tx_code: string | null;
  resource_code: string;
};

export class CommunicationManifestValidationError extends Error {
  constructor(
    readonly code:
      | "COMMUNICATION_MANIFEST_NOT_FOUND"
      | "UNSUPPORTED_COMMUNICATION_CHANNEL"
      | "INVALID_COMMUNICATION_SURFACE",
  ) {
    super(code);
  }
}

// PO11's surface list is derived from the current dev implementation in
// ProcurementPlanningPage.jsx.  The report is a route-mode rendering of the
// same page and uses its visible in-product label, "Planning Dashboard Report".
const PO11_COMMUNICATION_SURFACE_MANIFEST: CommunicationSurfaceManifest = {
  page: {
    tx_code: "PO11",
    resource_code: "PROC_PLANNING_VIEW",
    company_scoped: true,
  },
  surfaces: [
    {
      key: "planning_dashboard",
      label: "Planning Dashboard",
      supported_channels: ["EMAIL"],
      activation: { kind: "TAB", tab_id: "dashboard" },
    },
    {
      key: "monthly_plan_input",
      label: "Monthly Plan Input",
      supported_channels: ["EMAIL"],
      activation: { kind: "TAB", tab_id: "input" },
    },
    {
      key: "sloc_group_setup",
      label: "SLOC Group Setup",
      supported_channels: ["EMAIL"],
      activation: { kind: "TAB", tab_id: "sloc" },
    },
    {
      key: "item_group_setup",
      label: "Item Group Setup",
      supported_channels: ["EMAIL"],
      activation: { kind: "TAB", tab_id: "item" },
    },
    {
      key: "history_archive",
      label: "History / Archive",
      supported_channels: ["EMAIL"],
      activation: { kind: "TAB", tab_id: "history" },
    },
    {
      key: "report_view",
      label: "Planning Dashboard Report",
      supported_channels: ["EMAIL"],
      activation: {
        kind: "ROUTE",
        route_path: "/dashboard/procurement/planning/report",
      },
    },
  ],
};

const COMMUNICATION_SURFACE_MANIFESTS: readonly CommunicationSurfaceManifest[] = [
  PO11_COMMUNICATION_SURFACE_MANIFEST,
];

export function findCommunicationSurfaceManifest(
  page: CommunicationManifestPageIdentity,
): CommunicationSurfaceManifest | null {
  return COMMUNICATION_SURFACE_MANIFESTS.find(
    (manifest) =>
      manifest.page.tx_code === page.tx_code &&
      manifest.page.resource_code === page.resource_code,
  ) ?? null;
}

export function assertCommunicationChannelSupported(
  manifest: CommunicationSurfaceManifest,
  channel: string,
): asserts channel is CommunicationChannel {
  if (!COMMUNICATION_CHANNELS.includes(channel as CommunicationChannel)) {
    throw new CommunicationManifestValidationError(
      "UNSUPPORTED_COMMUNICATION_CHANNEL",
    );
  }

  const isSupportedByPage = manifest.surfaces.some((surface) =>
    surface.supported_channels.includes(channel as CommunicationChannel)
  );
  if (!isSupportedByPage) {
    throw new CommunicationManifestValidationError(
      "UNSUPPORTED_COMMUNICATION_CHANNEL",
    );
  }
}

export function assertCommunicationSurfaceSupported(
  manifest: CommunicationSurfaceManifest | null,
  surfaceKey: string,
  channel: string = "EMAIL",
): CommunicationSurface {
  if (!manifest) {
    throw new CommunicationManifestValidationError(
      "COMMUNICATION_MANIFEST_NOT_FOUND",
    );
  }

  assertCommunicationChannelSupported(manifest, channel);

  const surface = manifest.surfaces.find((item) => item.key === surfaceKey);
  if (!surface || !surface.supported_channels.includes(channel as CommunicationChannel)) {
    throw new CommunicationManifestValidationError(
      "INVALID_COMMUNICATION_SURFACE",
    );
  }

  return surface;
}

export function listCommunicationSurfaces(
  manifest: CommunicationSurfaceManifest | null,
): readonly CommunicationSurface[] {
  return manifest?.surfaces ?? [];
}
