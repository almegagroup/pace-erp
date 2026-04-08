const listeners = new Set();

let sequence = 0;
let snapshot = {
  inFlightCount: 0,
  blockingInFlightCount: 0,
  backgroundInFlightCount: 0,
  startedAt: 0,
  blockingStartedAt: 0,
  lastCompletedAt: 0,
  lastErrorAt: 0,
  lastLabel: "",
  lastBlockingLabel: "",
  lastBackgroundLabel: "",
  lastOutcome: "idle",
};

const activeRequests = new Map();

function rebuildSnapshot(overrides = {}) {
  const active = Array.from(activeRequests.values());
  const blocking = active.filter((request) => request.mode === "blocking");
  const background = active.filter((request) => request.mode === "background");

  snapshot = {
    ...snapshot,
    ...overrides,
    inFlightCount: active.length,
    blockingInFlightCount: blocking.length,
    backgroundInFlightCount: background.length,
    startedAt:
      active.length > 0
        ? Math.min(...active.map((request) => request.startedAt))
        : 0,
    blockingStartedAt:
      blocking.length > 0
        ? Math.min(...blocking.map((request) => request.startedAt))
        : 0,
  };
}

function emit() {
  const nextSnapshot = { ...snapshot };
  listeners.forEach((listener) => listener(nextSnapshot));
}

function extractLabel(url, method = "GET") {
  if (!url) {
    return "ERP request";
  }

  try {
    const parsed = new URL(url, globalThis.location?.origin);
    const normalizedMethod = String(method || "GET").toUpperCase();
    const pathname = parsed.pathname;

    if (pathname.endsWith("/api/me/context")) {
      return normalizedMethod === "POST"
        ? "Switching work scope"
        : "Loading work scope";
    }

    if (pathname.endsWith("/api/me/menu")) {
      return "Refreshing menu";
    }

    if (pathname.endsWith("/api/admin/control-panel")) {
      return "Refreshing control panel";
    }

    if (pathname.endsWith("/api/admin/system-health")) {
      return "Refreshing system health";
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    const leaf = parts.slice(-2).join(" / ") || parts.at(-1) || parsed.pathname;
    const prefix =
      normalizedMethod === "POST"
        ? "Saving"
        : normalizedMethod === "PATCH"
          ? "Updating"
          : normalizedMethod === "DELETE"
            ? "Removing"
            : "Loading";

    return `${prefix} ${leaf.replaceAll("-", " ")}`;
  } catch {
    return String(url);
  }
}

export function beginNetworkActivity(
  url,
  method = "GET",
  { mode, label } = {}
) {
  const token = `req_${Date.now()}_${sequence++}`;
  const resolvedMethod = String(method || "GET").toUpperCase();
  const resolvedMode =
    mode ??
    (resolvedMethod === "GET" || resolvedMethod === "HEAD"
      ? "background"
      : "blocking");
  const resolvedLabel = label || extractLabel(url, resolvedMethod);

  activeRequests.set(token, {
    label: resolvedLabel,
    mode: resolvedMode,
    startedAt: Date.now(),
  });

  rebuildSnapshot({
    lastLabel: resolvedLabel,
    lastBlockingLabel:
      resolvedMode === "blocking" ? resolvedLabel : snapshot.lastBlockingLabel,
    lastBackgroundLabel:
      resolvedMode === "background"
        ? resolvedLabel
        : snapshot.lastBackgroundLabel,
    lastOutcome: "busy",
  });

  emit();
  return token;
}

export function finishNetworkActivity(token, { ok = true } = {}) {
  const request = activeRequests.get(token);

  if (!request) {
    return;
  }

  activeRequests.delete(token);

  rebuildSnapshot({
    lastCompletedAt: Date.now(),
    lastErrorAt: ok ? snapshot.lastErrorAt : Date.now(),
    lastLabel: request.label,
    lastBlockingLabel:
      request.mode === "blocking" ? request.label : snapshot.lastBlockingLabel,
    lastBackgroundLabel:
      request.mode === "background"
        ? request.label
        : snapshot.lastBackgroundLabel,
    lastOutcome: ok ? "success" : "error",
  });

  emit();
}

export function getNetworkActivitySnapshot() {
  return { ...snapshot };
}

export function subscribeNetworkActivity(listener) {
  listeners.add(listener);
  listener(getNetworkActivitySnapshot());

  return () => {
    listeners.delete(listener);
  };
}
