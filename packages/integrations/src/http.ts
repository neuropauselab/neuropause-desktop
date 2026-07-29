/**
 * HTTP client abstraction (NCEA 13.0). ONE seam between adapters and the network.
 * `FetchHttpClient` is the real implementation (global fetch); `FakeHttpClient`
 * is programmable and RECORDS every request, so an adapter's request construction
 * and response parsing are testable to the byte without a live service (the basis
 * of the ADAPTER-VERIFIED tier). A real local HTTP server can also be pointed at
 * `FetchHttpClient` to exercise the genuine socket path.
 */
export interface HttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
}

export interface HttpClient {
  send(req: HttpRequest): Promise<HttpResponse>;
  stream(req: HttpRequest): AsyncIterable<Uint8Array>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status}`);
    this.name = 'HttpError';
  }
}

/** 408/425/429 + 5xx are worth retrying; 4xx (auth/validation) are not. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function headerObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => (out[k] = v));
  return out;
}

export class FetchHttpClient implements HttpClient {
  async send(req: HttpRequest): Promise<HttpResponse> {
    const controller = req.timeoutMs !== undefined ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), req.timeoutMs) : undefined;
    try {
      const res = await fetch(req.url, {
        method: req.method,
        ...(req.headers ? { headers: req.headers } : {}),
        ...(req.body !== undefined ? { body: req.body } : {}),
        signal: req.signal ?? controller?.signal,
      });
      return { status: res.status, ok: res.ok, headers: headerObject(res.headers), body: await res.text() };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async *stream(req: HttpRequest): AsyncIterable<Uint8Array> {
    const res = await fetch(req.url, {
      method: req.method,
      ...(req.headers ? { headers: req.headers } : {}),
      ...(req.body !== undefined ? { body: req.body } : {}),
      ...(req.signal ? { signal: req.signal } : {}),
    });
    if (!res.body) return;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  }
}

export type Responder = (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;

export class FakeHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = [];
  constructor(
    private readonly responder: Responder,
    private readonly streamChunks?: (req: HttpRequest) => string[],
  ) {}

  async send(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    return this.responder(req);
  }

  async *stream(req: HttpRequest): AsyncIterable<Uint8Array> {
    this.requests.push(req);
    const enc = new TextEncoder();
    for (const chunk of this.streamChunks?.(req) ?? []) yield enc.encode(chunk);
  }

  get lastRequest(): HttpRequest | undefined {
    return this.requests[this.requests.length - 1];
  }
}

/**
 * Parse a byte stream of Server-Sent Events into successive `data:` payload
 * strings (the streaming format OpenAI, Anthropic, and OpenRouter all use).
 */
export async function* sseData(stream: AsyncIterable<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  const tail = buffer.trim();
  if (tail.startsWith('data:')) yield tail.slice(5).trim();
}
