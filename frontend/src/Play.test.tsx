import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { readPending } from "./features/game/pending";
import { playKey } from "./features/game/useTurnController";
import { apiError } from "./testing/errors";
import { save, sunReply } from "./testing/fixtures";
import { deferred, playHandlers } from "./testing/handlers";
import { server } from "./testing/server";
import authored from "./testing/story-v3.json";
import type { PlayState, Save, Story } from "./types";

const currentSave = (revision: 1 | 2 | 3): Save => ({
  ...save(),
  read_only: revision < 2,
  story_version: 3,
  state: {
    ...save().state,
    story_version: 3,
    content_revision: revision,
    node: "act_1",
    tick: 0,
    rumination: 25,
    pressure: 25,
    partner_choice: null,
    exit_draft: null,
    outcome: null,
    quiet_turns: 0,
  },
});

function renderPlay() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/play/save-1"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

afterEach(() => vi.unstubAllGlobals());

it.each([save(), { ...save(), story_version: 2 }, currentSave(1)])(
  "keeps version $story_version history readable without mounting gameplay",
  async (historical) => {
    const gameplay = vi.fn();
    server.use(...playHandlers({ save: historical, events: [sunReply] }));
    server.use(
      http.get("/api/story", gameplay),
      http.all("/api/saves/:id/turns/*", gameplay),
      http.post("/api/saves/:id/turns", gameplay),
    );
    sessionStorage.setItem(
      "pending:save-1",
      "11111111-1111-4111-8111-111111111111",
    );
    const client = renderPlay();
    expect(
      await screen.findByRole("heading", { name: "旧版故事 · 只读历史" }),
    ).toBeTruthy();
    expect(await screen.findByText(sunReply.text)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(gameplay).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("pending:save-1")).toBeTruthy();
    client.clear();
  },
);

it.each([2, 3] as const)(
  "mounts v3 revision %s and recovers the original turn only after story loads",
  async (revision) => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const gate = deferred();
    const lookup = vi.fn();
    const submit = vi.fn();
    const requestId = "11111111-1111-4111-8111-111111111111";
    const current = currentSave(revision);
    const completed = { ...current, version: current.version + 1 };
    let latest = current;
    server.use(...playHandlers({ save: () => latest }));
    server.use(
      http.get("/api/story", async () => {
        await gate.promise;
        return HttpResponse.json({ ...authored, scenes: {} } as Story);
      }),
      http.get("/api/saves/:id/turns/:requestId", ({ params }) => {
        lookup(params.requestId);
        latest = completed;
        return HttpResponse.json({
          id: "turn-1",
          status: "completed",
          result: {
            status: "completed",
            turn_id: "turn-1",
            save: completed,
            text: "",
            retryable: false,
          },
        });
      }),
      http.post("/api/saves/:id/turns", submit),
    );
    sessionStorage.setItem("pending:save-1", requestId);
    const client = renderPlay();
    expect(await screen.findByText("正在翻开你的故事…")).toBeTruthy();
    expect(lookup).not.toHaveBeenCalled();
    gate.resolve();
    await screen.findByRole("button", { name: "工作系统" });
    await waitFor(() => expect(readPending("test-user", "save-1")).toBeNull());
    expect(lookup).toHaveBeenCalledExactlyOnceWith(requestId);
    expect(submit).not.toHaveBeenCalled();
    expect(
      client.getQueryData<PlayState>(playKey("test-user", "save-1"))?.save
        .version,
    ).toBe(completed.version);
    expect(screen.queryByRole("button", { name: "退出登录" })).toBeNull();
    client.clear();
  },
);

it.each(["/api/auth/me", "/api/saves/:id/play-state", "/api/story"])(
  "offers retry when %s fails",
  async (endpoint) => {
    const request = vi.fn();
    server.use(...playHandlers({ save: currentSave(3) }));
    server.use(
      http.get(endpoint, () => {
        request();
        return HttpResponse.json(apiError("读取暂时失败"), { status: 500 });
      }),
    );
    const client = renderPlay();
    expect(await screen.findByText("读取暂时失败")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    client.clear();
  },
);

it("rejects an unsupported writable story instead of restoring retired gameplay", async () => {
  server.use(...playHandlers({ save: { ...save(), read_only: false } }));
  const client = renderPlay();
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "故事版本不受支持，请刷新重试。",
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  client.clear();
});
