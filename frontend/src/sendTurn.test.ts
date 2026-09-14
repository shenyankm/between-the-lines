import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { ApiError, sendTurn } from "./api";
import { asApiError, thrown } from "./testing/errors";
import { save, type TurnInput } from "./testing/fixtures";
import { deferred, frame, sse } from "./testing/handlers";
import { server } from "./testing/server";
import type { Result } from "./types";

const done: Result = {
  status: "completed",
  retryable: false,
  failure: null,
  text: "孙淼顿了一下，把话收了回去。",
  save: save({ version: 3, state: { act: 2 } }),
  turn_id: "turn-1",
};

/** Route every turn POST at `stream`, recording what was sent. */
function onTurn(handler: (body: TurnInput, url: URL) => Response) {
  const calls: { body: TurnInput; url: URL; method: string }[] = [];
  server.use(
    http.post("/api/saves/:id/turns", async ({ request }) => {
      const url = new URL(request.url);
      const body = (await request.json()) as TurnInput;
      calls.push({ body, url, method: request.method });
      return handler(body, url);
    }),
  );
  return calls;
}

describe("sendTurn() request", () => {
  it("posts the idempotency key and turn payload to the save's turn route", async () => {
    const requestId = "6f1c1c1e-0d0e-4a0a-9a1a-2b3c4d5e6f70";
    const calls = onTurn(() => sse([frame("done", done)]));

    await sendTurn(
      "save-42",
      4,
      "li",
      "report",
      "材料已经提交，请审核采购。",
      requestId,
      () => {},
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url.pathname).toBe("/api/saves/save-42/turns");
    expect(calls[0]?.body).toEqual({
      request_id: requestId,
      version: 4,
      npc: "li",
      action: "report",
      text: "材料已经提交，请审核采购。",
    });
  });
});

describe("sendTurn() stream", () => {
  it("reports a status frame while the stream is still open, then the result", async () => {
    const gate = deferred();
    const firstStatus = deferred();
    const statuses: string[] = [];
    onTurn(() =>
      sse([frame("status", { text: "李姐正在核对材料…" })], gate.promise, [
        frame("done", done),
      ]),
    );

    const pending = sendTurn(
      "save-1",
      2,
      "li",
      "report",
      "材料已经提交。",
      "req-7",
      (message) => {
        statuses.push(message);
        firstStatus.resolve();
      },
    );

    await firstStatus.promise;
    // The done frame has not been released yet, so only the status arrived.
    expect(statuses).toEqual(["李姐正在核对材料…"]);

    gate.resolve();
    await expect(pending).resolves.toEqual(done);
  });

  it("reports every status frame in order and ignores other event types", async () => {
    const statuses: string[] = [];
    onTurn(() =>
      sse([
        ": keep-alive\n\n",
        frame("status", { text: "正在提交…" }),
        frame("dialogue", { npc: "sun", text: "这句话不该影响状态栏" }),
        frame("status", { text: "角色正在回应…" }),
        frame("done", done),
      ]),
    );

    await expect(
      sendTurn("save-1", 2, "sun", "speak", "你好", "req-8", (message) => {
        statuses.push(message);
      }),
    ).resolves.toEqual(done);
    expect(statuses).toEqual(["正在提交…", "角色正在回应…"]);
  });

  it("reassembles a frame that arrives split across chunk boundaries", async () => {
    const statuses: string[] = [];
    const wire =
      frame("status", { text: "正在生成回复…" }) +
      frame("done", { ...done, turn_id: "turn-2" });
    onTurn(() => sse([wire.slice(0, 23), wire.slice(23, 78), wire.slice(78)]));

    const result = await sendTurn(
      "save-1",
      1,
      "sun",
      "speak",
      "",
      "req-9",
      (message) => {
        statuses.push(message);
      },
    );

    expect(statuses).toEqual(["正在生成回复…"]);
    expect(result).toEqual({ ...done, turn_id: "turn-2" });
  });

  it("refuses to invent a result when the stream closes without a done frame", async () => {
    onTurn(() => sse([frame("status", { text: "正在提交…" })]));

    await expect(
      sendTurn("save-1", 1, "sun", "speak", "", "req-10", () => {}),
    ).rejects.toThrow("连接中断，请恢复回合结果。");
  });

  it("drops a done frame that never received its blank-line terminator", async () => {
    // SSE frames end with an empty line; an unterminated final frame is a
    // truncated response and must be reported as such rather than trusted.
    onTurn(() =>
      sse(['event: done\ndata: {"status":"completed","turn_id":"turn-3"}']),
    );

    await expect(
      sendTurn("save-1", 1, "sun", "speak", "", "req-11", () => {}),
    ).rejects.toThrow("连接中断，请恢复回合结果。");
  });

  it("fails loudly when the response has no readable body", async () => {
    onTurn(() => new HttpResponse(null, { status: 200 }));

    await expect(
      sendTurn("save-1", 1, "sun", "speak", "", "req-12", () => {}),
    ).rejects.toThrow("回复格式无效，请恢复回合结果。");
  });
});

