import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import App from "./App";
import { apiError } from "./testing/errors";
import {
  epilogueEvent,
  olderSunReply,
  save,
  story,
  sunReply,
  type TurnInput,
} from "./testing/fixtures";
import { deferred, frame, playHandlers, sse } from "./testing/handlers";
import { server } from "./testing/server";
import type { GameEvent, Result } from "./types";

const SAVE_ID = "save-1";
const PENDING_KEY = `pending:${SAVE_ID}`;
const RECOVER = "恢复回合结果";
const TURNS_ROUTE = "/api/saves/:id/turns";

function renderPlay(): QueryClient {
  // retry:false keeps failure assertions immediate instead of waiting out
  // React Query's three exponential retries.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/play/${SAVE_ID}`]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

/** Shape of the `crypto.randomUUID()` idempotency key Play stores per turn. */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function button(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name });
}

function composer(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "对角色说的话" });
}

async function alertText(): Promise<string> {
  const alert = await screen.findByRole("alert");
  return alert.querySelector("p")?.textContent ?? alert.textContent ?? "";
}

/** Matches that belong to the conversation rather than the (closed) drawer. */
function inConversation(nodes: HTMLElement[]): HTMLElement[] {
  return nodes.filter((node) => node.closest("dialog") === null);
}

function drawer(): HTMLDialogElement {
  const dialog = document.querySelector("dialog");
  if (!dialog) throw new Error("expected Play to render its drawer <dialog>");
  return dialog;
}

/** A turn left unfinished by a reload, waiting in sessionStorage. */
function leavePending(requestId: string): void {
  sessionStorage.setItem(PENDING_KEY, requestId);
}

function storedRequestId(): string | null {
  const raw = sessionStorage.getItem("pending:v1:test-user:save-1");
  if (raw) return (JSON.parse(raw) as { requestId: string }).requestId;
  return sessionStorage.getItem(PENDING_KEY);
}

