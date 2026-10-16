export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** The slice of Obsidian's `requestUrl` this adapter needs. */
export interface RequestUrlParam {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
  throw?: boolean;
}
export interface RequestUrlResult {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
}
export type RequestUrlFn = (request: RequestUrlParam) => Promise<RequestUrlResult>;

// Response bodies are forbidden for these statuses.
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => (out[key] = value));
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key] = value;
  } else {
    for (const [key, value] of Object.entries(headers)) out[key] = String(value);
  }
  return out;
}

function toBody(body: BodyInit | null | undefined): string | ArrayBuffer | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof ArrayBuffer) return body;
  if (ArrayBuffer.isView(body)) {
    const view = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    return view.slice().buffer;
  }
  throw new TypeError("Unsupported request body type for requestUrl");
}

/**
 * Adapt Obsidian's `requestUrl` to the `fetch` signature the LegendKeeper SDK expects. requestUrl bypasses
 * CORS and works on mobile. It cannot abort an in-flight request, so an abort rejects the call and the
 * response is discarded.
 */
export function requestUrlFetch(requestUrl: RequestUrlFn): FetchLike {
  return async (input, init) => {
    const signal = init.signal ?? undefined;
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");

    const pending = requestUrl({
      url: input,
      method: init.method ?? "GET",
      headers: headerRecord(init.headers),
      body: toBody(init.body),
      throw: false,
    });

    const result = signal
      ? await new Promise<RequestUrlResult>((resolve, reject) => {
          const onAbort = () => reject(new DOMException("The operation was aborted", "AbortError"));
          signal.addEventListener("abort", onAbort, { once: true });
          pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
        })
      : await pending;

    return new Response(NULL_BODY_STATUS.has(result.status) ? null : result.arrayBuffer, {
      status: result.status,
      headers: result.headers,
    });
  };
}
