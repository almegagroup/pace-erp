function normalizeValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function normalizeForSearch(value) {
  return normalizeValue(value).toLowerCase();
}

function compareText(left, right) {
  return normalizeValue(left).localeCompare(normalizeValue(right), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function resolveField(row, selector) {
  if (typeof selector === "function") {
    return selector(row);
  }

  if (typeof selector === "string") {
    return row?.[selector];
  }

  return "";
}

function buildCodeNameKey(row, codeSelector, nameSelector, fallbackSelectors = []) {
  const code = normalizeValue(resolveField(row, codeSelector));
  const name = normalizeValue(resolveField(row, nameSelector));

  if (code || name) {
    return {
      code,
      name,
    };
  }

  const fallback = fallbackSelectors
    .map((selector) => normalizeValue(resolveField(row, selector)))
    .find(Boolean) ?? "";

  return {
    code: fallback,
    name: fallback,
  };
}

export function sortByCodeThenName(
  rows,
  {
    codeSelector,
    nameSelector,
    fallbackSelectors = [],
  },
) {
  const source = Array.isArray(rows) ? rows : [];

  return source.slice().sort((left, right) => {
    const leftKey = buildCodeNameKey(
      left,
      codeSelector,
      nameSelector,
      fallbackSelectors,
    );
    const rightKey = buildCodeNameKey(
      right,
      codeSelector,
      nameSelector,
      fallbackSelectors,
    );

    const codeCompare = compareText(leftKey.code, rightKey.code);
    if (codeCompare !== 0) {
      return codeCompare;
    }

    const nameCompare = compareText(leftKey.name, rightKey.name);
    if (nameCompare !== 0) {
      return nameCompare;
    }

    return 0;
  });
}

export function applyQuickFilter(rows, query, selectors) {
  const source = Array.isArray(rows) ? rows : [];
  const normalizedQuery = normalizeForSearch(query);

  if (!normalizedQuery) {
    return source;
  }

  return source.filter((row) =>
    selectors.some((selector) =>
      normalizeForSearch(resolveField(row, selector)).includes(normalizedQuery)
    )
  );
}

export function sortUsers(rows) {
  return sortByCodeThenName(rows, {
    codeSelector: "user_code",
    nameSelector: "name",
    fallbackSelectors: ["auth_user_id"],
  });
}

export function sortCompanies(rows) {
  return sortByCodeThenName(rows, {
    codeSelector: "company_code",
    nameSelector: "company_name",
    fallbackSelectors: ["state_name", "full_address", "id"],
  });
}

export function sortProjects(rows) {
  return sortByCodeThenName(rows, {
    codeSelector: "project_code",
    nameSelector: "project_name",
    fallbackSelectors: ["id"],
  });
}

export function sortDepartments(rows) {
  return sortByCodeThenName(rows, {
    codeSelector: "department_code",
    nameSelector: "department_name",
    fallbackSelectors: ["id"],
  });
}