describe("Play: recovering an interrupted turn", () => {
  it("adopts a turn that finished while the page was away", async () => {
    const requestId = "c70a4f95-e7f4-5884-ba2a-d3f3e2c9ea90";
    const before = save({ version: 2, state: { act: 1 } });
    const after = save({
      version: 5,
      state: { act: 2, credit: 78, flags: ["requirements"] },
    });
    const result: Result = {
      status: "completed",
      retryable: false,
      failure: null,
      text: "李姐记下了这些材料。",
      save: after,
      turn_id: "turn-9",
    };
    let current = before;
    let reads = 0;

    server.use(
      ...playHandlers({
        save: () => {
          reads += 1;
          return current;
        },
      }),
      http.get("/api/saves/:id/turns/:requestId", () => {
        // The backend already applied this turn, so a later read returns it.
        current = after;
        return HttpResponse.json({
          id: result.turn_id,
          status: "completed",
          result,
        });
      }),
    );
    leavePending(requestId);
    renderPlay();

    await waitFor(() => expect(storedRequestId()).toBeNull());
    expect(screen.queryByRole("button", { name: RECOVER })).toBeNull();
    // The recovered save was written into the query cache and re-read.
    expect(screen.getByText(/已存档 · 5/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "财务窗口" })).toBeTruthy();
    expect(reads).toBeGreaterThan(1);
  });

  it("shows a failed turn's own message and clears the pending key", async () => {
    server.use(
      ...playHandlers({ save: save() }),
      http.get("/api/saves/:id/turns/:requestId", () =>
        HttpResponse.json({
          id: "turn-1",
          status: "failed",
          result: {
            status: "failed",
            retryable: true,
            failure: null,
            text: "模型返回失败，请重试。",
            save: save(),
            turn_id: "turn-1",
          } satisfies Result,
        }),
      ),
    );
    leavePending("00a438ed-04cd-5be7-b042-ec0af3fd33b1");
    renderPlay();

    expect(await alertText()).toBe("模型返回失败，请重试。");
    expect(storedRequestId()).toBeNull();
  });

  it("substitutes a message when a failed turn carries no text", async () => {
    server.use(
      ...playHandlers({ save: save() }),
      http.get("/api/saves/:id/turns/:requestId", () =>
        HttpResponse.json({
          id: "turn-1",
          status: "failed",
          result: {
            status: "failed",
            retryable: true,
            failure: null,
            text: "",
            save: save(),
            turn_id: "turn-1",
          } satisfies Result,
        }),
      ),
    );
    leavePending("1e4e1f32-8e4d-58f7-addc-707703559404");
    renderPlay();

    expect(await alertText()).toBe("回合未完成，请刷新后继续。");
    expect(storedRequestId()).toBeNull();
  });

  it("keeps the pending key while the turn is still running", async () => {
    server.use(
      ...playHandlers({ save: save() }),
      http.get("/api/saves/:id/turns/:requestId", () =>
        HttpResponse.json({
          id: "turn-1",
          status: "running",
          result: null,
        }),
      ),
    );
    leavePending("1e1bcf73-401e-5bb2-8845-6059246eb1b8");
    renderPlay();

    expect(await alertText()).toBe("这一回合仍在处理，请稍后恢复。");
    expect(storedRequestId()).toBe("1e1bcf73-401e-5bb2-8845-6059246eb1b8");
    expect(screen.getByRole("button", { name: RECOVER })).toBeTruthy();
  });

  it("drops a pending key the API no longer recognises", async () => {
    server.use(
      ...playHandlers({ save: save() }),
      http.get("/api/saves/:id/turns/:requestId", () =>
        HttpResponse.json(
          apiError("回合不存在或已过期。", { code: "turn_not_found" }),
          { status: 404 },
        ),
      ),
    );
    leavePending("f505b68c-c69a-52fb-a8dc-048e6ea2e136");
    renderPlay();

    expect(await alertText()).toBe("回合不存在或已过期。");
    expect(storedRequestId()).toBeNull();
    expect(screen.queryByRole("button", { name: RECOVER })).toBeNull();
  });

  it("keeps the pending key when recovery fails for any other reason", async () => {
    server.use(
      ...playHandlers({ save: save() }),
      http.get("/api/saves/:id/turns/:requestId", () =>
        HttpResponse.json(
          apiError("服务暂时不可用。", { code: "model_unconfigured" }),
          { status: 503 },
        ),
      ),
    );
    leavePending("41a340a7-0813-5280-ba72-001a9025d59e");
    renderPlay();

    expect(await alertText()).toBe("服务暂时不可用。");
    // Still recoverable later: only a 404 proves the key is dead.
    expect(storedRequestId()).toBe("41a340a7-0813-5280-ba72-001a9025d59e");
    expect(screen.getByRole("button", { name: RECOVER })).toBeTruthy();
  });

  it("blocks every action while a turn is pending, so none is sent twice", async () => {
    let turnPosts = 0;
    server.use(
      ...playHandlers({ save: save({ state: { act: 1 } }) }),
      http.post(TURNS_ROUTE, () => {
        turnPosts += 1;
        return sse([frame("done", { status: "completed", turn_id: "t" })]);
      }),
    );
    server.use(
      http.get("/api/saves/:id/turns/:requestId", () =>
        HttpResponse.json({
          id: "turn-1",
          status: "running",
          result: null,
        }),
      ),
    );
    leavePending("878a90ac-0af6-5ddc-8d05-c38a61e9bcd9");
    renderPlay();

    await screen.findByRole("heading", { name: "公司食堂" });
    const choice = button("明确表达我的边界");
    expect(choice.disabled).toBe(true);
    expect(composer().disabled).toBe(true);

    fireEvent.click(choice);
    expect(turnPosts).toBe(0);
    expect(storedRequestId()).toBe("878a90ac-0af6-5ddc-8d05-c38a61e9bcd9");
    // The only way forward is recovery, and it stays available.
    expect(screen.getByRole("button", { name: RECOVER })).toBeTruthy();
  });
});

