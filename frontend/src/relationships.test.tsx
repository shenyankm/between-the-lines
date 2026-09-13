import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http } from "msw";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import App from "./App";
import { save, story } from "./testing/fixtures";
import { frame, playHandlers, sse } from "./testing/handlers";
import { server } from "./testing/server";
import type { Save, TurnInput } from "./types";

function show(current: Save | (() => Save)) {
  server.use(...playHandlers({ save: current }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/play/save-1"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("withholds final choices until both work facts exist", async () => {
  show(save({ state: { act: 3, flags: ["clarified"] } }));
  await screen.findByRole("button", { name: "提交实验结果" });
  expect(screen.queryByRole("button", { name: /结束与孙淼/ })).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "继续故事" })
      .disabled,
  ).toBe(true);
});

it("submits an explicit choice once, then permits the ending", async () => {
  let current = save({ state: { act: 3, flags: ["clarified", "delivered"] } });
  const requests: TurnInput[] = [];
  server.use(
    http.post("/api/saves/:id/turns", async ({ request }) => {
      const input = (await request.json()) as TurnInput;
      requests.push(input);
      current = {
        ...current,
        version: current.version + 1,
        state: { ...current.state, flags: [...current.state.flags, "sun_cut"] },
        npc_greetings: { sun: "以后只沟通工作。" },
      };
      return sse([
        frame("done", {
          turn_id: "t",
          status: "completed",
          save: current,
          retryable: false,
        }),
      ]);
    }),
  );
  show(() => current);
  const choose = await screen.findByRole("button", {
    name: "结束与孙淼的私人来往，仅保留工作沟通",
  });
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "继续故事" })
      .disabled,
  ).toBe(true);
  fireEvent.click(choose);
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "继续故事" })
        .disabled,
    ).toBe(false),
  );
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ action: "cut_ties", npc: "sun" });
  expect(screen.queryByRole("button", { name: /保持距离继续观察/ })).toBeNull();
  expect(screen.getByText("以后只沟通工作。")).toBeTruthy();
});

it("shows background people as read-only cards and the private Wang reply after contact", async () => {
  const current = save({ state: { flags: ["wang_contacted"] } });
  current.relationships = [
    {
      id: "wang",
      name: "王叔（王会计）",
      role: "退休前辈",
      description: "你们的忘年交情仍在。",
    },
  ];
  show(current);
  fireEvent.click(await screen.findByRole("button", { name: "手机" }));
  expect(screen.getByText(story.wang_reply)).toBeTruthy();
  expect(screen.getByRole("heading", { name: "王叔（王会计）" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /王叔/ })).toBeNull();
  expect(screen.getByRole("button", { name: /李姐\s*财务会计/ })).toBeTruthy();
});

it("shows the fixed ending even when generated epilogue is absent", async () => {
  const current = save({
    state: { act: 4, ending: "找回自我 · 只留工作往来", flags: ["sun_cut"] },
  });
  current.ending_summary = "主线结局。你已结束与孙淼的私人来往。";
  show(current);
  expect(await screen.findByText(current.ending_summary)).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "生成故事回顾" })
      .disabled,
  ).toBe(false);
});
