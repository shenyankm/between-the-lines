import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { expect, it, vi } from "vitest";
import { server } from "../../testing/server";
import { save } from "../../testing/fixtures";
import { Discussion } from "./Discussion";
function mount(fill = vi.fn()) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Discussion userId="test-user" save={save()} fill={fill} />
    </QueryClientProvider>,
  );
  return fill;
}
it("shows only Zhihu HTTPS sources and copies an editable suggestion without sending", async () => {
  server.use(
    http.post("/api/saves/save-1/jobs", () =>
      HttpResponse.json({
        id: "job",
        kind: "discussion",
        status: "completed",
        result: {
          label: "编辑建议",
          cards: [
            null,
            {
              id: "card",
              view: "边界",
              situation: "工作沟通",
              expression: "请先核对事实",
              possible_cost: "需要时间",
              sources: [
                {},
                null,
                {
                  url: "https://www.zhihu.com/question/1",
                  title: "原始来源",
                  author: "作者",
                },
                { url: "https://zhihu.com/question/2", title: "另一来源" },
                { url: "https://evilzhihu.com/fake", title: "伪造来源" },
                { url: "http://www.zhihu.com/question/3", title: "不安全来源" },
                { url: "javascript:alert(1)" },
              ],
            },
          ],
        },
      }),
    ),
  );
  const fill = mount();
  await screen.findByText("边界");
  expect(screen.getAllByRole("link")).toHaveLength(2);
  expect(
    screen.getByRole("link", { name: "原始来源" }).getAttribute("href"),
  ).toBe("https://www.zhihu.com/question/1");
  expect(screen.queryByText("伪造来源")).toBeNull();
  fireEvent.click(screen.getByText("带入输入框，再由我修改"));
  expect(fill).toHaveBeenCalledWith("请先核对事实", "job", "card");
});
it("retries a failed generation request using the same id and polls running work", async () => {
  let calls = 0;
  const ids: string[] = [];
  server.use(
    http.post("/api/saves/save-1/jobs", async ({ request }) => {
      ids.push(((await request.json()) as { request_id: string }).request_id);
      calls++;
      if (calls === 1) return new HttpResponse(null, { status: 400 });
      return HttpResponse.json({
        id: "job",
        kind: "discussion",
        status: calls === 2 ? "running" : "completed",
        result: calls === 2 ? null : { label: "已完成", cards: "invalid" },
      });
    }),
  );
  mount();
  await screen.findByText("暂时无法读取。");
  fireEvent.click(screen.getByText("重试"));
  await screen.findByText("正在整理来源…");
  await screen.findByText("已完成", {}, { timeout: 3000 });
  expect(new Set(ids).size).toBe(1);
});

it.each(["failed", "unknown", "completed"])(
  "explains %s without inventing a suggestion",
  async (status) => {
    server.use(
      http.post("/api/saves/save-1/jobs", () =>
        HttpResponse.json({
          id: "job",
          kind: "discussion",
          status,
          result: null,
        }),
      ),
    );
    mount();
    await screen.findByText(
      status === "completed"
        ? "本幕暂无可用观点，可以先用自己的话回应。"
        : "本次观点整理未完成，可以继续故事，稍后再查看。",
    );
    expect(
      screen.queryByRole("button", { name: "带入输入框，再由我修改" }),
    ).toBeNull();
  },
);
