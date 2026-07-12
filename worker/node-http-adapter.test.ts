import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import {
  createNodeHttpAdapters,
  MAX_CAPTURE_BYTES,
} from "./node-http-adapter";

describe("Cloudflare Request to Node HTTP adapter", () => {
  it("preserves request metadata and JSON body for existing API handlers", async () => {
    const adapters = await createNodeHttpAdapters(
      new Request("https://modu-brain.example/api/v1/projects?archived=true", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.9",
          "X-Forwarded-Host": "attacker.example",
          "X-Forwarded-Proto": "http",
        },
        body: JSON.stringify({ title: "Worker project" }),
      }),
    );

    const chunks: Buffer[] = [];
    for await (const chunk of adapters.request) chunks.push(chunk);

    expect(adapters.request.method).toBe("POST");
    expect(adapters.request.url).toBe("/api/v1/projects?archived=true");
    expect(adapters.request.headers.host).toBe("modu-brain.example");
    expect(adapters.request.headers["x-forwarded-host"]).toBe(
      "modu-brain.example",
    );
    expect(adapters.request.headers["x-forwarded-proto"]).toBe("https");
    expect(adapters.request.socket.encrypted).toBe(true);
    expect(adapters.request.socket.remoteAddress).toBe("203.0.113.9");
    expect(adapters.request.trustedProxyPlatform).toBe("cloudflare");
    expect(adapters.request.moduBrainSignal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual({
      title: "Worker project",
    });
  });

  it("supports legacy data and end events", async () => {
    const adapters = await createNodeHttpAdapters(
      new Request("https://modu-brain.example/api/context-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: "legacy" }),
      }),
    );
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve) => {
      adapters.request.on("data", (chunk) => chunks.push(chunk as Buffer));
      adapters.request.on("end", () => resolve());
    });

    expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual({
      rawText: "legacy",
    });
  });

  it("captures only enough bytes for the API size guard", async () => {
    const adapters = await createNodeHttpAdapters(
      new Request("https://modu-brain.example/api/v1/projects", {
        method: "POST",
        body: "x".repeat(MAX_CAPTURE_BYTES + 100),
      }),
    );
    const chunks: Buffer[] = [];
    for await (const chunk of adapters.request) chunks.push(chunk);

    expect(Buffer.concat(chunks)).toHaveLength(MAX_CAPTURE_BYTES);
  });

  it("converts response status, headers, and body", async () => {
    const adapters = await createNodeHttpAdapters(
      new Request("https://modu-brain.example/api/health/live"),
    );
    adapters.response.statusCode = 201;
    adapters.response.setHeader("Content-Type", "application/json");
    adapters.response.setHeader("Retry-After", 60);
    adapters.response.moduBrainErrorCode = "TEST_ERROR";
    adapters.response.end(JSON.stringify({ data: { status: "ok" } }));

    const response = adapters.response.toResponse();
    expect(response.status).toBe(201);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(adapters.response.moduBrainErrorCode).toBe("TEST_ERROR");
    expect(await response.json()).toEqual({ data: { status: "ok" } });
  });

  it("preserves multiple Set-Cookie headers for the Sites worker response", async () => {
    const adapters = await createNodeHttpAdapters(
      new Request("https://modu-brain.example/api/v1/auth/session", { method: "POST" }),
    );
    adapters.response.setHeader("Set-Cookie", [
      "__Host-modu_brain_access=access; Path=/; HttpOnly; SameSite=Strict; Secure",
      "__Host-modu_brain_refresh=refresh; Path=/; HttpOnly; SameSite=Strict; Secure",
      "__Host-modu_brain_expires=1; Path=/; HttpOnly; SameSite=Strict; Secure",
    ]);
    adapters.response.end(JSON.stringify({ data: { authenticated: true } }));

    const response = adapters.response.toResponse();
    expect(response.headers.getSetCookie()).toEqual([
      "__Host-modu_brain_access=access; Path=/; HttpOnly; SameSite=Strict; Secure",
      "__Host-modu_brain_refresh=refresh; Path=/; HttpOnly; SameSite=Strict; Secure",
      "__Host-modu_brain_expires=1; Path=/; HttpOnly; SameSite=Strict; Secure",
    ]);
  });

  it("propagates request aborts to both adapters", async () => {
    const controller = new AbortController();
    const adapters = await createNodeHttpAdapters(
      new Request("https://modu-brain.example/api/v1/projects", {
        signal: controller.signal,
      }),
    );
    const requestAborted = vi.fn();
    const responseClosed = vi.fn();
    adapters.request.once("aborted", requestAborted);
    adapters.response.once("close", responseClosed);

    controller.abort();

    expect(adapters.request.aborted).toBe(true);
    expect(adapters.request.socket.destroyed).toBe(true);
    expect(adapters.response.destroyed).toBe(true);
    expect(requestAborted).toHaveBeenCalledOnce();
    expect(responseClosed).toHaveBeenCalledOnce();
  });
});
