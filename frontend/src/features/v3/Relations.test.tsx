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
