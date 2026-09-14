import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, it, vi, afterEach } from "vitest";
import { ProductPanel } from "./ProductPanel";
import { save } from "../../testing/fixtures";
import { server } from "../../testing/server";
import type { GameEvent } from "../../types";
const event: GameEvent = {
  id: "e1",
  npc: "sun",
  text: "真实边界",
  kind: "player",
  act: 1,
  action: "boundary",
};
const card = {
  id: "c",
  view: "核对事实",
  situation: "争议",
  expression: "先核对记录",
  possible_cost: "需要时间",
  sources: [
    { url: "https://www.zhihu.com/question/1", title: "资料", author: "作者" },
    { url: "javascript:bad", title: "恶意", author: "" },
  ],
};
function mount(
  ending: boolean,
  fillDraft = vi.fn(),
  version = 3,
  readOnly = false,
) {
  const current = {
    ...save({
      state: {
        ending: ending ? "故事完成" : null,
        ...(version === 3 ? { story_version: 3, work: {} } : {}),
      },
    }),
    read_only: readOnly,
    story_version: version,
  };
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <Routes>
          <Route
            path="/"
            element={
              <ProductPanel
                save={current}
                userId="u"
                events={[
                  event,
                  { ...event, id: "chat", action: "speak", text: "私聊内容" },
                ]}
                disabled={false}
                fillDraft={fillDraft}
              />
            }
          />
          <Route path="/play/branch" element={<h1>独立分支</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText("复盘、观点卡与重玩"));
}
afterEach(() => vi.restoreAllMocks());
it("loads reviewed cards without sending, paginates private history, and keeps share opt-in", async () => {
  const fill = vi.fn(),
    clipboard = vi.fn().mockResolvedValue(undefined);
  let posts = 0;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
  server.use(
    http.get("/api/saves/:id/jobs", () =>
      HttpResponse.json([
        {
          id: "j",
          kind: "discussion",
          status: "completed",
          result: { label: "审核资料", cards: [card] },
        },
      ]),
    ),
    http.get("/api/saves/:id/snapshots", () => HttpResponse.json([])),
    http.get("/api/saves/:id/events", () =>
      HttpResponse.json([
        { ...event, id: "old", kind: "narrative", text: "私人幕间" },
      ]),
    ),
    http.post("/api/feedback", async ({ request }) => {
      posts++;
      expect(await request.json()).toEqual({ text: "我的反馈" });
      return HttpResponse.json({ ok: true });
    }),
  );
  mount(false, fill);
  await screen.findByText("核对事实");
  expect(screen.queryByText(/恶意/)).toBeNull();
  fireEvent.click(screen.getByText("带入草稿（可编辑）"));
  expect(fill).toHaveBeenCalledWith("先核对记录", "j", "c");
  expect(posts).toBe(0);
  fireEvent.click(screen.getByText("完整历史与幕间"));
  fireEvent.click(screen.getByText("查看更早记录"));
  await screen.findByText("私人经历 · 私人幕间");
  expect(screen.queryByText("查看更早记录")).toBeNull();
  fireEvent.click(screen.getByText("制作本地成果卡"));
  fireEvent.click(screen.getByText("最近三次点击行动"));
  fireEvent.click(screen.getByText("复制预览内容"));
  await screen.findByText("已复制");
  expect(clipboard.mock.calls[0]?.[0]).toContain("真实边界");
  expect(clipboard.mock.calls[0]?.[0]).not.toContain("私聊内容");
  fireEvent.click(screen.getByText("结局与事实总结"));
  fireEvent.click(screen.getByText("提交体验反馈"));
  fireEvent.change(screen.getByLabelText("体验反馈"), {
    target: { value: "我的反馈" },
  });
  fireEvent.click(screen.getByText("提交反馈"));
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLTextAreaElement>("体验反馈").value).toBe(
      "",
    ),
  );
  expect(posts).toBe(1);
});
it("retries artifact creation with the same key, shows factual reflection and creates a branch", async () => {
  const requests: Record<string, unknown>[] = [];
  let loaded = false;
  server.use(
    http.get("/api/saves/:id/jobs", () =>
      HttpResponse.json(
        loaded
          ? [
              {
                id: "j",
                kind: "reflection",
                status: "completed",
                result: {
                  label: "实际与可能",
                  nodes: [
                    {
                      event_id: "e1",
                      replay: { snapshot_id: "point", node: "act_1" },
                      actual_expression: "真实边界",
                      feedback: ["已确认", 42],
                      consequences: [{ text: "工作沟通" }],
                      alternative: "先问清事实",
                      possible_cost: "时间",
                    },
                    {
                      actual_expression: 42,
                      feedback: null,
                      consequences: null,
                    },
                  ],
                },
              },
            ]
          : [],
      ),
    ),
    http.get("/api/saves/:id/snapshots", () =>
      HttpResponse.json([
        { id: "point", node: "act_1", created_at: "2026-09-13" },
      ]),
    ),
    http.post("/api/saves/:id/jobs", async ({ request }) => {
      requests.push((await request.json()) as Record<string, unknown>);
      if (requests.length === 1)
        return HttpResponse.json(
          {
            error: {
              code: "internal_error",
              message: "暂时失败",
              recovery: "retry",
              request_id: "req",
            },
          },
          { status: 500 },
        );
      loaded = true;
      return HttpResponse.json({ id: "j" });
    }),
    http.get("/api/saves/:id/events/e1", () =>
      HttpResponse.json({ ...event, text: "原始引用", channel: "dm" }),
    ),
    http.post("/api/saves/:id/branches", async ({ request }) => {
      expect(
        ((await request.json()) as Record<string, unknown>).snapshot_id,
      ).toBe("point");
      return HttpResponse.json({ ...save(), id: "branch" });
    }),
  );
  mount(true);
  await screen.findByText("第一幕开始");
  fireEvent.click(screen.getByText("生成个人化复盘"));
  await screen.findByText("暂时失败");
  fireEvent.click(screen.getByText("生成个人化复盘"));
  await screen.findByText("实际与可能");
  expect(requests[0]?.request_id).toBe(requests[1]?.request_id);
  expect(screen.getByText("角色反馈：已确认")).toBeTruthy();
  fireEvent.click(screen.getByText("查看原始事件"));
  await screen.findByText("原始引用");
  expect(screen.getByText(/起点：第一幕开始/)).toBeTruthy();
  fireEvent.click(screen.getByText("从这里尝试另一种回应"));
  await screen.findByText("独立分支");
});
it("shows v1 compatibility and rejects a malformed artifact response", async () => {
  server.use(
    http.get("/api/saves/:id/jobs", () =>
      HttpResponse.json([
        { id: "x", kind: "unknown", status: "done", result: "bad" },
      ]),
    ),
  );
  mount(false, vi.fn(), 1);
  expect(screen.getByText(/旧版本或只读修订不提供/)).toBeTruthy();
  await screen.findByRole("alert");
});
it.each([1, 2, null])(
  "disables repeat generation for the current act: %s",
  async (act) => {
    server.use(
      http.get("/api/saves/:id/jobs", () =>
        HttpResponse.json([
          { id: "r", kind: "reflection", status: "running", result: null },
          {
            id: "d",
            kind: "discussion",
            status: "running",
            act,
            result: null,
          },
        ]),
      ),
      http.get("/api/saves/:id/snapshots", () => HttpResponse.json([])),
    );
    mount(true);
    await screen.findByText("个人复盘 · 正在整理…");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "生成个人化复盘" })
        .disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "查看本幕观点卡" })
        .disabled,
    ).toBe(act !== 2);
  },
);