describe("Play: submitting a turn", () => {
  it("preserves a new draft while the previous action finishes refreshing", async () => {
    const gate = deferred();
    const before = save({ version: 2, state: { act: 1 } });
    const after = save({ version: 3, state: { act: 1 } });
    let reads = 0;
    server.use(...playHandlers({ save: before }));
    server.use(
      http.get("/api/saves/:id/play-state", async () => {
        reads += 1;
        if (reads > 1) await gate.promise;
        return HttpResponse.json({
          save: reads > 1 ? after : before,
          events: [],
          active_turn: null,
        });
      }),
      http.post(TURNS_ROUTE, () =>
        sse([
          frame("done", {
            turn_id: "t",
            status: "completed",
            save: after,
            text: "",
            retryable: false,
            failure: null,
          }),
        ]),
      ),
    );
    const client = renderPlay();
    await screen.findByRole("heading", { name: "公司食堂" });
    fireEvent.click(button("明确表达我的边界"));
    await screen.findByText("已存档 · 3");
    await waitFor(() => expect(composer().disabled).toBe(false));
    fireEvent.change(composer(), { target: { value: "新写的草稿" } });
    gate.resolve();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(composer().value).toBe("新写的草稿");
  });
  it("streams a reply, holding the idempotency key until it resolves", async () => {
    const gate = deferred();
    const before = save({ version: 2, state: { act: 1 } });
    const after = save({ version: 3, state: { act: 2, credit: 66 } });
    let current = before;
    let body: TurnInput | undefined;

    server.use(
      ...playHandlers({ save: () => current }),
      http.post(TURNS_ROUTE, async ({ request }) => {
        body = (await request.json()) as TurnInput;
        return sse(
          [frame("status", { text: "李姐正在核对材料…" })],
          gate.promise,
          [
            frame("done", {
              status: "completed",
              retryable: false,
              failure: null,
              text: "李姐点了点头。",
              save: after,
              turn_id: "turn-2",
            } satisfies Result),
          ],
        );
      }),
    );
    renderPlay();

    await screen.findByRole("textbox", { name: "对角色说的话" });
    const input = composer();
    fireEvent.change(input, {
      target: { value: "材料已经提交，请审核采购。" },
    });
    fireEvent.click(button("发送"));

    // Mid-stream: the status frame is on screen and the key is stored.
    expect(await screen.findByText("李姐正在核对材料…")).toBeTruthy();
    expect(body).toMatchObject({
      version: 2,
      npc: "sun",
      action: "speak",
      text: "材料已经提交，请审核采购。",
    });
    // The key kept for recovery must be the very one sent to the API.
    expect(body?.request_id).toMatch(UUID_V4);
    expect(storedRequestId()).toBe(body?.request_id);
    expect(button("明确表达我的边界").disabled).toBe(true);
    expect(screen.queryByRole("button", { name: RECOVER })).toBeNull();

    gate.resolve();
    // The backend has persisted the turn by the time it emits `done`, so the
    // refetch that refresh() triggers reads the new save.
    current = after;

    await waitFor(() => expect(storedRequestId()).toBeNull());
    await screen.findByRole("heading", { name: "财务窗口" });
    expect(screen.getByText(/已存档 · 3/)).toBeTruthy();
    expect(input.value).toBe("");
    expect(screen.queryByText("李姐正在核对材料…")).toBeNull();
  });

  it("clears the pending key when the turn request itself is rejected", async () => {
    let body: TurnInput | undefined;
    server.use(
      ...playHandlers({ save: save({ version: 7 }) }),
      http.post(TURNS_ROUTE, async ({ request }) => {
        body = (await request.json()) as TurnInput;
        return HttpResponse.json(
          apiError("存档版本已过期，请刷新后重试。", {
            code: "version_conflict",
          }),
          { status: 409 },
        );
      }),
    );
    renderPlay();

    fireEvent.click(
      await screen.findByRole("button", { name: "当众质问孙淼" }),
    );

    expect(await alertText()).toBe("存档版本已过期，请刷新后重试。");
    // The POST carried a status, so the turn is known-failed, not in flight.
    expect(body?.request_id).toMatch(UUID_V4);
    expect(storedRequestId()).toBeNull();
    expect(screen.queryByRole("button", { name: RECOVER })).toBeNull();
  });

  it("keeps the pending key when the stream dies without a result", async () => {
    let body: TurnInput | undefined;
    server.use(
      ...playHandlers({ save: save() }),
      http.post(TURNS_ROUTE, async ({ request }) => {
        body = (await request.json()) as TurnInput;
        return sse([frame("status", { text: "正在提交…" })]);
      }),
    );
    renderPlay();

    fireEvent.click(
      await screen.findByRole("button", { name: "私信祝福王会计" }),
    );

    expect(await alertText()).toBe("连接中断，请恢复回合结果。");
    // A plain Error has no status, so the turn may still be running server-side
    // and the key that was sent must survive for a later recovery.
    expect(storedRequestId()).toBe(body?.request_id);
    expect(storedRequestId()).toMatch(UUID_V4);
    expect(screen.getByRole("button", { name: RECOVER })).toBeTruthy();
  });
});

