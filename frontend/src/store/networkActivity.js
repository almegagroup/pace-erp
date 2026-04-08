const listeners = new Set();

let sequence = 0;
let snapshot = {
  inFlightCount: 0,
  startedAt: 0,
  lastCompletedAt: 0,
  lastErrorAt: 0,
  lastLabel: "",
  lastOutcome: "idle",
};

const activeRequests = new Map();

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

export function beginNetworkActivity(url, method = "GET") {
  const token = `req_${Date.now()}_${sequence++}`;
  const label = extractLabel(url, method);

  activeRequests.set(token, {
    label,
    startedAt: Date.now(),
  });

  snapshot = {
    ...snapshot,
    inFlightCount: activeRequests.size,
    startedAt: snapshot.startedAt || Date.now(),
    lastLabel: label,
    lastOutcome: "busy",
  };

  emit();
  return token;
}

export function finishNetworkActivity(token, { ok = true } = {}) {
  const request = activeRequests.get(token);

  if (!request) {
    return;
  }

  activeRequests.delete(token);

  snapshot = {
    ...snapshot,
    inFlightCount: activeRequests.size,
    startedAt: activeRequests.size > 0 ? snapshot.startedAt : 0,
    lastCompletedAt: Date.now(),
    lastErrorAt: ok ? snapshot.lastErrorAt : Date.now(),
    lastLabel: request.label,
    lastOutcome: ok ? "success" : "error",
  };

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