it.each(["failed", "unknown"])(
  "keeps facts and honest replay availability when reflection is %s",
  async (status) => {
    server.use(
      http.get("/api/saves/:id/jobs", () =>
        HttpResponse.json([
          {
            id: "r",
            kind: "reflection",
            status,
            result: {
              nodes: [
                {
                  actual_expression: "",
                  event_summary: "已经记录的事实",
                  alternative: "先询问",
                  possible_cost: "需要等待",
                },
              ],
            },
          },
        ]),
      ),
      http.get("/api/saves/:id/snapshots", () => HttpResponse.json([])),
    );
    mount(true);
    await screen.findByText(/已经记录的事实/);
    expect(screen.getByText(/复盘暂时无法确认/)).toBeTruthy();
    expect(screen.getByText(/本局尚未留下可重玩的快照/)).toBeTruthy();
    expect(screen.queryByText("从这里尝试另一种回应")).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "生成个人化复盘" })
        .disabled,
    ).toBe(false);
    expect(screen.queryByText(/正在整理/)).toBeNull();
  },
);

it("retains read-only facts without offering a branch even if an old artifact names a point", async () => {
  server.use(
    http.get("/api/saves/:id/jobs", () =>
      HttpResponse.json([
        {
          id: "r",
          kind: "reflection",
          status: "completed",
          result: {
            nodes: [
              {
                event_summary: "已保存事实",
                alternative: "先询问",
                replay: { snapshot_id: "point" },
              },
            ],
          },
        },
      ]),
    ),
    http.get("/api/saves/:id/snapshots", () =>
      HttpResponse.json([
        { id: "point", node: "act_1", created_at: "2026-09-14" },
      ]),
    ),
  );
  mount(true, vi.fn(), 3, true);
  await screen.findByText("此存档为只读修订，无法创建重玩分支。");
  expect(screen.queryByText("从这里尝试另一种回应")).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "第一幕开始" })
      .disabled,
  ).toBe(true);
});

it("keeps an old reflection reviewable when its quote and nearest replay metadata are missing", async () => {
  server.use(
    http.get("/api/saves/:id/jobs", () =>
      HttpResponse.json([
        {
          id: "legacy",
          kind: "reflection",
          status: "completed",
          result: {
            nodes: [{ alternative: "先核对事实", possible_cost: "需要等待" }],
          },
        },
      ]),
    ),
    http.get("/api/saves/:id/snapshots", () =>
      HttpResponse.json([
        { id: "other", node: "act_2", created_at: "2026-09-14" },
      ]),
    ),
  );
  mount(true);
  await screen.findByText(/引用不足，请查看原始记录/);
  expect(screen.getByText(/未找到这次表达之前的可靠快照/)).toBeTruthy();
  expect(screen.queryByText("从这里尝试另一种回应")).toBeNull();
  expect(screen.queryByText("查看原始事件")).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "第二幕开始" })
      .disabled,
  ).toBe(false);
});
