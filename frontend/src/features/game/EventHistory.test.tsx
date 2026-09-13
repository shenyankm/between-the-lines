import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";
import { server } from "../../testing/server";
import { EventHistory } from "./EventHistory";

it("loads records before the visible page without truncating existing records", async () => {
  const recent = Array.from({ length: 50 }, (_, i) => ({id: `e-${i + 1}`, kind: "npc", npc: "sun", text: `当前记录 ${i + 1}`, channel: "dm"}));
  server.use(http.get("/api/saves/history-save/events", ({request}) => {
    const before = new URL(request.url).searchParams.get("before");
    expect(new URL(request.url).searchParams.get("limit")).toBe("50");
    if (before) {
      expect(before).toBe("e-1");
      return HttpResponse.json([{ id: "oldest", kind: "work", npc: "sun", speaker: "system", text: "最早的一条记录", channel: "work" }]);
    }
    return HttpResponse.json(recent);
  }));
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  render(<QueryClientProvider client={client}><EventHistory userId="user" saveId="history-save" version={1} /></QueryClientProvider>);
  expect(await screen.findByText("当前记录 50")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name: "加载更早记录"}));
  expect(await screen.findByText("最早的一条记录")).toBeTruthy();
  expect(screen.getByText("当前记录 50")).toBeTruthy();
  expect(screen.queryByRole("button", {name: "加载更早记录"})).toBeNull();
});
