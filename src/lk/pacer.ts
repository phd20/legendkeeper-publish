import type { FetchLike } from "./fetch";

export interface PacerOptions {
  /** Write requests (POST/PUT/PATCH/DELETE) allowed per minute. */
  writesPerMinute: number;
  /** All requests allowed per minute. */
  requestsPerMinute: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Called whenever the pacer has to wait, so the UI can say "Rate limited, resuming in 20s". */
  onWait?: (ms: number, reason: "throttle" | "retry-after") => void;
}

const WINDOW_MS = 60_000;

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Keeps request volume under LegendKeeper's per-key limits with sliding one-minute windows, and honours
 * `Retry-After` / `X-RateLimit-*` hints from responses. Hourly and daily budgets are left to 429 handling.
 */
export class Pacer {
  private readonly writes: number[] = [];
  private readonly requests: number[] = [];
  private blockedUntil = 0;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(private readonly options: PacerOptions) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** Wait until a request of this kind may be sent, then record it. */
  async acquire(kind: "read" | "write", signal?: AbortSignal): Promise<void> {
    for (;;) {
      const now = this.now();
      this.prune(now);
      const waits: Array<[number, "throttle" | "retry-after"]> = [];
      if (this.blockedUntil > now) waits.push([this.blockedUntil - now, "retry-after"]);
      if (this.requests.length >= this.options.requestsPerMinute) {
        waits.push([this.requests[0] + WINDOW_MS - now, "throttle"]);
      }
      if (kind === "write" && this.writes.length >= this.options.writesPerMinute) {
        waits.push([this.writes[0] + WINDOW_MS - now, "throttle"]);
      }
      if (waits.length === 0) break;
      const [ms, reason] = waits.reduce((a, b) => (b[0] > a[0] ? b : a));
      this.options.onWait?.(ms, reason);
      await this.sleep(Math.max(ms, 1), signal);
    }
    const now = this.now();
    this.requests.push(now);
    if (kind === "write") this.writes.push(now);
  }

  /** Learn from a response: back off on 429, or when the tightest tier is exhausted. */
  observe(response: Response): void {
    const now = this.now();
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      this.blockedUntil = Math.max(this.blockedUntil, now + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 5) * 1000);
      return;
    }
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");
    if (remaining !== null && reset !== null && Number(remaining) <= 0 && Number(reset) > 0) {
      this.blockedUntil = Math.max(this.blockedUntil, Number(reset) * 1000);
    }
  }

  private prune(now: number): void {
    for (const list of [this.writes, this.requests]) {
      while (list.length > 0 && list[0] <= now - WINDOW_MS) list.shift();
    }
  }
}

/** Wrap a fetch so API calls (not storage uploads) pass through the pacer. */
export function pacedFetch(base: FetchLike, pacer: Pacer, isApiUrl: (url: string) => boolean): FetchLike {
  return async (input, init) => {
    if (!isApiUrl(input)) return base(input, init);
    const method = (init.method ?? "GET").toUpperCase();
    await pacer.acquire(method === "GET" || method === "HEAD" ? "read" : "write", init.signal ?? undefined);
    const response = await base(input, init);
    pacer.observe(response);
    return response;
  };
}
