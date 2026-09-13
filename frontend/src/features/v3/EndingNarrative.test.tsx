import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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

it("keeps a failed generation's saved facts visible", async () => {
  server.use(
    http.post("/api/saves/save-1/jobs", () =>
      HttpResponse.json({
        id: "failed",
        kind: "ending",
        status: "failed",
        result: { label: "已保存事实", text: "项目尚未交付", interactions: [] },
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
});
