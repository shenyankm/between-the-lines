import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { ErrorNotice } from "./ErrorNotice";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("shows login only for 401 and exposes retry for a service failure", () => {
  const retry = vi.fn();
  const h = render(
    <MemoryRouter>
      <ErrorNotice error={new ApiError("失效", 401)} onRetry={retry} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "返回首页登录" })).toBeTruthy();
  h.rerender(
    <MemoryRouter>
      <ErrorNotice error={new ApiError("服务故障", 503)} onRetry={retry} />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("link", { name: "返回首页登录" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  expect(retry).toHaveBeenCalledTimes(1);
});
it("honors cooldown before enabling retry and copies diagnostics", async () => {
  vi.useFakeTimers();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const error = new ApiError(
    "忙碌",
    429,
    "daily_limit_reached",
    "trace",
    2,
    "http",
    [{ field: "body.text", code: "length", message: "过长" }],
  );
  render(
    <MemoryRouter>
      <ErrorNotice error={error} onRetry={() => {}} />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("button", { name: "重新加载" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByText("请等待 2 秒后再试。")).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(
    screen.getByRole("button", { name: "重新加载" }).hasAttribute("disabled"),
  ).toBe(false);
  fireEvent.click(screen.getByText("错误详情"));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "复制错误信息" }));
    await Promise.resolve();
  });
  expect(writeText).toHaveBeenCalledWith(
    "错误码：daily_limit_reached\n请求编号：trace",
  );
  expect(screen.getByText("已复制")).toBeTruthy();
});
it("handles denied clipboard and distinguishes edit and administrator advice", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  const h = render(
    <MemoryRouter>
      <ErrorNotice
        error={
          new ApiError(
            "未配置",
            503,
            "model_unconfigured",
            undefined,
            undefined,
            "http",
            undefined,
            "contact",
          )
        }
      />
    </MemoryRouter>,
  );
  expect(screen.getByText("请联系管理员处理。")).toBeTruthy();
  fireEvent.click(screen.getByText("错误详情"));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "复制错误信息" }));
    await Promise.resolve();
  });
  expect(screen.getByText("复制失败，请手动选择上方信息。")).toBeTruthy();
  h.rerender(
    <MemoryRouter>
      <ErrorNotice
        error={
          new ApiError(
            "输入错误",
            422,
            undefined,
            undefined,
            undefined,
            "http",
            undefined,
            "edit",
          )
        }
      />
    </MemoryRouter>,
  );
  expect(screen.getByText("请检查输入或选择其他行动。")).toBeTruthy();
});
it("renders no alert for explicit cancellation", () => {
  render(
    <MemoryRouter>
      <ErrorNotice error={new DOMException("cancelled", "AbortError")} />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("alert")).toBeNull();
});
