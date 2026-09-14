import {
  type CommunicationManifestPageIdentity,
  findCommunicationSurfaceManifest,
  listCommunicationSurfaces,
} from "../surface_manifest.ts";
import type { ReportDatasetManifest } from "./types.ts";
import {
  assertReportManifestDefinitions,
  ReportManifestValidationError,
} from "./validation.ts";

export type ReportManifestRegistry = {
  listDatasetsForPage(
    page: CommunicationManifestPageIdentity,
  ): readonly ReportDatasetManifest[];
  resolveDataset(
    page: CommunicationManifestPageIdentity,
    surfaceKey: string,
    datasetKey: string,
  ): ReportDatasetManifest;
};

function pageMatches(
  left: CommunicationManifestPageIdentity,
  right: CommunicationManifestPageIdentity,
): boolean {
  return left.tx_code === right.tx_code &&
    left.resource_code === right.resource_code;
}

/**
 * Makes report metadata available through one code-owned registry.  This
 * registry validates every supplied definition before allowing resolution.
 */
export function createReportManifestRegistry(
  datasets: readonly ReportDatasetManifest[],
): ReportManifestRegistry {
  assertReportManifestDefinitions(datasets);

  function listDatasetsForPage(
    page: CommunicationManifestPageIdentity,
  ): readonly ReportDatasetManifest[] {
    return datasets.filter((dataset) => pageMatches(dataset.page, page));
  }

  function resolveDataset(
    page: CommunicationManifestPageIdentity,
    surfaceKey: string,
    datasetKey: string,
  ): ReportDatasetManifest {
    const datasetsForPage = listDatasetsForPage(page);
    if (datasetsForPage.length === 0) {
      throw new ReportManifestValidationError(
        "REPORT_MANIFEST_PAGE_NOT_FOUND",
        page.resource_code,
      );
    }

    const communicationManifest = findCommunicationSurfaceManifest(page);
    const validSurface = listCommunicationSurfaces(communicationManifest).some(
      (surface) => surface.key === surfaceKey,
    );
    if (!validSurface) {
      throw new ReportManifestValidationError(
        "REPORT_MANIFEST_SURFACE_NOT_BOUND",
        surfaceKey,
      );
    }

    const dataset = datasetsForPage.find((candidate) =>
      candidate.dataset_key === datasetKey
    );
    if (!dataset) {
      throw new ReportManifestValidationError(
        "REPORT_MANIFEST_DATASET_NOT_FOUND",
        datasetKey,
      );
    }
    if (!dataset.surface_keys.includes(surfaceKey)) {
      throw new ReportManifestValidationError(
        "REPORT_MANIFEST_SURFACE_NOT_BOUND",
        surfaceKey,
      );
    }
    return dataset;
  }

  return { listDatasetsForPage, resolveDataset };
}
