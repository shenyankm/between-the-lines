import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { Home, Saves } from "./features/Home";
import { server } from "./testing/server";
import { save } from "./testing/fixtures";
import { apiError } from "./testing/errors";

afterEach(() => vi.restoreAllMocks());
function mount(saves = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{saves ? <Saves /> : <Home />}</MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
function setup() {
  server.use(
    http.get("/api/config", () =>
      HttpResponse.json({
        dev_login: true,
        zhihu_login: false,
        agent_mode: "mock",
        model_ready: true,
      }),
    ),
    http.get("/api/auth/me", () =>
      HttpResponse.json({ id: "u", name: "玩家" }),
    ),
    http.get("/api/saves", () => HttpResponse.json([save()])),
  );
}
it("keeps service errors distinct from missing authentication on the saves page", async () => {
  setup();
  server.use(
    http.get("/api/saves", () =>
      HttpResponse.json(apiError("读取失败"), { status: 500 }),
    ),
  );
  mount(true);
  expect(await screen.findByText("读取失败")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "返回首页登录" })).toBeNull();
  server.use(http.get("/api/saves", () => HttpResponse.json([save()])));
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  expect(await screen.findByText("故事 1")).toBeTruthy();
});
it("handles login and new-save failures in place, then permits an explicit retry", async () => {
  setup();
  let loggedIn = false;
  server.use(
    http.get("/api/auth/me", () =>
      loggedIn
        ? HttpResponse.json({ id: "u", name: "玩家" })
        : HttpResponse.json(
            apiError("请先登录", { code: "not_authenticated" }),
            { status: 401 },
          ),
    ),
    http.post("/api/auth/dev", () =>
      HttpResponse.json(apiError("登录服务故障"), { status: 500 }),
    ),
  );
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /开发环境试玩/ }));
  expect(await screen.findByText("登录服务故障")).toBeTruthy();
  server.use(
    http.post("/api/auth/dev", () => {
      loggedIn = true;
      return HttpResponse.json({ id: "u", name: "玩家" });
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /开发环境试玩/ }));
  const start = await screen.findByRole("button", { name: /开始新的故事/ });
  server.use(
    http.post("/api/saves", () =>
      HttpResponse.json(apiError("创建失败"), { status: 500 }),
    ),
  );
  fireEvent.click(start);
  expect(await screen.findByText("创建失败")).toBeTruthy();
  expect((start as HTMLButtonElement).disabled).toBe(false);
});
it("does not render another user's cached saves after a 401", async () => {
  setup();
  server.use(
    http.get("/api/auth/me", () =>
      HttpResponse.json(apiError("身份已失效", { code: "not_authenticated" }), {
        status: 401,
      }),
    ),
  );
  const client = mount(true);
  client.setQueryData(["saves", "other-user"], [save()]);
  expect(
    await screen.findByRole("link", { name: "返回首页登录" }),
  ).toBeTruthy();
  expect(screen.queryByText("故事 1")).toBeNull();
});
it("retries configuration and identity failures from their own controls", async () => {
  setup();
  server.use(
    http.get("/api/config", () =>
      HttpResponse.json(apiError("配置读取失败"), { status: 500 }),
    ),
  );
  mount();
  expect(await screen.findByText("配置读取失败")).toBeTruthy();
  setup();
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  await waitFor(() => expect(screen.queryByText("配置读取失败")).toBeNull());
});
