export type ProductEventName =
  | "demo_opened"
  | "sample_loaded"
  | "analysis_started"
  | "analysis_succeeded"
  | "analysis_failed"
  | "evidence_opened"
  | "comparison_opened"
  | "share_link_created";

type ProductEventProperty = string | number | boolean | null;

export type ProductEvent = {
  name: ProductEventName;
  occurredAt: string;
  path: string;
  properties: Record<string, ProductEventProperty>;
};

const eventType = "modu-brain:product-event";
const allowedPropertyNames: Record<ProductEventName, readonly string[]> = {
  demo_opened: ["sampleReady"],
  sample_loaded: ["entryPoint"],
  analysis_started: ["mode", "inputCharacters", "sourceCount"],
  analysis_succeeded: ["provider", "durationMs", "evidenceCount"],
  analysis_failed: ["code", "stage"],
  evidence_opened: ["referenceCount", "sourceCount"],
  comparison_opened: ["hasPrevious", "addedCount", "changedCount", "resolvedCount"],
  share_link_created: ["expiresInDays"],
};

export function trackProductEvent(
  name: ProductEventName,
  properties: Record<string, ProductEventProperty> = {},
) {
  if (typeof window === "undefined") return;
  const event: ProductEvent = {
    name,
    occurredAt: new Date().toISOString(),
    path: normalizePath(window.location.pathname),
    properties: sanitize(name, properties),
  };

  window.dispatchEvent(new CustomEvent<ProductEvent>(eventType, { detail: event }));

  const endpoint = import.meta.env.VITE_PRODUCT_ANALYTICS_ENDPOINT?.trim()
    || (import.meta.env.PROD ? "/api/v1/telemetry" : "");
  const collectorPath = sameOriginCollectorPath(endpoint);
  if (!collectorPath) return;
  const payload = JSON.stringify(event);
  if (typeof navigator.sendBeacon === "function") {
    navigator.sendBeacon(collectorPath, new Blob([payload], { type: "application/json" }));
    return;
  }
  void fetch(collectorPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => undefined);
}

function sameOriginCollectorPath(endpoint: string | undefined) {
  if (!endpoint || !endpoint.startsWith("/") || endpoint.startsWith("//")) return null;
  try {
    const url = new URL(endpoint, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function normalizePath(pathname: string) {
  if (/^\/projects\/[^/]+$/.test(pathname)) return "/projects/:projectId";
  return pathname;
}

export const productEventType = eventType;

function sanitize(name: ProductEventName, properties: Record<string, ProductEventProperty>) {
  const allowed = new Set(allowedPropertyNames[name]);
  return Object.fromEntries(
    Object.entries(properties).filter(([key]) => allowed.has(key)).slice(0, 12).map(([key, value]) => [
      key.slice(0, 40),
      typeof value === "string" ? value.slice(0, 120) : value,
    ]),
  );
}
