import { describe, expect, it, vi } from "vitest";
import { requestUrlFetch, type RequestUrlParam, type RequestUrlResult } from "../../src/lk/fetch";
import { Pacer, pacedFetch } from "../../src/lk/pacer";
import { isValidResourceId, mintResourceId } from "../../src/lk/ids";
import { lkErrorInfo } from "../../src/lk/api";

const bytes = (s: string) => new TextEncoder().encode(s).buffer;

describe("requestUrlFetch", () => {
  it("passes method, headers and JSON body, and builds a Response", async () => {
    const calls: RequestUrlParam[] = [];
    const fetch = requestUrlFetch(async (req): Promise<RequestUrlResult> => {
      calls.push(req);
      return { status: 201, headers: { "x-request-id": "r1", "content-type": "application/json" }, arrayBuffer: bytes('{"ok":true}') };
    });
    const res = await fetch("https://api/x", {
      method: "POST",
      headers: { authorization: "Bearer k" },
      body: JSON.stringify({ a: 1 }),
    });
    expect(calls[0]).toMatchObject({ url: "https://api/x", method: "POST", body: '{"a":1}', throw: false });
    expect(calls[0].headers).toEqual({ authorization: "Bearer k" });
    expect(res.status).toBe(201);
    expect(res.headers.get("x-request-id")).toBe("r1");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns error statuses without throwing", async () => {
    const fetch = requestUrlFetch(async () => ({ status: 404, headers: {}, arrayBuffer: bytes('{"code":"NOT_FOUND"}') }));
    const res = await fetch("https://api/x", {});
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it("handles 204 without a body", async () => {
    const fetch = requestUrlFetch(async () => ({ status: 204, headers: {}, arrayBuffer: new ArrayBuffer(0) }));
    const res = await fetch("https://api/x", { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  it("sends only the bytes of a Uint8Array view", async () => {
    let sent: string | ArrayBuffer | undefined;
    const fetch = requestUrlFetch(async (req) => {
      sent = req.body;
      return { status: 200, headers: {}, arrayBuffer: new ArrayBuffer(0) };
    });
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    await fetch("https://store/up", { method: "PUT", body: backing.subarray(2, 5) });
    expect(Array.from(new Uint8Array(sent as ArrayBuffer))).toEqual([1, 2, 3]);
  });

  it("rejects when already aborted", async () => {
    const fetch = requestUrlFetch(async () => ({ status: 200, headers: {}, arrayBuffer: new ArrayBuffer(0) }));
    const controller = new AbortController();
    controller.abort();
    await expect(fetch("https://api/x", { signal: controller.signal })).rejects.toThrow(/abort/i);
  });
});

function fakeClock() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
    advance: (ms: number) => (t += ms),
  };
}

describe("Pacer", () => {
  it("lets requests through under the limit without waiting", async () => {
    const clock = fakeClock();
    const pacer = new Pacer({ writesPerMinute: 3, requestsPerMinute: 10, now: clock.now, sleep: clock.sleep });
    for (let i = 0; i < 3; i++) await pacer.acquire("write");
    expect(clock.sleeps).toEqual([]);
  });

  it("waits for the oldest write to leave the window", async () => {
    const clock = fakeClock();
    const pacer = new Pacer({ writesPerMinute: 2, requestsPerMinute: 100, now: clock.now, sleep: clock.sleep });
    await pacer.acquire("write");
    clock.advance(10_000);
    await pacer.acquire("write");
    await pacer.acquire("write");
    expect(clock.sleeps).toEqual([50_000]);
  });

  it("does not count reads against the write limit", async () => {
    const clock = fakeClock();
    const pacer = new Pacer({ writesPerMinute: 1, requestsPerMinute: 100, now: clock.now, sleep: clock.sleep });
    await pacer.acquire("write");
    await pacer.acquire("read");
    await pacer.acquire("read");
    expect(clock.sleeps).toEqual([]);
  });

  it("honours Retry-After from a 429 and reports it", async () => {
    const clock = fakeClock();
    const waits: Array<[number, string]> = [];
    const pacer = new Pacer({
      writesPerMinute: 100,
      requestsPerMinute: 100,
      now: clock.now,
      sleep: clock.sleep,
      onWait: (ms, reason) => waits.push([ms, reason]),
    });
    pacer.observe(new Response(null, { status: 429, headers: { "retry-after": "20" } }));
    await pacer.acquire("read");
    expect(waits).toEqual([[20_000, "retry-after"]]);
  });

  it("waits for the reset time when the tightest tier is exhausted", async () => {
    const clock = fakeClock();
    const pacer = new Pacer({ writesPerMinute: 100, requestsPerMinute: 100, now: clock.now, sleep: clock.sleep });
    const reset = Math.floor(clock.now() / 1000) + 30;
    pacer.observe(new Response("{}", { status: 200, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } }));
    await pacer.acquire("read");
    expect(clock.sleeps[0]).toBeGreaterThan(29_000);
    expect(clock.sleeps[0]).toBeLessThanOrEqual(30_000);
  });

  it("stops waiting when aborted", async () => {
    const pacer = new Pacer({
      writesPerMinute: 1,
      requestsPerMinute: 1,
      sleep: (_ms, signal) =>
        new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))),
    });
    await pacer.acquire("write");
    const controller = new AbortController();
    const waiting = pacer.acquire("write", controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow(/abort/i);
  });
});

describe("pacedFetch", () => {
  it("paces API calls, skips storage hosts, and feeds responses back", async () => {
    const acquire = vi.fn(async (_kind: string) => {});
    const observe = vi.fn();
    const pacer = { acquire, observe } as unknown as Pacer;
    const base = vi.fn(async () => new Response("{}", { status: 200 }));
    const f = pacedFetch(base, pacer, (url) => url.startsWith("https://www.legendkeeper.com/"));
    await f("https://www.legendkeeper.com/api/v3/x", { method: "POST" });
    await f("https://www.legendkeeper.com/api/v3/x", {});
    await f("https://storage.example/upload", { method: "PUT" });
    expect(acquire.mock.calls.map((c) => c[0])).toEqual(["write", "read"]);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(base).toHaveBeenCalledTimes(3);
  });
});

describe("ids", () => {
  it("mints valid 24-character ids and rejects malformed ones", () => {
    const id = mintResourceId();
    expect(id).toHaveLength(24);
    expect(isValidResourceId(id)).toBe(true);
    expect(new Set(Array.from({ length: 200 }, mintResourceId)).size).toBe(200);
    expect(isValidResourceId("1abcdefg")).toBe(false);
    expect(isValidResourceId("Abcdefgh")).toBe(false);
    expect(isValidResourceId("abcdefghi")).toBe(false);
    expect(isValidResourceId("abcdefgh")).toBe(true);
  });
});

describe("lkErrorInfo", () => {
  it("reads SDK-style errors structurally", () => {
    expect(lkErrorInfo({ status: 409, code: "HAS_CHILDREN", message: "m", requestId: "r" })).toEqual({
      status: 409,
      code: "HAS_CHILDREN",
      message: "m",
      requestId: "r",
    });
    expect(lkErrorInfo("boom")).toEqual({ message: "boom" });
    expect(lkErrorInfo(null).message).toBe("Unknown error");
  });
});
