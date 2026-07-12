import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";

export const MAX_CAPTURE_BYTES = 256 * 1024 + 1;

export type NodeSocketLike = {
  encrypted: boolean;
  destroyed: boolean;
  remoteAddress?: string;
};

export class NodeRequestAdapter extends EventEmitter implements AsyncIterable<Buffer> {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly socket: NodeSocketLike;
  readonly trustedProxyPlatform = "cloudflare";
  readonly moduBrainSignal: AbortSignal;
  moduBrainTrace?: {
    requestId: string;
    cfRay: string | null;
    rndrId: string | null;
    runtime: string;
  };
  aborted = false;

  readonly #body: Buffer;
  #legacyStreamScheduled = false;

  constructor(request: Request, body: Buffer) {
    super();
    const url = new URL(request.url);
    this.method = request.method.toUpperCase();
    this.moduBrainSignal = request.signal;
    this.url = `${url.pathname}${url.search}`;
    this.headers = Object.fromEntries(
      [...request.headers.entries()].map(([name, value]) => [name.toLowerCase(), value]),
    );
    // The request URL is supplied by the Worker runtime. Never let a client
    // spoof proxy headers that are used by the API mutation-origin check.
    this.headers.host = url.host;
    this.headers["x-forwarded-host"] = url.host;
    this.headers["x-forwarded-proto"] = url.protocol.replace(/:$/, "");
    this.socket = {
      encrypted: url.protocol === "https:",
      destroyed: false,
      remoteAddress: this.headers["cf-connecting-ip"],
    };
    this.#body = body;
  }

  override on(eventName: string | symbol, listener: (...args: unknown[]) => void): this {
    super.on(eventName, listener);
    if (eventName === "data" || eventName === "end" || eventName === "error") {
      this.#scheduleLegacyStream();
    }
    return this;
  }

  resume() {
    return this;
  }

  abort() {
    if (this.aborted) return;
    this.aborted = true;
    this.socket.destroyed = true;
    this.emit("aborted");
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Buffer> {
    if (this.#body.length) yield this.#body;
  }

  #scheduleLegacyStream() {
    if (this.#legacyStreamScheduled) return;
    this.#legacyStreamScheduled = true;
    queueMicrotask(() => {
      if (this.aborted) return;
      if (this.#body.length) this.emit("data", this.#body);
      this.emit("end");
    });
  }
}

export class NodeResponseAdapter extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  moduBrainErrorCode: string | null = null;

  readonly #headers = new Headers();
  readonly #chunks: Buffer[] = [];

  setHeader(name: string, value: string | number | readonly string[]) {
    this.#headers.delete(name);
    if (Array.isArray(value)) {
      for (const entry of value) this.#headers.append(name, String(entry));
    } else {
      this.#headers.set(name, String(value));
    }
    return this;
  }

  end(chunk?: string | Uint8Array) {
    if (this.writableEnded) return this;
    if (chunk !== undefined) this.#chunks.push(Buffer.from(chunk));
    this.headersSent = true;
    this.writableEnded = true;
    this.emit("finish");
    return this;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("close");
  }

  toResponse() {
    if (!this.writableEnded && !this.destroyed) this.end();
    const body = Buffer.concat(this.#chunks);
    const response = new Response(this.statusCode === 204 ? null : new Uint8Array(body), {
      status: this.statusCode,
      headers: this.#headers,
    });
    Object.defineProperty(response, "moduBrainErrorCode", {
      value: this.moduBrainErrorCode,
      enumerable: false,
    });
    return response;
  }
}

export async function createNodeHttpAdapters(request: Request) {
  const body = await readRequestBody(request, MAX_CAPTURE_BYTES);
  const nodeRequest = new NodeRequestAdapter(request, body);
  const nodeResponse = new NodeResponseAdapter();
  const abort = () => {
    nodeRequest.abort();
    nodeResponse.destroy();
  };

  if (request.signal.aborted) abort();
  else request.signal.addEventListener("abort", abort, { once: true });

  return {
    request: nodeRequest,
    response: nodeResponse,
    dispose() {
      request.signal.removeEventListener("abort", abort);
    },
  };
}

async function readRequestBody(request: Request, limit: number) {
  if (!request.body) return Buffer.alloc(0);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength >= limit) {
    await request.body.cancel().catch(() => undefined);
    return Buffer.alloc(limit);
  }

  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let captured = 0;

  while (captured < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    const remaining = limit - captured;
    chunks.push(chunk.subarray(0, remaining));
    captured += Math.min(chunk.length, remaining);
    if (chunk.length > remaining || captured === limit) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }

  return Buffer.concat(chunks, captured);
}
