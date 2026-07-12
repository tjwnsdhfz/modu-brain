import { afterEach, describe, expect, it, vi } from "vitest";
import { productEventType, trackProductEvent, type ProductEvent } from "./productTelemetry";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("product telemetry", () => {
  it("emits an allowlisted, content-free browser event when no collector is configured", () => {
    const listener = vi.fn<(event: Event) => void>();
    window.addEventListener(productEventType, listener);

    trackProductEvent("analysis_started", {
      sourceCount: 2,
      mode: "local",
      rawText: "이 값은 허용 목록에 없으므로 제거되어야 합니다.",
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const detail = (listener.mock.calls[0][0] as CustomEvent<ProductEvent>).detail;
    expect(detail).toMatchObject({
      name: "analysis_started",
      properties: { sourceCount: 2, mode: "local" },
    });
    expect(detail.properties).not.toHaveProperty("rawText");
    window.removeEventListener(productEventType, listener);
  });

  it("truncates string metadata before an optional adapter receives it", () => {
    const listener = vi.fn<(event: Event) => void>();
    window.addEventListener(productEventType, listener);

    trackProductEvent("analysis_failed", { code: "x".repeat(200) });

    const detail = (listener.mock.calls[0][0] as CustomEvent<ProductEvent>).detail;
    expect(String(detail.properties.code)).toHaveLength(120);
    window.removeEventListener(productEventType, listener);
  });

  it("uses sendBeacon for a configured same-origin collector", () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubEnv("VITE_PRODUCT_ANALYTICS_ENDPOINT", "/product-events");
    vi.stubGlobal("navigator", { sendBeacon });

    trackProductEvent("demo_opened", { sampleReady: true });

    expect(sendBeacon).toHaveBeenCalledWith(
      "/product-events",
      expect.any(Blob),
    );
  });

  it("falls back to keepalive fetch when sendBeacon is unavailable", () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubEnv("VITE_PRODUCT_ANALYTICS_ENDPOINT", "/product-events");
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", fetchMock);

    trackProductEvent("share_link_created", { expiresInDays: 7 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/product-events",
      expect.objectContaining({ method: "POST", keepalive: true }),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      name: "share_link_created",
      properties: { expiresInDays: 7 },
    });
  });

  it("never sends events to an absolute cross-origin endpoint", () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubEnv("VITE_PRODUCT_ANALYTICS_ENDPOINT", "https://collector.example/events");
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", fetchMock);

    trackProductEvent("analysis_failed", { code: "NETWORK_ERROR" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects protocol-relative collectors and removes project identifiers from paths", () => {
    const listener = vi.fn<(event: Event) => void>();
    const fetchMock = vi.fn<typeof fetch>();
    window.history.replaceState(null, "", "/projects/11111111-1111-4111-8111-111111111111");
    window.addEventListener(productEventType, listener);
    vi.stubEnv("VITE_PRODUCT_ANALYTICS_ENDPOINT", "//collector.example/events");
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", fetchMock);

    trackProductEvent("evidence_opened", { referenceCount: 2, sourceCount: 1 });

    const detail = (listener.mock.calls[0][0] as CustomEvent<ProductEvent>).detail;
    expect(detail.path).toBe("/projects/:projectId");
    expect(fetchMock).not.toHaveBeenCalled();
    window.removeEventListener(productEventType, listener);
  });
});