describe("sendTurn() error branches", () => {
  it("surfaces the envelope's message, status, code and id on a rejected turn", async () => {
    onTurn(() =>
      HttpResponse.json(
        {
          error: {
            code: "version_conflict",
            message: "存档版本已过期，请刷新后重试。",
            request_id: "req-conflict",
          },
        },
        { status: 409 },
      ),
    );

    const error = await thrown(
      sendTurn("save-1", 1, "sun", "speak", "", "req-13", () => {}),
    );
    expect(error).toBeInstanceOf(ApiError);
    const described = asApiError(error);
    expect(described.message).toBe("存档版本已过期，请刷新后重试。");
    expect(described.status).toBe(409);
    expect(described.code).toBe("version_conflict");
    expect(described.requestId).toBe("req-conflict");
  });

  it("falls back to its own message when the error body is not JSON", async () => {
    onTurn(() =>
      HttpResponse.text("<html>gateway timeout</html>", {
        status: 504,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const error = await thrown(
      sendTurn("save-1", 1, "sun", "speak", "", "req-14", () => {}),
    );
    // Deliberately shorter than api()'s fallback: sendTurn has its own copy.
    expect(asApiError(error).message).toBe("请求未完成，请重试。");
    expect(asApiError(error).status).toBe(504);
  });

  it("normalizes a network failure without retrying the mutation", async () => {
    onTurn(() => HttpResponse.error());

    const error = await thrown(
      sendTurn("save-1", 1, "sun", "speak", "", "req-15", () => {}),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(asApiError(error).kind).toBe("network");
  });
});

describe("public reply previews", () => {
  it("delivers snapshots before completion without waiting for done", async () => {
    const gate = deferred();
    const visible = deferred();
    const previews: string[] = [];
    onTurn(() =>
      sse([frame("dialogue", { npc: "li", text: "我来" })], gate.promise, [
        frame("dialogue", { npc: "li", text: "我来核对。" }),
        frame("done", done),
      ]),
    );
    const pending = sendTurn(
      "save-1",
      2,
      "li",
      "speak",
      "你好",
      "preview",
      () => {},
      undefined,
      {},
      (text) => {
        previews.push(text);
        visible.resolve();
      },
    );
    await visible.promise;
    expect(previews).toEqual(["我来"]);
    gate.resolve();
    await pending;
    expect(previews).toEqual(["我来", "我来核对。"]);
  });
  it.each([null, { npc: "sun", text: "别人的回复" }, { npc: "li", text: 123 }])(
    "rejects malformed or wrong-role dialogue %s",
    async (data) => {
      onTurn(() => sse([frame("dialogue", data), frame("done", done)]));
      await expect(
        sendTurn("save-1", 2, "li", "speak", "你好", "wrong", () => {}),
      ).rejects.toThrow();
    },
  );
  it("accepts a legacy caller without a preview callback", async () => {
    onTurn(() =>
      sse([
        frame("dialogue", { npc: "li", text: "完成" }),
        frame("done", done),
      ]),
    );
    await expect(
      sendTurn("save-1", 2, "li", "speak", "你好", "legacy", () => {}),
    ).resolves.toMatchObject({ status: "completed" });
  });
});
