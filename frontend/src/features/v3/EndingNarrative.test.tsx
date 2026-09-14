import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";
import { server } from "../../testing/server";
import { save } from "../../testing/fixtures";
import { EndingNarrative } from "./EndingNarrative";

it("renders narrative and actual key interactions using the same request after remount", async () => {
  const ids: unknown[] = [];
  server.use(
    http.post("/api/saves/save-1/jobs", async ({ request }) => {
      const body = (await request.json()) as {
        request_id: string;
        kind: string;
      };
      ids.push(body.request_id);
      expect(body.kind).toBe("ending");
      return HttpResponse.json({
        id: "ending",
        kind: "ending",
        status: "completed",
        result: {
          label: "AI 生成",
          text: "工作问题处理了，关系仍需观察。",
          interactions: [
            {
              actual_expression: "我想先知道具体安排。",
              feedback: ["可以，等你决定。"],
            },
          ],
        },
      });
    }),
  );
  function mount() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <EndingNarrative save={save()} userId="ending-user" />
      </QueryClientProvider>,
    );
  }
  const first = mount();
  expect(
    await screen.findByText("工作问题处理了，关系仍需观察。"),
  ).toBeTruthy();
  expect(screen.getByText("我想先知道具体安排。")).toBeTruthy();
  first.unmount();
  mount();
  expect(
    await screen.findByText("工作问题处理了，关系仍需观察。"),
  ).toBeTruthy();
  expect(ids.length).toBe(2);
  expect(ids[1]).toBe(ids[0]);
});

it.each(["failed", "unknown"])(
  "keeps a %s generation's saved facts visible",
  async (status) => {
    server.use(
      http.post("/api/saves/save-1/jobs", () =>
        HttpResponse.json({
          id: "failed",
          kind: "ending",
          status,
          result: {
            label: "已保存事实",
            text: "项目尚未交付",
            interactions: [],
          },
        }),
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <EndingNarrative save={save()} userId="fallback-user" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("项目尚未交付")).toBeTruthy();
    expect(
      screen.getByText("本次生成未完成，展示已保存事实，不补写新的经历。"),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  },
);

it("recovers a failed read and displays event summaries when there was no player quote", async () => {
  let calls = 0;
  server.use(
    http.post("/api/saves/save-1/jobs", () => {
      calls++;
      if (calls === 1) return new HttpResponse(null, { status: 400 });
      return HttpResponse.json({
        id: "ending",
        kind: "ending",
        status: "completed",
        result: {
          text: "事实正文",
          interactions: [
            null,
            {
              actual_expression: "",
              event_summary: "提交了实验结果",
              feedback: [null, "已收到"],
            },
            { actual_expression: 3, event_summary: 3, feedback: "invalid" },
          ],
        },
      });
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <EndingNarrative userId="test-user" save={save()} />
    </QueryClientProvider>,
  );
  await screen.findByText("结局正文暂时无法生成，以下事实总结仍然有效。");
  fireEvent.click(screen.getByText("重试读取"));
  await screen.findByText("提交了实验结果");
  expect(screen.getByText("已收到")).toBeTruthy();
  expect(screen.getByText("事实正文")).toBeTruthy();
});

it("separates long narrative paragraphs without interpreting markup", async () => {
  server.use(
    http.post("/api/saves/save-1/jobs", () =>
      HttpResponse.json({
        id: "paragraphs",
        kind: "ending",
        status: "completed",
        result: { text: "第一段保留事实。\n\n<b>第二段仍然只是文字。</b>" },
      }),
    ),
  );
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <EndingNarrative save={save()} userId="paragraph-user" />
    </QueryClientProvider>,
  );
  expect((await screen.findByText("第一段保留事实。")).tagName).toBe("P");
  expect(screen.getByText("<b>第二段仍然只是文字。</b>").tagName).toBe("P");
  expect(view.container.querySelector("b")).toBeNull();
});
