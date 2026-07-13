export const PROCESS_TO_PACKING_PO_TYPE = {
  MTO: "PMTO",
  HPS: "PHPS",
  MTS: "PMTS",
  MTEST: "PTEST",
};

export function packingPoTypeForProcessType(poType) {
  return PROCESS_TO_PACKING_PO_TYPE[String(poType ?? "").toUpperCase()] ?? "";
}
