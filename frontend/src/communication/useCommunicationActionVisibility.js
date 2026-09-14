import { useQuery } from "@tanstack/react-query";
import { getCommunicationActionVisibility } from "./communicationRuntimeApi.js";

export function isCommunicationActionVisible(query) {
  return query?.status === "success" && query?.data?.visible === true;
}

/**
 * Fail-closed runtime enrollment check shared by communication-capable pages.
 * Its full identity query key prevents a prior company or surface result from
 * being reused while the page changes context.
 */
export function useCommunicationActionVisibility({
  txCode,
  resourceCode,
  surfaceKey,
  channel = "EMAIL",
  companyId,
}) {
  const enabled = Boolean(txCode && resourceCode && surfaceKey && channel && companyId);
  const query = useQuery({
    queryKey: [
      "communication",
      "action-visibility",
      txCode || "",
      resourceCode || "",
      surfaceKey || "",
      channel || "",
      companyId || "",
    ],
    enabled,
    queryFn: () => getCommunicationActionVisibility({
      txCode,
      resourceCode,
      surfaceKey,
      channel,
      companyId,
    }),
  });

  return {
    ...query,
    visible: isCommunicationActionVisible(query),
  };
}
