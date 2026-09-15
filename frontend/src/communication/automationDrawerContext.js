function nonEmptyString(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

/**
 * Binds an opened shell to the exact runtime context that opened it.
 * A context change becomes invisible synchronously, before effects or a new
 * visibility response can run; the caller must explicitly open it again.
 */
export function buildAutomationSettingsContextKey({
  companyId,
  surfaceKey,
  companyScoped = true,
}) {
  const surface = nonEmptyString(surfaceKey);
  if (!surface) return null;
  if (companyScoped !== true) return `global\u001f${surface}`;

  const company = nonEmptyString(companyId);
  return company ? `company\u001f${company}\u001f${surface}` : null;
}

export function isAutomationSettingsDrawerOpenForContext({
  openedContextKey,
  currentContextKey,
}) {
  return Boolean(
    currentContextKey && openedContextKey === currentContextKey,
  );
}
