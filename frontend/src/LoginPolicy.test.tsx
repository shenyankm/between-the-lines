import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import App from "./App";
import { server } from "./testing/server";
import { apiError } from "./testing/errors";
import { isUser } from "./contracts";

it.each(["/", "/saves", "/play/old-save"])(
  "blocks existing guests before game data is requested at %s",
  async (path) => {
    const gameRequest = vi.fn();
    server.use(
      http.get("/api/config", () =>
        HttpResponse.json({
          guest_login: false,
          dev_login: false,
          zhihu_login: true,
          agent_mode: "deepseek",
          model_ready: true,
        }),
      ),
      http.get("/api/auth/me", () =>
        HttpResponse.json({
          id: "guest",
          name: "试玩者",
          identity_type: "guest",
          can_play: false,
          guest_expires_at: "2026-09-20T00:00:00Z",
        }),
      ),
      http.all("/api/saves", () => {
        gameRequest();
        return HttpResponse.json([]);
      }),
      http.all("/api/saves/*", () => {
        gameRequest();
        return HttpResponse.json({});
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole("region", { name: "登录后继续" });
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "知乎授权登录" }).getAttribute("href"),
      ).toBe("/api/auth/zhihu"),
    );
    expect(screen.getByText(/在试玩有效期内登录可继承进度/)).toBeTruthy();
    expect(screen.queryByText("立即试玩 · 第一幕")).toBeNull();
    expect(screen.queryByText(/开始新的故事/)).toBeNull();
    expect(gameRequest).not.toHaveBeenCalled();
    client.clear();
  },
);

it("does not enable authorization when configuration fails", async () => {
  server.use(
    http.get("/api/auth/me", () =>
      HttpResponse.json({ id: "g", name: "试玩者", can_play: false }),
    ),
    http.get("/api/config", () =>
      HttpResponse.json(apiError("配置读取失败"), { status: 500 }),
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findAllByText("配置读取失败");
  expect(screen.getByText("知乎授权登录").getAttribute("href")).toBeNull();
  expect(screen.queryByText(/开始新的故事/)).toBeNull();
  client.clear();
});

it("requires an explicit boolean gameplay permission from the server", () => {
  expect(isUser({ id: "u", name: "玩家" })).toBe(false);
  expect(isUser({ id: "u", name: "玩家", can_play: "true" })).toBe(false);
  expect(isUser({ id: "u", name: "玩家", can_play: false })).toBe(true);
});