describe("Play: scene rendering", () => {
  it("reports a save it cannot load instead of rendering a broken scene", async () => {
    server.use(
      http.get("/api/story", () => HttpResponse.json(story)),
      http.get("/api/saves/:id/events", () => HttpResponse.json([])),
      http.get("/api/auth/me", () =>
        HttpResponse.json({ id: "test-user", name: "试玩者", can_play: true }),
      ),
      http.get("/api/saves/:id/play-state", () =>
        // The constant the API's 500 handler renders. It deliberately does not
        // name the dependency that failed -- an exception's own text must not
        // reach a client -- so this is the most a browser can ever learn.
        HttpResponse.json(
          apiError("服务器内部错误，请稍后重试。", { code: "internal_error" }),
          { status: 500 },
        ),
      ),
    );
    renderPlay();

    expect(await alertText()).toBe("服务器内部错误，请稍后重试。");
    expect(screen.getByRole("link", { name: "返回首页" })).toBeTruthy();
  });

  it("reports a missing act instead of dereferencing undefined scene data", async () => {
    server.use(
      ...playHandlers({
        save: save({ state: { act: 3 } }),
        story: { ...story, acts: story.acts.slice(0, 2) },
      }),
    );
    renderPlay();

    expect(await alertText()).toBe("回复格式无效，请恢复回合结果。");
  });

  it("promotes only the current interlocutor's reply for the current act", async () => {
    const events: GameEvent[] = [olderSunReply, sunReply];
    server.use(...playHandlers({ save: save({ state: { act: 1 } }), events }));
    renderPlay();

    await screen.findByRole("heading", { name: "公司食堂" });
    expect(inConversation(screen.queryAllByText(sunReply.text))).toHaveLength(
      1,
    );
    // The act-0 reply is still in the history drawer, but not in the dialogue.
    expect(
      inConversation(screen.queryAllByText(olderSunReply.text)),
    ).toHaveLength(0);
  });

  it("switches interlocutor from the phone drawer and closes it", async () => {
    server.use(...playHandlers({ save: save({ state: { act: 1 } }) }));
    renderPlay();

    await screen.findByRole("heading", { name: "公司食堂" });
    expect(drawer().open).toBe(false);

    fireEvent.click(button("手机"));
    expect(drawer().open).toBe(true);

    // jsdom computes this button's name without the separating space a real
    // browser gets from the drawer's flex-column CSS ("李姐财务会计" vs
    // "李姐 财务会计"), so anchor on the name instead of matching it exactly.
    fireEvent.click(screen.getByRole("button", { name: /^李姐/ }));
    expect(drawer().open).toBe(false);
    expect(screen.getAllByText("财务会计").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "李姐" })).toBeTruthy();
    expect(screen.getByAltText("李姐立绘")).toBeTruthy();
    expect(screen.getByText("“有什么事情，我们一项一项说。”")).toBeTruthy();
  });

  it("closes the drawer on the native cancel event", async () => {
    server.use(...playHandlers({ save: save({ state: { act: 1 } }) }));
    renderPlay();

    await screen.findByRole("heading", { name: "公司食堂" });
    fireEvent.click(button("锦囊"));
    expect(drawer().open).toBe(true);
    expect(screen.getByText(/先确认事实/)).toBeTruthy();

    fireEvent(drawer(), new Event("cancel"));
    expect(drawer().open).toBe(false);
    expect(drawer().open).toBe(false);
  });

  it("shows the ending, with the epilogue text once it exists", async () => {
    const ending = save({
      version: 9,
      state: { act: 4, ending: "保持职业关系和边界" },
    });
    server.use(...playHandlers({ save: ending, events: [epilogueEvent] }));
    renderPlay();

    expect(
      await screen.findByRole("heading", { name: "保持职业关系和边界" }),
    ).toBeTruthy();
    expect(screen.getByText(epilogueEvent.text)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "生成故事回顾" })).toBeNull();
    expect(screen.getByRole("link", { name: /回看我的故事/ })).toBeTruthy();
  });

  it("offers to generate the epilogue when an ending has none yet", async () => {
    server.use(
      ...playHandlers({
        save: save({ version: 9, state: { act: 4, ending: "选择离开" } }),
      }),
    );
    renderPlay();

    expect(
      await screen.findByRole("heading", { name: "选择离开" }),
    ).toBeTruthy();
    expect(
      screen.getByText("故事结局已保存。你可以选择生成回顾，尝试另一种回应。"),
    ).toBeTruthy();
    expect(button("生成故事回顾").disabled).toBe(false);
  });
});

it("does not show logout while playing", async () => {
  server.use(...playHandlers({ save: save() }));
  renderPlay();
  await screen.findByRole("main");
  expect(screen.queryByRole("button", { name: "退出登录" })).toBeNull();
});
