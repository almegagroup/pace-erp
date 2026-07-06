export function cleanQueryParams(params = {}) {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

export function maybeArray(value) {
  return Array.isArray(value) ? value : [];
}
