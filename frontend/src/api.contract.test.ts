import { afterEach, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { gameApi, isResult, sendTurn } from "./api";
import { save, story } from "./testing/fixtures";
import { frame, sse } from "./testing/handlers";
import { server } from "./testing/server";
import type { Result } from "./types";
const result: Result = {
  status: "completed",
  turn_id: "turn-1",
  save: save(),
  text: "完成",
  retryable: false,
  failure: null,
};
afterEach(() => vi.restoreAllMocks());
it.each<unknown>([
  null,
  [],
  1,
  {},
  { ...result, status: "succeeded" },
  { ...result, turn_id: 4 },
  { ...result, save: null },
  { ...result, save: { ...save(), id: 4 } },
  { ...result, save: { ...save(), version: -1 } },
  { ...result, save: { ...save(), version: 1.5 } },
  { ...result, save: { ...save(), state: null } },
  ...[
    { act: -1 },
    { act: 5 },
    { act: 0.5 },
    { credit: -1 },
    { stress: 101 },
    { heat: "5" },
    { flags: null },
    { flags: [false] },
    { procurement: "other" },
    { ending: 3 },
  ].map((state) => ({
    ...result,
    save: { ...save(), state: { ...save().state, ...state } },
  })),
  { ...result, text: 42 },
  { ...result, retryable: "yes" },
])("rejects an invalid terminal contract %#", (value) => {
  expect(isResult(value)).toBe(false);
});
it("accepts a failed terminal result with no prose and all legitimate state extremes", () => {
  expect(
    isResult({
      ...result,
      status: "failed",
      text: null,
      retryable: true,
      failure: null,
      save: save({
        state: {
          act: 4,
          credit: 100,
          stress: 0,
          heat: 100,
          ending: "主动离开",
          procurement: "approved",
        },
      }),
    }),
  ).toBe(true);
});
it("concrete clients use the existing endpoints and preserve the configured public story", async () => {
  const calls: string[] = [];
  server.use(
    http.all("/api/*", ({ request }) => {
      const path = new URL(request.url).pathname;
      calls.push(`${request.method} ${path}`);
      if (path.endsWith("/story")) return HttpResponse.json(story);
      if (path.endsWith("/config"))
        return HttpResponse.json({
          dev_login: true,
          zhihu_login: false,
          agent_mode: "mock",
          model_ready: true,
        });
      if (path.endsWith("/saves"))
        return HttpResponse.json(request.method === "POST" ? save() : [save()]);
      if (path.endsWith("/logout")) return HttpResponse.json({ ok: true });
      return HttpResponse.json({ id: "u", name: "玩家" });
    }),
  );
  expect(await gameApi.login()).toMatchObject({ id: "u" });
  expect(await gameApi.user()).toMatchObject({ id: "u" });
  expect(await gameApi.saves()).toEqual([save()]);
  expect(await gameApi.createSave()).toEqual(save());
  expect(await gameApi.config()).toMatchObject({ agent_mode: "mock" });
  expect(await gameApi.story()).toEqual(story);
  expect(await gameApi.logout()).toEqual({ ok: true });
  expect(calls).toContain("POST /api/saves");
  expect(calls).toContain("POST /api/auth/logout");
});
it.each([
  { status: "invented", result: null },
  { status: "completed", result: null },
  { status: "failed", result: { status: "failed" } },
])("rejects an invalid lookup response %j", async (payload) => {
  server.use(
    http.get("/api/saves/s/turns/r", () => HttpResponse.json(payload)),
  );
  await expect(gameApi.turn("s", "r")).rejects.toThrow("回复格式无效");
});
it("reads a running and a completed lookup", async () => {
  server.use(
    http.get("/api/saves/s/turns/r", () =>
      HttpResponse.json({
        id: "turn-1",
        usage: {},
        status: "running",
        result: null,
      }),
    ),
  );
  expect((await gameApi.turn("s", "r")).status).toBe("running");
  server.use(
    http.get("/api/saves/s/turns/r", () =>
      HttpResponse.json({
        id: "turn-1",
        usage: {},
        status: "completed",
        result,
      }),
    ),
  );
  expect((await gameApi.turn("s", "r")).result).toEqual(result);
});
it.each([
  frame("status", null),
  frame("status", { text: 5 }),
  frame("done", { status: "completed" }),
  "x".repeat(1024 * 1024 + 1),
])("rejects malformed or excessive stream data %#", async (wire) => {
  server.use(http.post("/api/saves/s/turns", () => sse([wire])));
  await expect(
    sendTurn("s", 1, "sun", "speak", "", "r", () => {}),
  ).rejects.toThrow("回复格式无效");
});
it("handles CRLF and UTF-8 split at every byte and safely cancels the response reader", async () => {
  const bytes = new TextEncoder().encode(
    (frame("status", { text: "中文状态" }) + frame("done", result)).replace(
      /\n/g,
      "\r\n",
    ),
  );
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        },
        cancel() {
          throw new Error("upstream closed");
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    ),
  );
  const statuses: string[] = [];
  expect(
    await sendTurn("s", 1, "sun", "speak", "", "r", (text) =>
      statuses.push(text),
    ),
  ).toEqual(result);
  expect(statuses).toEqual(["中文状态"]);
});
