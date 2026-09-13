import { afterEach, expect, it, vi } from "vitest";
import { api, ApiError, gameApi, retryAfter, sendTurn } from "./api";
import { frame } from "./testing/handlers";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("parses numeric and date waits without accepting malformed or negative values", () => {
  const now = Date.UTC(2026, 0, 1);
  expect(retryAfter("12", now)).toBe(12);
  expect(retryAfter(new Date(now + 3000).toUTCString(), now)).toBe(3);
  for (const v of [null, "", "-1", "1.5", "garbage"])
    expect(retryAfter(v, now)).toBeUndefined();
});
it("uses safe error details and header correlation for an unknown error code", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        error: {
          code: "future_code",
          message: "稍后再试",
          retry_after_seconds: 5,
          details: [
            { field: "body.text", code: "length", message: "过长" },
            null,
            { field: 5 },
          ],
        },
      }),
      {
        status: 429,
        headers: { "Retry-After": "3", "X-Request-Id": "trace-header" },
      },
    ),
  );
  await expect(api("/saves", {})).rejects.toMatchObject({
    code: "future_code",
    requestId: "trace-header",
    retryAfterSeconds: 5,
    details: [{ field: "body.text", code: "length", message: "过长" }],
  });
});
it("retries GET at most twice and never retries mutations", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() =>
      Promise.resolve(new Response("bad gateway", { status: 502 })),
    );
  const result = api("/config").catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(999);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000);
  expect(await result).toBeInstanceOf(ApiError);
  expect(fetch).toHaveBeenCalledTimes(3);
  await expect(api("/saves", {})).rejects.toMatchObject({ status: 502 });
  expect(fetch).toHaveBeenCalledTimes(4);
});
it("honors Retry-After and hands a long wait back to the user", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() =>
      Promise.resolve(
        new Response("busy", { status: 503, headers: { "Retry-After": "5" } }),
      ),
    );
  const result = api("/config").catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(4999);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5001);
  expect(await result).toMatchObject({ retryAfterSeconds: 5 });
  expect(fetch).toHaveBeenCalledTimes(3);
  fetch.mockImplementation(() =>
    Promise.resolve(
      new Response("quota", {
        status: 503,
        headers: { "Retry-After": "86400" },
      }),
    ),
  );
  await expect(api("/config")).rejects.toMatchObject({
    retryAfterSeconds: 86400,
  });
  expect(fetch).toHaveBeenCalledTimes(4);
});
it("distinguishes a 15 second timeout from explicit cancellation", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => new Promise(() => {}));
  const timeout = api("/saves", {}).catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(15000);
  expect(await timeout).toMatchObject({
    kind: "timeout",
    code: "request_timeout",
  });
  const controller = new AbortController();
  const cancelled = api("/config", undefined, controller.signal).catch(
    (e: unknown) => e,
  );
  controller.abort();
  expect(await cancelled).toMatchObject({ name: "AbortError" });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
it("rejects bad success payloads before they reach the caller", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(new Response("null")));
  for (const read of [
    gameApi.user,
    gameApi.config,
    gameApi.saves,
    gameApi.story,
  ]) {
    await expect(read()).rejects.toMatchObject({ kind: "protocol" });
  }
  fetch.mockImplementation(() =>
    Promise.resolve(new Response("<html>gateway</html>")),
  );
  await expect(api("/config")).rejects.toMatchObject({ kind: "protocol" });
  expect(fetch).toHaveBeenCalledTimes(5);
});
it("treats SSE error as unknown outcome, never a terminal result", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      frame("error", {
        code: "subscription_failed",
        turn_id: "t",
        request_id: "trace",
        recovery: "recover",
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    ),
  );
  await expect(
    sendTurn("s", 1, "sun", "speak", "你好", "r", () => {}),
  ).rejects.toMatchObject({
    code: "subscription_failed",
    requestId: "trace",
    recovery: "recover",
  });
});
it("ends an idle stream after 90 seconds and cancels its reader", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(new ReadableStream({ cancel }), {
      headers: { "Content-Type": "text/event-stream" },
    }),
  );
  const result = sendTurn("s", 1, "sun", "speak", "", "r", () => {}).catch(
    (e: unknown) => e,
  );
  await vi.advanceTimersByTimeAsync(90_000);
  expect(await result).toMatchObject({ kind: "timeout" });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("supports cancellation before fetch and during retry backoff without leaked rejections", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  controller.abort();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new DOMException("cancelled", "AbortError"));
  await expect(
    api("/config", undefined, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  // Native cancellation can also arrive from fetch independently of our timeout.
  await expect(api("/config")).rejects.toMatchObject({ name: "AbortError" });
  const next = new AbortController();
  fetch.mockResolvedValue(new Response("busy", { status: 503 }));
  const result = api("/config", undefined, next.signal).catch(
    (e: unknown) => e,
  );
  await vi.advanceTimersByTimeAsync(10);
  next.abort();
  expect(await result).toMatchObject({ name: "AbortError" });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});
