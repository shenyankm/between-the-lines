import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";
import { server } from "../../testing/server";
import { EventEvidence } from "./EventEvidence";

it("only loads a requested source, preserves its channel and actor, and permits retry", async () => {
  let reads = 0;
  server.use(
    http.get("/api/saves/save-1/events/source", () => {
      reads++;
      return reads === 1
        ? HttpResponse.json(
            {
              error: {
                code: "internal_error",
                message: "原记录读取失败",
                recovery: "retry",
              },
            },
            { status: 500 },
          )
        : HttpResponse.json({
            id: "source",
            npc: "sun",
            kind: "player",
            speaker: "player",
            channel: "dm",
            act: 2,
            text: "请先问我的意愿",
            action: "speak",
          });
    }),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <EventEvidence saveId="save-1" eventId="source" />
    </QueryClientProvider>,
  );
  expect(reads).toBe(0);
  fireEvent.click(screen.getByText("查看原始事件"));
  await screen.findByText("原记录读取失败");
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  await screen.findByText("请先问我的意愿");
  expect(screen.getByText(/私聊.*对象：孙淼.*记录者：周菱菱/)).toBeTruthy();
  fireEvent.click(screen.getByText("查看原始事件"));
  expect(screen.queryByText("请先问我的意愿")).toBeNull();
});
