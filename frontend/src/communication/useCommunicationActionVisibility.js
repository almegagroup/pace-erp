import { useQuery } from "@tanstack/react-query";
import { getCommunicationActionVisibility } from "./communicationRuntimeApi.js";

export function isCommunicationActionVisible(query) {
  return query?.status === "success" && query?.data?.visible === true;
}

/**
 * @param {{
 *   txCode?: string,
 *   resourceCode?: string,
 *   surfaceKey?: string,
 *   channel?: string,
 *   companyId?: string,
 *   companyScoped?: boolean,
 * }} input
 */
export function isCommunicationActionVisibilityQueryEnabled(input) {
  const {
    txCode,
    resourceCode,
    surfaceKey,
    channel,
    companyId,
    companyScoped = true,
  } = input;
  if (!(txCode && resourceCode && surfaceKey && channel)) return false;
  return companyScoped !== true || Boolean(companyId);
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
  companyScoped = true,
}) {
  const enabled = isCommunicationActionVisibilityQueryEnabled({
    txCode,
    resourceCode,
    surfaceKey,
    channel,
    companyId,
    companyScoped,
  });
  const query = useQuery({
    queryKey: [
      "communication",
      "action-visibility",
      txCode || "",
      resourceCode || "",
      surfaceKey || "",
      channel || "",
      companyScoped === true ? "company" : "global",
      companyId || "",
    ],
    enabled,
    queryFn: () =>
      getCommunicationActionVisibility({
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
