import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { Home, Saves } from "./features/Home";
import { server } from "./testing/server";
import { save } from "./testing/fixtures";
import { deferred } from "./testing/handlers";
import type { Save } from "./types";
import { saveMetrics, saveTitle } from "./features/savePresentation";
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
      HttpResponse.json({ id: "u", name: "玩家", can_play: true }),
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
  expect(await screen.findByText("存档 save-1")).toBeTruthy();
});
it("handles login and new-save failures in place, then permits an explicit retry", async () => {
  setup();
  let loggedIn = false;
  server.use(
    http.get("/api/auth/me", () =>
      loggedIn
        ? HttpResponse.json({ id: "u", name: "玩家", can_play: true })
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
      return HttpResponse.json({ id: "u", name: "玩家", can_play: true });
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
it.each([true, false])(
  "guest trial resumes an existing save or creates only one: %s",
  async (existing) => {
    setup();
    let guest = false,
      creates = 0;
    server.use(
      http.get("/api/config", () =>
        HttpResponse.json({
          dev_login: false,
          zhihu_login: false,
          guest_login: true,
          agent_mode: "mock",
          model_ready: true,
        }),
      ),
      http.get("/api/auth/me", () =>
        guest
          ? HttpResponse.json({
              id: "guest",
              name: "试玩者",
              identity_type: "guest",
              can_play: true,
            })
          : HttpResponse.json(apiError("登录", { code: "not_authenticated" }), {
              status: 401,
            }),
      ),
      http.post("/api/auth/guest", () => {
        guest = true;
        return HttpResponse.json({
          id: "guest",
          name: "试玩者",
          identity_type: "guest",
          can_play: true,
        });
      }),
      http.get("/api/saves", () => HttpResponse.json(existing ? [save()] : [])),
      http.post("/api/saves", () => {
        creates++;
        return HttpResponse.json(save());
      }),
    );
    mount();
    fireEvent.click(await screen.findByText("立即试玩 · 第一幕"));
    await waitFor(() =>
      expect(sessionStorage.getItem("trial_identity")).toBe("guest"),
    );
    await screen.findByText("查看全部存档");
    await waitFor(() => expect(creates).toBe(existing ? 0 : 1));
  },
);
it("completed story continuation skips archived and deleted saves", async () => {
  setup();
  server.use(
    http.get("/api/saves", () =>
      HttpResponse.json([
        { ...save(), id: "deleted", deleted_at: "2026-09-13" },
        { ...save(), id: "archive", archived_at: "2026-09-13" },
        { ...save({ state: { ending: "完结" } }), id: "completed" },
      ]),
    ),
  );
  mount();
  const link = await screen.findByText("回看最近的故事");
  expect(link.getAttribute("href")).toBe("/play/completed");
});
it("archive and recycle operations are explicit and recoverable", async () => {
  setup();
  let current = {
    ...save(),
    story_version: 2,
    parent_save_id: "origin",
    last_played_at: "2026-09-13T00:00:00Z",
  };
  server.use(
    http.get("/api/saves", () => HttpResponse.json([current])),
    http.post("/api/saves/:id/manage", async ({ request }) => {
      const { operation } = (await request.json()) as { operation: string };
      current = {
        ...current,
        archived_at: operation === "archive" ? "2026-09-13" : null,
        deleted_at: operation === "delete" ? "2026-09-13" : null,
      };
      return HttpResponse.json(current);
    }),
  );
  mount(true);
  await screen.findByRole("heading", { name: "重玩分支" });
  fireEvent.click(screen.getAllByRole("button", { name: "归档" })[1]!);
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "重玩分支" })).toBeNull(),
  );
  fireEvent.click(screen.getByRole("button", { name: "归档" }));
  fireEvent.click(await screen.findByText("恢复归档"));
  fireEvent.click(screen.getByText("进行中与已完成"));
  fireEvent.click(await screen.findByText("移入回收站（30 天）"));
  fireEvent.click(screen.getByText("回收站"));
  fireEvent.click(await screen.findByText("从回收站恢复"));
  await waitFor(() => expect(screen.queryByText("从回收站恢复")).toBeNull());
});
it("binding completion clears only the guest cache and refreshes inherited saves", async () => {
  setup();
  sessionStorage.setItem("trial_identity", "guest");
  sessionStorage.setItem(
    "draft:v2:guest:s:sun",
    JSON.stringify({ text: "我的草稿", act: 1 }),
  );
  sessionStorage.setItem("pending:v1:guest:s", "old");
  sessionStorage.setItem("draft:v2:other:s:sun", "other");
  server.use(
    http.get("/api/auth/me", () =>
      HttpResponse.json({
        id: "u",
        name: "玩家",
        identity_type: "member",
        can_play: true,
        binding_pending: false,
      }),
    ),
  );
  mount();
  await screen.findByText("查看全部存档");
  await waitFor(() =>
    expect(sessionStorage.getItem("trial_identity")).toBeNull(),
  );
  expect(sessionStorage.getItem("pending:v1:guest:s")).toBeNull();
  expect(sessionStorage.getItem("draft:v2:guest:s:sun")).toBeNull();
  expect(sessionStorage.getItem("draft:v2:other:s:sun")).toBe("other");
});

