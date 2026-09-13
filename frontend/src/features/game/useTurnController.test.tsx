import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { save } from "../../testing/fixtures";
import type { Result, Turn } from "../../types";
import { readPending, writePending, type PendingTurn } from "./pending";
import { playKey, useTurnController } from "./useTurnController";
const original: PendingTurn = {
  format: 1,
  userId: "u",
  saveId: "save-1",
  requestId: "request-1",
  replayed: false,
  payload: {
    request_id: "request-1",
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
  save: save(),
  ...over,
});
const terminal = (value = result()): Turn => ({
  id: "turn-1",
  status: value.status,
  result: value,
  usage: {
    model: null,
    mode: null,
    model_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    elapsed_ms: 0,
    cost_estimate_usd: 0,
    billing_complete: true,
  },
});
const running = (): Turn => ({
  ...terminal(),
  status: "running",
  result: null,
});
function mount(activeRequest?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    ...renderHook(({ id, active }) => useTurnController("u", id, active), {
      wrapper,
      initialProps: { id: "save-1", active: activeRequest },
    }),
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
    const h = mount("request-1");
    await tick();
    expect(h.result.current.pending).toBe("request-1");
    await tick(1000);
    expect(h.result.current.pending).toBeNull();
    h.rerender({ id: "save-1", active: "request-1" });
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
      "request-1",
    ]);
    expect(h.result.current.pending).toBe("request-1");
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
      "request-1",
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
      typeof error === "string" ? "request-1" : null,
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
    new api.ApiError("cap", 503, "monthly_cost_cap_reached"),
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
        ["version_conflict", "monthly_cost_cap_reached"].includes(
          error.code ?? "",
        ),
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
