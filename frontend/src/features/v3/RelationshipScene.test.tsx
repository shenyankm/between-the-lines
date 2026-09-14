import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";
import { server } from "../../testing/server";
import { save, sunReply } from "../../testing/fixtures";
import { RelationshipScene } from "./RelationshipScene";
import type { StateV3 } from "./Work";

it("uses original event order and dialogue rather than fact-map order or inferred forgiveness", async () => {
  server.use(
    http.get("/api/saves/save-1/events", () =>
      HttpResponse.json([
        {
          ...sunReply,
          id: "offer",
          channel: "scene",
          text: "我：我愿意先谈一谈。",
        },
        {
          ...sunReply,
          id: "harm",
          channel: "scene",
          text: "孙淼：我不该替你决定。",
        },
      ]),
    ),
  );
  const state = {
    ...save().state,
    story_version: 3,
    relationship: {
      intention: "friendship",
      facts: {
        harm: { event_id: "harm", detail: "摘要" },
        friendship_offer: { event_id: "offer", detail: "意愿" },
      },
    },
  } as StateV3;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RelationshipScene state={state} saveId="save-1" />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("孙淼：我不该替你决定。")).toBeTruthy();
  const items = within(screen.getByRole("list")).getAllByRole("listitem");
  expect(items[0]?.textContent).toContain("我：我愿意先谈一谈。");
  expect(screen.getByText(/是否恢复友谊仍由你决定/)).toBeTruthy();
});
