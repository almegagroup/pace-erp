export const ERP_ROLE_OPTIONS = Object.freeze([
  { code: "SA", label: "Super Admin", rank: 999 },
  { code: "GA", label: "Global Admin", rank: 888 },
  { code: "DIRECTOR", label: "Director", rank: 100 },
  { code: "L4_MANAGER", label: "L4 Manager", rank: 95 },
  { code: "L3_MANAGER", label: "L3 Manager", rank: 90 },
  { code: "L2_AUDITOR", label: "L2 Auditor", rank: 80 },
  { code: "L1_AUDITOR", label: "L1 Auditor", rank: 70 },
  { code: "L2_MANAGER", label: "L2 Manager", rank: 60 },
  { code: "L1_MANAGER", label: "L1 Manager", rank: 50 },
  { code: "L4_USER", label: "L4 User", rank: 40 },
  { code: "L3_USER", label: "L3 User", rank: 30 },
  { code: "L2_USER", label: "L2 User", rank: 20 },
  { code: "L1_USER", label: "L1 User", rank: 10 },
]);

export const ERP_ROLE_LABELS = Object.freeze(
  Object.fromEntries(ERP_ROLE_OPTIONS.map((role) => [role.code, role.label])),
);

export const ERP_ROLE_RANKS = Object.freeze(
  Object.fromEntries(ERP_ROLE_OPTIONS.map((role) => [role.code, role.rank])),
);

export const ERP_ROLE_FILTERS = Object.freeze(
  ERP_ROLE_OPTIONS.map((role) => ({
    key: role.code,
    label: role.code,
  })),
);
