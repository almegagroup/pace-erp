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

function extractLabel(url) {
  if (!url) {
    return "ERP request";
  }

  try {
    const parsed = new URL(url, globalThis.location?.origin);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const leaf = parts.slice(-2).join(" / ") || parts.at(-1) || parsed.pathname;
    return leaf.replaceAll("-", " ");
  } catch {
    return String(url);
  }
}

export function beginNetworkActivity(url) {
  const token = `req_${Date.now()}_${sequence++}`;

  activeRequests.set(token, {
    label: extractLabel(url),
    startedAt: Date.now(),
  });

  snapshot = {
    ...snapshot,
    inFlightCount: activeRequests.size,
    startedAt: snapshot.startedAt || Date.now(),
    lastLabel: extractLabel(url),
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
