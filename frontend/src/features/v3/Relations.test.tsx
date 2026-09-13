import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";
import { server } from "../../testing/server";
import { save } from "../../testing/fixtures";
import { Relations } from "./Relations";

it("opens the actual supporting record from a relationship node", async () => {
  server.use(
    http.get("/api/saves/save-1/events/evidence-1", () =>
      HttpResponse.json({
        id: "evidence-1",
        kind: "work",
        npc: "sun",
        speaker: "system",
        text: "你明确不接受别人替你决定。",
      }),
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Relations
        userId="reader"
        save={{
          ...save(),
          relationships: [
            {
              id: "sun",
              name: "孙淼",
              role: "同事",
              description: "后续执行仍待验证。",
              evidence_event_ids: ["evidence-1"],
            },
          ],
        }}
        options={[]}
        act={() => {
          throw new Error("Reading evidence must not submit an action");
        }}
        busy={false}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "孙淼" }));
  expect(screen.getByText("后续执行仍待验证。")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "查看依据 1" }));
  expect(await screen.findByText("你明确不接受别人替你决定。")).toBeTruthy();
});

it("handles missing evidence, failed reads and every follow-up response", async () => {
  let fail = true;
  server.use(
    http.get("/api/saves/save-1/events/evidence", () =>
      fail
        ? new HttpResponse(null, { status: 400 })
        : HttpResponse.json({
            id: "evidence",
            kind: "npc",
            npc: "sun",
            speaker: "sun",
            text: "我会先问你",
          }),
    ),
  );
  const calls: unknown[][] = [];
  const options = [
    {
      action: "follow_up" as const,
      label: "follow_up",
      enabled: true,
      completed: false,
      requires_confirmation: false,
      effect: "",
      reason: "",
    },
  ];
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Relations
        userId="reader"
        save={{
          ...save(),
          relationships: [
            {
              id: "sun",
              name: "孙淼",
              role: "同事",
              description: "等待验证",
              evidence_event_ids: ["evidence"],
            },
            {
              id: "li",
              name: "李姐",
              role: "财务",
              description: "正常工作",
              evidence_event_ids: [],
            },
          ],
        }}
        options={options}
        act={(...args) => calls.push(args)}
        busy={false}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "李姐 · 财务" }));
  expect(screen.getByText("本局尚无支持关系变化的事件。")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "孙淼 · 同事" }));
  fireEvent.click(screen.getByText("查看依据 1"));
  await screen.findByText("无法读取这条记录。");
  fail = false;
  fireEvent.click(screen.getByText("重试"));
  await screen.findByText("我会先问你");
  expect(screen.getByText("本局互动")).toBeTruthy();
  for (const label of [
    "这次不参加，工作资料请照常发我。",
    "我愿意参加，请分别发安排和工作资料。",
    "先告诉我安排，我再决定。",
  ])
    fireEvent.click(screen.getByText(label));
  expect(calls).toEqual(
    ["decline", "agree", "ask_details"].map((response) => [
      "follow_up",
      "sun",
      { params: { boundary_response: response } },
    ]),
  );
});