it("removes the backoff listener after a successful GET retry", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
    .mockResolvedValueOnce(new Response('{"ok":true}'));
  const result = api("/config", undefined, controller.signal);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(2);
  controller.abort();
  expect(vi.getTimerCount()).toBe(0);
});
it("times out while reading JSON and preserves response correlation on malformed payloads", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(new ReadableStream()));
  const result = api("/saves", {}).catch((e: unknown) => e);
  await vi.advanceTimersByTimeAsync(15000);
  expect(await result).toMatchObject({ kind: "timeout" });
  fetch.mockResolvedValue(
    new Response("null", { headers: { "X-Request-Id": "bad-payload" } }),
  );
  await expect(gameApi.user()).rejects.toMatchObject({
    kind: "protocol",
    requestId: "bad-payload",
  });
  fetch.mockResolvedValue(
    new Response("not json", { headers: { "X-Request-Id": "bad-json" } }),
  );
  await expect(api("/config")).rejects.toMatchObject({ requestId: "bad-json" });
});
it("accepts recovery advice but ignores invalid wait and field details", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  for (const seconds of [-1, 1.5, "5"]) {
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "validation_failed",
            message: "检查输入",
            recovery: "edit",
            retry_after_seconds: seconds,
            details: [
              { field: "name", code: null },
              { field: "name", code: "type", message: 5 },
            ],
          },
        }),
        { status: 422 },
      ),
    );
    await expect(api("/saves", {})).rejects.toMatchObject({
      recovery: "edit",
      retryAfterSeconds: undefined,
      details: [],
    });
  }
});
it.each([
  null,
  {},
  { code: "subscription_failed" },
  { code: "subscription_failed", turn_id: "t" },
])("rejects malformed SSE errors %j", async (value) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(frame("error", value), {
      headers: {
        "Content-Type": "text/event-stream",
        "X-Request-Id": "bad-stream",
      },
    }),
  );
  await expect(
    sendTurn("s", 0, "sun", "speak", "", "r", () => {}),
  ).rejects.toMatchObject({
    code: "invalid_response",
    requestId: "bad-stream",
  });
});
it("rejects malformed SSE JSON and a missing body, while tolerating heartbeat comments", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("event: done\ndata: invalid-json\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    }),
  );
  await expect(
    sendTurn("s", 0, "sun", "speak", "", "r", () => {}),
  ).rejects.toMatchObject({ code: "invalid_response" });
  fetch.mockResolvedValue(
    new Response(null, { headers: { "Content-Type": "text/event-stream" } }),
  );
  await expect(
    sendTurn("s", 0, "sun", "speak", "", "r", () => {}),
  ).rejects.toMatchObject({ code: "invalid_response" });
  fetch.mockResolvedValue(
    new Response(": heartbeat\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    }),
  );
  await expect(
    sendTurn("s", 0, "sun", "speak", "", "r", () => {}),
  ).rejects.toMatchObject({ code: "stream_interrupted" });
});
it("cancels an SSE subscription without reporting failure", async () => {
  const controller = new AbortController();
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new DOMException("cancelled", "AbortError"),
  );
  await expect(
    sendTurn("s", 0, "sun", "speak", "", "r", () => {}, controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});
it("stops reading when a status subscriber cancels the subscription", async () => {
  const controller = new AbortController();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      new ReadableStream({
        start(stream) {
          stream.enqueue(
            new TextEncoder().encode(frame("status", { text: "处理中" })),
          );
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    ),
  );
  await expect(
    sendTurn(
      "s",
      0,
      "sun",
      "speak",
      "",
      "r",
      () => controller.abort(),
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
});

function interruptedBody() {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new TypeError("terminated"));
      },
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": "body-trace",
      },
    },
  );
}
it("retries interrupted GET response bodies at 1 and 2 seconds", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(interruptedBody()));
  const result = api("/config").catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(999);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(await result).toMatchObject({
    kind: "network",
    requestId: "body-trace",
  });
});
it("recovers a GET when a later response body arrives intact", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(interruptedBody())
    .mockResolvedValueOnce(Response.json({ ok: true }));
  const result = api("/config");
  await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("does not retry a write with an interrupted response body", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(interruptedBody());
  await expect(api("/saves", {})).rejects.toMatchObject({ kind: "network" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not retry invalid JSON syntax", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{"));
  await expect(api("/config")).rejects.toMatchObject({ kind: "protocol" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("classifies an interrupted body without a correlation header", async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new TypeError("network"));
      },
    }),
  );
  vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
  await expect(api("/saves", {})).rejects.toMatchObject({
    kind: "network",
    requestId: undefined,
  });
});
