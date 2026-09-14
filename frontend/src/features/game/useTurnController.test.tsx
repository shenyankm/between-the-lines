import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { save } from "../../testing/fixtures";
import type { Result, Turn, TurnInput } from "../../types";
import { readPending, writePending, type PendingTurn } from "./pending";
import { playKey, useTurnController } from "./useTurnController";
const original: PendingTurn = {
  format: 1,
  userId: "u",
  saveId: "save-1",
  requestId: "11111111-1111-4111-8111-111111111111",
  replayed: false,
  payload: {
    request_id: "11111111-1111-4111-8111-111111111111",
    version: 2,
    npc: "li",
    action: "speak",
    text: "原始内容",
  },
};
const result = (over: Partial<Result> = {}): Result => ({
  turn_id: "turn-1",
  status: "completed",
  text: "已完成",
  retryable: false,
  failure: null,
  save: save(),
  ...over,
});
const terminal = (value = result()): Turn => ({
  id: "turn-1",
  status: value.status,
  result: value,
});
const running = (): Turn => ({
  ...terminal(),
  status: "running",
  result: null,
});
function mount(
  activeRequest?: string,
  onCompleted?: (input: Partial<TurnInput>) => void,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    ...renderHook(
      ({ id, active }) => useTurnController("u", id, active, onCompleted),
      {
        wrapper,
        initialProps: { id: "save-1", active: activeRequest },
      },
    ),
  };
}
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(api.gameApi, "turn").mockResolvedValue(running());
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("turn reconciliation", () => {
  it("adopts a cross-device active turn, polls, and forgets its terminal identity", async () => {
    vi.mocked(api.gameApi.turn)
      .mockResolvedValueOnce(running())
      .mockResolvedValueOnce(terminal());
    const h = mount("11111111-1111-4111-8111-111111111111");
    await tick();
    expect(h.result.current.pending).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    await tick(1000);
    expect(h.result.current.pending).toBeNull();
    h.rerender({
      id: "save-1",
      active: "11111111-1111-4111-8111-111111111111",
    });
    await tick();
    expect(api.gameApi.turn).toHaveBeenCalledTimes(2);
  });
  it("replays a confirmed missing request only once with exactly the original identity and payload", async () => {
    writePending(original);
    vi.mocked(api.gameApi.turn).mockRejectedValue(
      new api.ApiError("missing", 404, "turn_not_found"),
    );
    const sending = vi
      .spyOn(api, "sendTurn")
      .mockRejectedValue(new Error("network"));
    const h = mount();
    await tick();
    await tick(20_000);
    expect(sending).toHaveBeenCalledTimes(1);
    expect(sending.mock.calls[0]?.slice(0, 6)).toEqual([
      "save-1",
      2,
      "li",
      "speak",
      "原始内容",
      "11111111-1111-4111-8111-111111111111",
    ]);
    expect(h.result.current.pending).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(readPending("u", "save-1")?.replayed).toBe(true);
  });
  it("normalizes omitted request defaults without changing its id or version", async () => {
    writePending({
      ...original,
      payload: { request_id: original.requestId, version: 2 },
    });
    vi.mocked(api.gameApi.turn).mockRejectedValue(
      new api.ApiError("missing", 404, "turn_not_found"),
    );
    const sending = vi.spyOn(api, "sendTurn").mockImplementation((...args) => {
      args[6]("处理中");
      return Promise.resolve(result());
    });
    const h = mount();
    await tick();
    expect(h.result.current.pending).toBeNull();
    expect(sending.mock.calls[0]?.slice(0, 6)).toEqual([
      "save-1",
      2,
      "sun",
      "speak",
      "",
      "11111111-1111-4111-8111-111111111111",
    ]);
  });
  it.each([
    new api.ApiError("conflict", 409, "version_conflict"),
    new api.ApiError("unavailable", 503, "model_unconfigured"),
    "non-error",
  ])("handles a failed reconciliation replay %s", async (error) => {
    writePending(original);
    vi.mocked(api.gameApi.turn).mockRejectedValue(
      new api.ApiError("missing", 404, "turn_not_found"),
    );
    vi.spyOn(api, "sendTurn").mockRejectedValue(error);
    const h = mount();
    await tick();
    expect(h.result.current.pending).toBe(
      typeof error === "string" ? "11111111-1111-4111-8111-111111111111" : null,
    );
  });
  it("stops automatic polling after 90 seconds and manual/online recovery starts a bounded window", async () => {
    writePending(original);
    const h = mount();
    await tick(100_000);
    const calls = vi.mocked(api.gameApi.turn).mock.calls.length;
    await tick(20_000);
    expect(api.gameApi.turn).toHaveBeenCalledTimes(calls);
    await act(async () => {
      await h.result.current.recover();
    });
    expect(api.gameApi.turn).toHaveBeenCalledTimes(calls + 1);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(api.gameApi.turn).toHaveBeenCalledTimes(calls + 2);
  });
  it("does not overwrite a newer cached save with an older replay", async () => {
    writePending(original);
    vi.mocked(api.gameApi.turn).mockResolvedValue(terminal());
    const h = mount();
    h.client.setQueryData(playKey("u", "save-1"), {
      save: save({ version: 10 }),
      events: [],
      active_turn: null,
    });
    await tick();
    expect(
      h.client.getQueryData<{ save: { version: number } }>(
        playKey("u", "save-1"),
      )?.save.version,
    ).toBe(10);
  });
  it("ignores a late lookup after changing save and can recover the new save", async () => {
    writePending(original);
    let finish: (t: Turn) => void = () => {};
    vi.mocked(api.gameApi.turn).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const h = mount();
    await tick();
    h.rerender({ id: "other", active: undefined });
    await act(async () => {
      finish(terminal());
      await Promise.resolve();
    });
    expect(h.result.current.pending).toBeNull();
    expect(h.client.getQueryData(playKey("u", "other"))).toBeUndefined();
  });
  it("keeps unknown lookup failures pending", async () => {
    writePending(original);
    vi.mocked(api.gameApi.turn).mockRejectedValue("unknown");
    const h = mount();
    await tick();
    expect(h.result.current.error).toBe("请求未完成。");
    expect(h.result.current.pending).toBe(original.requestId);
  });
});
describe("new submissions", () => {
  it("blocks double submit synchronously, exposes status and completes once", async () => {
    let finish: (r: Result) => void = () => {};
    const sending = vi.spyOn(api, "sendTurn").mockImplementation((...args) => {
      args[6]("生成中");
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const h = mount();
    let first: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      first = h.result.current.submit(save(), "speak", "你好", "sun");
      await h.result.current.submit(save(), "speak", "重复", "sun");
    });
    expect(sending).toHaveBeenCalledTimes(1);
    expect(h.result.current.status).toBe("生成中");
    await act(async () => {
      finish(result());
      await first;
    });
    expect(h.result.current.pending).toBeNull();
  });
  it.each([
    new api.ApiError("conflict", 409, "version_conflict"),
    new api.ApiError("unconfigured", 503, "model_unconfigured"),
    new api.ApiError("running", 409, "turn_still_running"),
    new api.ApiError("gateway", 502),
    new api.ApiError("proxy timeout", 408),
    new api.ApiError("proxy throttle", 429),
    "unknown",
  ])("distinguishes rejected and unknown submissions %s", async (error) => {
    vi.spyOn(api, "sendTurn").mockRejectedValue(error);
    const h = mount();
    await act(async () => {
      await h.result.current.submit(save(), "boundary", "", "sun");
    });
    expect(h.result.current.pending === null).toBe(
      error instanceof api.ApiError &&
        ["version_conflict", "model_unconfigured"].includes(error.code ?? ""),
    );
  });
  it("preserves terminal failure text and never automatically replays a failed turn", async () => {
    const sending = vi
      .spyOn(api, "sendTurn")
      .mockResolvedValue(
        result({ status: "failed", text: null, retryable: true }),
      );
    const h = mount();
    await act(async () => {
      await h.result.current.submit(save(), "speak", "你好", "sun");
    });
    await tick(10_000);
    expect(h.result.current.error).toBe("回合未完成，请刷新后继续。");
    expect(sending).toHaveBeenCalledTimes(1);
  });
  it("rejects a result for another save without clearing the original pending request", async () => {
    vi.spyOn(api, "sendTurn").mockResolvedValue(
      result({ save: save({ id: "foreign" }) }),
    );
    const h = mount();
    await act(async () => {
      await h.result.current.submit(save(), "speak", "你好", "sun");
    });
    expect(h.result.current.error).toContain("不匹配");
    expect(h.result.current.pending).not.toBeNull();
  });
  it("unmount aborts subscriptions, so a late reply never populates another session", async () => {
    let finish: (r: Result) => void = () => {};
    const sending = vi.spyOn(api, "sendTurn").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const h = mount();
    let first: Promise<boolean> = Promise.resolve(false);
    act(() => {
      first = h.result.current.submit(save(), "speak", "你好", "sun");
    });
    h.unmount();
    expect(sending.mock.calls[0]?.[7]?.aborted).toBe(true);
    finish(result());
    expect(await first).toBe(false);
  });
});

