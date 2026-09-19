/*
 * Communication report-adapter registry.
 *
 * The registry owns only code-defined page/dataset bindings.  It never
 * accepts a table name, SQL fragment, module path, or client-selected loader.
 */

import type { CommunicationManifestPageIdentity } from "./surface_manifest.ts";
import type {
  ReportDatasetAdapter,
  ReportDatasetManifest,
} from "./report_manifest/types.ts";
import type { ReportManifestRegistry } from "./report_manifest/registry.ts";
import {
  assertReportAdapterOutput,
  type ReportAdapterOutputRow,
} from "./report_adapter_validation.ts";

export type RegisteredReportDatasetAdapter<Context = unknown> =
  & ReportDatasetAdapter<ReportAdapterOutputRow, Context>
  & {
    page: CommunicationManifestPageIdentity;
  };

export type ReportAdapterRegistryErrorCode =
  | "REPORT_ADAPTER_DUPLICATE_REGISTRATION"
  | "REPORT_ADAPTER_MANIFEST_DATASET_NOT_FOUND"
  | "REPORT_ADAPTER_NOT_FOUND";

export class ReportAdapterRegistryError extends Error {
  constructor(
    readonly code: ReportAdapterRegistryErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ReportAdapterRegistryError";
  }
}

export type ReportAdapterRegistry = {
  resolveAdapter(
    page: CommunicationManifestPageIdentity,
    datasetKey: string,
  ): RegisteredReportDatasetAdapter;
  loadRows(
    page: CommunicationManifestPageIdentity,
    surfaceKey: string,
    datasetKey: string,
    context: unknown,
  ): Promise<readonly ReportAdapterOutputRow[]>;
};

function pageKey(page: CommunicationManifestPageIdentity): string {
  return `${page.tx_code ?? ""}::${page.resource_code}`;
}

function adapterKey(
  page: CommunicationManifestPageIdentity,
  datasetKey: string,
): string {
  return `${pageKey(page)}::${datasetKey}`;
}

function findManifestDataset(
  manifestRegistry: ReportManifestRegistry,
  page: CommunicationManifestPageIdentity,
  datasetKey: string,
): ReportDatasetManifest | null {
  return manifestRegistry.listDatasetsForPage(page).find((dataset) =>
    dataset.dataset_key === datasetKey
  ) ?? null;
}

/**
 * Creates a fail-closed registry for developer-authored report adapters.
 * Every registration must have a matching, already-validated report manifest.
 */
export function createReportAdapterRegistry(
  manifestRegistry: ReportManifestRegistry,
  adapters: readonly RegisteredReportDatasetAdapter[],
): ReportAdapterRegistry {
  const adaptersByKey = new Map<string, RegisteredReportDatasetAdapter>();
  for (const adapter of adapters) {
    if (
      !findManifestDataset(manifestRegistry, adapter.page, adapter.dataset_key)
    ) {
      throw new ReportAdapterRegistryError(
        "REPORT_ADAPTER_MANIFEST_DATASET_NOT_FOUND",
        adapter.dataset_key,
      );
    }
    const key = adapterKey(adapter.page, adapter.dataset_key);
    if (adaptersByKey.has(key)) {
      throw new ReportAdapterRegistryError(
        "REPORT_ADAPTER_DUPLICATE_REGISTRATION",
        adapter.dataset_key,
      );
    }
    adaptersByKey.set(key, adapter);
  }

  function resolveAdapter(
    page: CommunicationManifestPageIdentity,
    datasetKey: string,
  ): RegisteredReportDatasetAdapter {
    const adapter = adaptersByKey.get(adapterKey(page, datasetKey));
    if (!adapter) {
      throw new ReportAdapterRegistryError(
        "REPORT_ADAPTER_NOT_FOUND",
        datasetKey,
      );
    }
    return adapter;
  }

  async function loadRows(
    page: CommunicationManifestPageIdentity,
    surfaceKey: string,
    datasetKey: string,
    context: unknown,
  ): Promise<readonly ReportAdapterOutputRow[]> {
    const dataset = manifestRegistry.resolveDataset(
      page,
      surfaceKey,
      datasetKey,
    );
    const adapter = resolveAdapter(page, datasetKey);
    const rows = await adapter.loadRows(context);
    return assertReportAdapterOutput(dataset, rows);
  }

  return { resolveAdapter, loadRows };
}