it("locks only the changing save and keeps a failed operation next to that save", async () => {
  setup();
  const hold = deferred();
  let calls = 0;
  server.use(
    http.get("/api/saves", () =>
      HttpResponse.json([save({ id: "first" }), save({ id: "second" })]),
    ),
    http.post("/api/saves/first/manage", async () => {
      calls++;
      await hold.promise;
      return HttpResponse.json(apiError("此存档暂时无法归档"), { status: 422 });
    }),
  );
  mount(true);
  await screen.findByText("存档 first");
  const [first, second] = screen
    .getAllByRole<HTMLButtonElement>("button", { name: "归档" })
    .filter((button) => !button.hasAttribute("aria-pressed"));
  fireEvent.click(first!);
  fireEvent.click(first!);
  await waitFor(() => expect(calls).toBe(1));
  expect(first!.disabled).toBe(true);
  expect(second!.disabled).toBe(false);
  expect(screen.getByText("正在处理此存档…")).toBeTruthy();
  hold.resolve();
  await screen.findByText("此存档暂时无法归档");
  expect(
    within(first!.closest(".card") as HTMLElement).getByRole("alert"),
  ).toBeTruthy();
  expect(first!.disabled).toBe(false);
});
it("presents versioned save facts and readable ending labels without rewriting them", () => {
  const legacy = save({ state: { ending: "旧故事的结局" } });
  expect(saveTitle(legacy)).toBe("旧故事的结局");
  expect(saveMetrics(legacy)).toBe("专业信用 60 · 心绪消耗 20");
  const modern: Save = {
    ...legacy,
    story_version: 3,
    state: {
      ...legacy.state,
      story_version: 3,
      content_revision: 2,
      node: "act_3",
      tick: 3,
      quiet_turns: 0,
      partner_choice: null,
      exit_draft: null,
      rumination: 32,
      pressure: 46,
      ending: "cut_ties",
      outcome: {
        id: "professional_boundary",
        key_event_ids: [],
        title: "本局已保存标题",
        achievements: [],
        unresolved: [],
      },
    },
  };
  expect(saveTitle(modern)).toBe("本局已保存标题");
  expect(saveMetrics(modern)).toBe("专业信用 60 · 内耗 32 · 工作压力 46");
  if ("outcome" in modern.state) modern.state.outcome = null;
  expect(saveTitle(modern)).toBe("各自为界");
  expect(saveTitle(save({ state: { ending: "future_code" } }))).toBe(
    "故事已结束",
  );
  expect(saveTitle(save())).toBe("第 1 幕");
});