describe("failure safety", () => {
  it("keeps a legacy record on proxy 404", async () => {
    writePending({ ...original, payload: undefined });
    vi.mocked(api.gameApi.turn).mockRejectedValue(
      new api.ApiError("proxy", 404),
    );
    const h = mount();
    await tick();
    expect(h.result.current.pending).toBe(original.requestId);
    expect(readPending("u", "save-1")?.requestId).toBe(original.requestId);
  });
  it("pauses on session expiry without forgetting the accepted request", async () => {
    writePending(original);
    vi.mocked(api.gameApi.turn).mockRejectedValue(
      new api.ApiError("登录已失效", 401, "not_authenticated"),
    );
    const h = mount();
    await tick(100_000);
    expect(api.gameApi.turn).toHaveBeenCalledTimes(1);
    expect(h.result.current.pending).toBe(original.requestId);
    expect(h.result.current.blocked).toBe(true);
    await act(async () => {
      await h.result.current.recover();
    });
    expect(api.gameApi.turn).toHaveBeenCalledTimes(1);
  });
  it("blocks new submissions until the server's wait expires", async () => {
    const send = vi
      .spyOn(api, "sendTurn")
      .mockRejectedValue(
        new api.ApiError(
          "繁忙",
          429,
          "concurrency_budget_exhausted",
          "trace",
          5,
        ),
      );
    const h = mount();
    await act(async () => {
      await h.result.current.submit(save(), "speak", "输入", "sun");
    });
    expect(h.result.current.pending).toBeNull();
    expect(h.result.current.blocked).toBe(true);
    await tick(4999);
    await act(async () => {
      await h.result.current.submit(save(), "speak", "输入", "sun");
    });
    expect(send).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(h.result.current.blocked).toBe(false);
  });
  it("does not reinterpret a settled turn as an uncertain submission when refresh fails", async () => {
    const send = vi.spyOn(api, "sendTurn").mockResolvedValue(result());
    const h = mount();
    vi.spyOn(h.client, "invalidateQueries").mockRejectedValue(
      new api.ApiError("刷新失败", 500),
    );
    await act(async () => {
      expect(
        await h.result.current.submit(save(), "speak", "输入", "sun"),
      ).toBe(true);
    });
    await tick(20_000);
    expect(h.result.current.pending).toBeNull();
    expect(h.result.current.error).toContain("刷新未完成");
    expect(send).toHaveBeenCalledTimes(1);
    expect(api.gameApi.turn).not.toHaveBeenCalled();
  });
  it("honors a lookup Retry-After that exceeds the automatic recovery window", async () => {
    writePending(original);
    vi.mocked(api.gameApi.turn).mockRejectedValue(
      new api.ApiError("wait", 503, undefined, "trace", 3600),
    );
    const h = mount();
    await tick(100_000);
    expect(api.gameApi.turn).toHaveBeenCalledTimes(1);
    await act(async () => {
      await h.result.current.recover();
    });
    expect(api.gameApi.turn).toHaveBeenCalledTimes(1);
    expect(h.result.current.pending).toBe(original.requestId);
  });
});

it("starts a fresh recovery window after a full stream timeout", async () => {
  let reject: (error: Error) => void = () => {};
  vi.spyOn(api, "sendTurn").mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const h = mount();
  let submitting: Promise<boolean> = Promise.resolve(false);
  act(() => {
    submitting = h.result.current.submit(save(), "speak", "输入", "sun");
  });
  await tick(90_000);
  await act(async () => {
    reject(new api.ApiError("超时", 0, "request_timeout"));
    await submitting;
  });
  await tick(1000);
  expect(api.gameApi.turn).toHaveBeenCalledTimes(1);
  expect(h.result.current.pending).not.toBeNull();
});
it("exposes the structured failure without ever replaying the completed work", async () => {
  writePending(original);
  vi.mocked(api.gameApi.turn).mockResolvedValue(
    terminal(
      result({
        status: "failed",
        failure: {
          code: "turn_timeout",
          message: "已保存的行动仍然有效。",
          request_id: "trace",
          recovery: "refresh",
        },
      }),
    ),
  );
  const h = mount();
  await tick();
  expect(h.result.current.issue).toMatchObject({
    code: "turn_timeout",
    requestId: "trace",
  });
  expect(h.result.current.pending).toBeNull();
});

it("notifies once with the original payload when background recovery completes", async () => {
  writePending(original);
  vi.mocked(api.gameApi.turn).mockResolvedValue(terminal());
  const completed = vi.fn();
  const mounted = mount(undefined, completed);
  await tick();
  expect(completed).toHaveBeenCalledExactlyOnceWith(original.payload);
  await act(() => mounted.result.current.recover());
  expect(completed).toHaveBeenCalledTimes(1);
});

it("does not clear a draft when the recovered terminal result failed", async () => {
  writePending(original);
  vi.mocked(api.gameApi.turn).mockResolvedValue(
    terminal(result({ status: "failed" })),
  );
  const completed = vi.fn();
  mount(undefined, completed);
  await tick();
  expect(completed).not.toHaveBeenCalled();
});
