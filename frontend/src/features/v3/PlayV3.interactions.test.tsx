import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { server } from "../../testing/server";
import { save, sunReply } from "../../testing/fixtures";
import type { PlayState, Story, TurnInput } from "../../types";
import { readDraft, writeDraft } from "../game/drafts";
import { PlayV3 } from "./PlayV3";
import type { Option, StateV3 } from "./Work";
import authored from "../../testing/story-v3.json";
const ctrl = vi.hoisted(() => ({
  submit: vi.fn(),
  recover: vi.fn(),
  busy: false,
  blocked: false,
  aiBlocked: false,
  pending: null as string | null,
  status: "",
  error: "",
  completed: undefined as ((input: Partial<TurnInput>) => void) | undefined,
}));
vi.mock("../game/useTurnController", () => ({
  playKey: (userId: string, saveId: string) => ["play", userId, saveId],
  useTurnController: (
    _u: unknown,
    _s: unknown,
    _r: unknown,
    complete: typeof ctrl.completed,
  ) => {
    ctrl.completed = complete;
    return ctrl;
  },
}));
const state = (): StateV3 => ({
  ...save().state,
  story_version: 3,
  content_revision: 2,
  node: "act_1",
  tick: 0,
  rumination: 25,
  pressure: 25,
  partner_choice: null,
  exit_draft: null,
  outcome: null,
  quiet_turns: 0,
});
const option = (
  action: Option["action"],
  over: Partial<Option> = {},
): Option => ({
  action,
  label: action,
  enabled: true,
  completed: false,
  requires_confirmation: false,
  reason: "",
  effect: "可见影响",
  ...over,
});
const story = () =>
  ({
    ...authored,
    acts: authored.acts.map((a) => ({ ...a, choices: [], interlude: null })),
    scenes: {},
  }) as Story;
const play = (): PlayState => ({
  save: { ...save(), story_version: 3, state: state() },
  events: [],
  active_turn: null,
  available_actions: [option("boundary"), option("next")],
  ai: { available: true, reason: null },
  proposal: null,
});
function mount(p = play(), s = story()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrap = (next: PlayState) => (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Routes>
          <Route
            path="/"
            element={<PlayV3 userId="test-user" play={next} story={s} />}
          />
          <Route path="/saves" element={<h1>存档列表入口</h1>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
  return render(wrap(p));
  // Each test uses ordinary rerender when testing a new server state.
}
// Kept outside render helpers so no application hook is replaced other than the turn transport.

beforeEach(() => {
  Object.assign(ctrl, {
    busy: false,
    blocked: false,
    aiBlocked: false,
    pending: null,
    status: "",
    error: "",
  });
  ctrl.submit.mockReset();
  ctrl.recover.mockReset();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  server.use(
    http.post("/api/saves/save-1/reading", () =>
      HttpResponse.json({ ok: true }),
    ),
    http.get("/api/saves/save-1/events", () => HttpResponse.json([])),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("keeps scene, private and group drafts separate and clears only the matching successful expression", async () => {
  const p = play();
  p.events = [
    { ...sunReply, channel: "dm" },
    { ...sunReply, id: "g", channel: "group", text: "群记录" },
  ];
  mount(p);
  fireEvent.change(screen.getByLabelText("自由表达"), {
    target: { value: "现场草稿" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  expect(ctrl.submit).toHaveBeenLastCalledWith(
    p.save,
    "speak",
    "现场草稿",
    "sun",
    expect.objectContaining({ channel: "scene", target: "sun" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "boundary" }));
  expect(readDraft("test-user", p.save.id, "sun", "scene:sun").text).toBe(
    "现场草稿",
  );
  fireEvent.click(screen.getByRole("button", { name: "我的手机" }));
  fireEvent.click(screen.getByRole("button", { name: /孙淼 · 未读/ }));
  const dm = screen.getByRole("dialog");
  fireEvent.change(within(dm).getByLabelText("自由表达"), {
    target: { value: "私聊草稿" },
  });
  fireEvent.click(within(dm).getByRole("button", { name: "发送" }));
  expect(ctrl.submit).toHaveBeenLastCalledWith(
    p.save,
    "speak",
    "私聊草稿",
    "sun",
    expect.objectContaining({ channel: "dm" }),
  );
  act(() =>
    ctrl.completed?.({
      action: "speak",
      text: "过时文本",
      npc: "sun",
      channel: "dm",
    }),
  );
  expect(readDraft("test-user", p.save.id, "sun", "dm:sun").text).toBe(
    "私聊草稿",
  );
  act(() => ctrl.completed?.({ action: "boundary" }));
  act(() =>
    ctrl.completed?.({
      action: "speak",
      text: "私聊草稿",
      npc: "sun",
      channel: "dm",
    }),
  );
  expect(readDraft("test-user", p.save.id, "sun", "dm:sun").text).toBe("");
  fireEvent.click(screen.getByText("← 会话列表"));
  fireEvent.click(screen.getByRole("button", { name: /项目工作群 · 未读/ }));
  expect(await screen.findByText("群内只发布已核实的工作事实。")).toBeTruthy();
  fireEvent.change(within(dm).getByLabelText("自由表达"), {
    target: { value: "核查记录" },
  });
  fireEvent.click(within(dm).getByRole("button", { name: "发送" }));
  expect(ctrl.submit).toHaveBeenLastCalledWith(
    p.save,
    "speak",
    "核查记录",
    "sun",
    expect.objectContaining({ channel: "group", target: "group" }),
  );
  act(() =>
    ctrl.completed?.({ action: "speak", text: "核查记录", channel: "group" }),
  );
  expect(readDraft("test-user", p.save.id, "sun", "group:group").text).toBe("");
  fireEvent.click(screen.getByLabelText("关闭面板"));
  expect(screen.getByLabelText<HTMLTextAreaElement>("自由表达").value).toBe(
    "现场草稿",
  );
  act(() => ctrl.completed?.({ action: "speak", text: "现场草稿" }));
  expect(readDraft("test-user", p.save.id, "sun", "scene:sun").text).toBe("");
});
it("keeps deterministic actions available without AI and recovers an accepted turn", () => {
  const p = play();
  p.ai = { available: false, reason: "预算不足" };
  ctrl.pending = "request";
  mount(p);
  fireEvent.change(screen.getByLabelText("自由表达"), {
    target: { value: "待发送" },
  });
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "发送" }).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "boundary" }));
  expect(ctrl.submit).toHaveBeenCalledWith(p.save, "boundary", "", "sun", {
    channel: "scene",
    target: "sun",
  });
  fireEvent.click(screen.getByText("恢复回合结果"));
  expect(ctrl.recover).toHaveBeenCalledOnce();
});
it("does not attach a previous act's source reference to a new expression", () => {
  writeDraft(
    "test-user",
    "save-1",
    "sun",
    { text: "旧幕草稿", act: 0, discussion_id: "old", perspective_id: "card" },
    "scene:sun",
  );
  mount();
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  expect(ctrl.submit.mock.lastCall?.[4]).toEqual({
    channel: "scene",
    target: "sun",
  });
});
it("persists a reading position and retries a failed save without submitting a turn", async () => {
  localStorage.setItem("reduced-motion:test-user", "true");
  let calls = 0;
  server.use(
    http.post("/api/saves/save-1/reading", async ({ request }) => {
      expect(await request.json()).toEqual({ key: "act_1", position: 1 });
      return ++calls === 1
        ? new HttpResponse(null, { status: 503 })
        : HttpResponse.json({ ok: true });
    }),
  );
  const s = story();
  s.scenes = {
    act_1: [
      {
        id: "line",
        speaker: "li",
        text: "先读场景",
        location: "新场景",
        background: "/assets/bg-office.png",
      },
    ],
  };
  mount(play(), s);
  fireEvent.click(screen.getByText("先读场景"));
  expect(await screen.findByText("阅读位置尚未保存，请重试。")).toBeTruthy();
  fireEvent.click(screen.getByText("重试保存阅读位置"));
  await waitFor(() =>
    expect(screen.queryByText("重试保存阅读位置")).toBeNull(),
  );
  expect(ctrl.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("减少动态"));
  expect(localStorage.getItem("reduced-motion:test-user")).toBe("false");
});
it("does not rewind reading when an earlier duplicate request finishes late", async () => {
  localStorage.setItem("reduced-motion:test-user", "true");
  const replies: (() => void)[] = [];
  server.use(
    http.post("/api/saves/save-1/reading", async () => {
      await new Promise<void>((resolve) => replies.push(resolve));
      return HttpResponse.json({ act_1: 2 });
    }),
  );
  const s = story();
  s.scenes = {
    act_1: ["第一句", "第二句", "第三句"].map((text, i) => ({
      id: String(i),
      speaker: "li",
      text,
    })),
  };
  mount(play(), s);
  fireEvent.click(screen.getByText("第一句"));
  fireEvent.click(screen.getByText("第一句"));
  await waitFor(() => expect(replies).toHaveLength(2));
  await act(async () => {
    replies[0]!();
    await Promise.resolve();
  });
  fireEvent.click(await screen.findByText("第二句"));
  await waitFor(() => expect(replies).toHaveLength(3));
  await act(async () => {
    replies[2]!();
    await Promise.resolve();
  });
  await screen.findByText("第三句");
  await act(async () => {
    replies[1]!();
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.queryByText("第二句")).toBeNull());
  expect(screen.getByText("第三句")).toBeTruthy();
});
it("waits for the matching scene version and honors storage restrictions", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  const p = play();
  p.performance_version = p.save.version - 1;
  mount(p);
  expect(screen.getByText("正在切换场景…")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("减少动态"));
  expect(ctrl.submit).not.toHaveBeenCalled();
});
it("opens authored phone and work entries without pretending an action occurred", () => {
  const s = story();
  s.acts[1]!.choices = [
    {
      action: "contact_wang",
      label: "打开王会计",
      entry: "phone",
      target: "wang",
    },
    { action: "submit_purchase", label: "打开采购", entry: "work" },
    { action: "boundary", label: "明确边界" },
    { action: "deliver", label: "尚未解锁" },
  ];
  mount(play(), s);
  expect(screen.queryByText("尚未解锁")).toBeNull();
  fireEvent.click(screen.getByText("打开王会计"));
  expect(screen.getByRole("heading", { name: "王会计" })).toBeTruthy();
  fireEvent.click(screen.getByLabelText("关闭面板"));
  fireEvent.click(screen.getByText("打开采购"));
  expect(screen.getByLabelText("实验用途")).toBeTruthy();
  expect(ctrl.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("关闭面板"));
  fireEvent.click(screen.getByText("明确边界"));
  expect(ctrl.submit.mock.lastCall?.[1]).toBe("boundary");
});
it.each(["act_1_invitation", "act_1_farewell", "act_3_follow_up"])(
  "limits the stage choices at %s",
  (node) => {
    const p = play();
    p.save.state = { ...state(), node, quiet_turns: 3 };
    p.available_actions = [
      option("boundary"),
      option("attend_farewell"),
      option("contact_wang"),
      option("follow_up"),
      option("close_story"),
    ];
    mount(p);
    expect(screen.queryByRole("button", { name: "boundary" })).toBeNull();
    if (node === "act_3_follow_up") {
      fireEvent.click(screen.getByText("这次不参加，工作资料请照常发我。"));
      expect(ctrl.submit.mock.lastCall?.[4]).toMatchObject({
        params: { boundary_response: "decline" },
      });
    } else
      expect(
        screen.getByRole("button", {
          name:
            node === "act_1_invitation" ? "attend_farewell" : "contact_wang",
        }),
      ).toBeTruthy();
    fireEvent.click(screen.getByText("按当前进度结束本局"));
    expect(ctrl.submit.mock.lastCall?.[1]).toBe("close_story");
    expect(screen.getByText(/这几轮没有新增进展/)).toBeTruthy();
  },
);
it("shows the interlude before advancement; closing it leaves the story unchanged", () => {
  const s = story();
  s.acts[1]!.interlude = {
    image: "/assets/bg-home.png",
    location: "家",
    time: "晚上",
    text: "私人独白",
  };
  mount(play(), s);
  fireEvent.click(screen.getByText("带着当前进度进入下一幕 →"));
  expect(screen.getByText("私人独白")).toBeTruthy();
  expect(ctrl.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("返回当前剧情"));
  fireEvent.click(screen.getByText("带着当前进度进入下一幕 →"));
  fireEvent.click(screen.getByText("进入下一幕"));
  expect(ctrl.submit.mock.lastCall?.[1]).toBe("next");
});
it("proposes a major decision and preserves the original application until confirmation", () => {
  const p = play();
  p.available_actions = [
    option("public_confront", { requires_confirmation: true }),
  ];
  mount(p);
  fireEvent.click(screen.getByText("public_confront"));
  expect(ctrl.submit).toHaveBeenCalledWith(p.save, "propose", "", "sun", {
    channel: "scene",
    target: "sun",
    proposed_action: "public_confront",
  });
});
it.each(["confirm", "cancel", "escape"])(
  "handles a persisted proposal: %s",
  (mode) => {
    const p = play();
    p.proposal = {
      id: "proposal",
      action: "submit_exit",
      label: "确认退出",
      effect: "将开始申请",
      version: p.save.version,
    };
    p.save.state = {
      ...state(),
      exit_draft: {
        kind: "transfer",
        reason: "转到新项目",
        event_id: "draft",
        submitted: false,
      },
    };
    p.available_actions = [
      option("submit_exit", { target: "li", requires_confirmation: true }),
    ];
    mount(p);
    expect(screen.getByText("转到新项目")).toBeTruthy();
    if (mode === "confirm") {
      fireEvent.click(screen.getByText("确认并提交"));
      expect(ctrl.submit).toHaveBeenCalledWith(
        p.save,
        "submit_exit",
        "",
        "li",
        { channel: "work", target: "li", proposal_id: "proposal" },
      );
    } else {
      if (mode === "cancel") fireEvent.click(screen.getByText("暂不执行"));
      else
        fireEvent(
          screen.getByRole("alertdialog"),
          new Event("cancel", { bubbles: true, cancelable: true }),
        );
      expect(ctrl.submit.mock.lastCall?.[1]).toBe("cancel_proposal");
    }
  },
);
it("never confirms or cancels a proposal while another turn is active", () => {
  ctrl.busy = true;
  const p = play();
  p.proposal = {
    id: "p",
    action: "public_confront",
    label: "质问",
    effect: "影响",
    version: 2,
  };
  mount(p);
  fireEvent.click(screen.getByText("确认并提交"));
  fireEvent(
    screen.getByRole("alertdialog"),
    new Event("cancel", { bubbles: true, cancelable: true }),
  );
  expect(ctrl.submit).not.toHaveBeenCalled();
});
it("shows confirmed conversation records and retries read failures", async () => {
  let fail = true;
  server.use(
    http.get("/api/saves/save-1/events", ({ request }) => {
      expect(new URL(request.url).searchParams.get("target")).toBe("li");
      return fail
        ? new HttpResponse(null, { status: 400 })
        : HttpResponse.json([
            { ...sunReply, npc: "li", speaker: "system", text: "登记材料" },
            {
              ...sunReply,
              id: "2",
              npc: "li",
              kind: "npc",
              speaker: "li",
              text: "李姐回复",
            },
            {
              ...sunReply,
              id: "3",
              npc: "li",
              kind: "player",
              speaker: "player",
              text: "玩家文本",
            },
          ]);
    }),
  );
  const p = play();
  p.contacts = { li: { unread: true, count: 3, preview: "材料审核" } };
  mount(p);
  fireEvent.click(screen.getByRole("button", { name: "我的手机" }));
  fireEvent.click(screen.getByRole("button", { name: /李姐 · 未读/ }));
  await screen.findByText("会话读取失败。");
  fail = false;
  fireEvent.click(screen.getByText("重试读取"));
  expect(await screen.findByText("登记材料", { exact: false })).toBeTruthy();
  expect(screen.getByText("李姐回复", { exact: false })).toBeTruthy();
  expect(screen.getByText("玩家文本", { exact: false })).toBeTruthy();
});
it("routes public clarification through a confirmation card in the group channel", () => {
  const p = play();
  p.available_actions = [
    option("clarify", { requires_confirmation: true }),
    option("review_clarification"),
    option("trace_rumor"),
  ];
  mount(p);
  fireEvent.click(screen.getByRole("button", { name: "我的手机" }));
  fireEvent.click(screen.getByRole("button", { name: /项目工作群/ }));
  fireEvent.click(screen.getByText("clarify"));
  expect(ctrl.submit.mock.lastCall?.[4]).toEqual({
    channel: "group",
    target: "group",
    proposed_action: "clarify",
  });
});
it("keeps logout errors local and clears only this identity's drafts after retry", async () => {
  let fail = true;
  server.use(
    http.post("/api/auth/logout", () =>
      fail
        ? new HttpResponse(null, { status: 400 })
        : HttpResponse.json({ ok: true }),
    ),
  );
  const p = play();
  mount(p);
  fireEvent.change(screen.getByLabelText("自由表达"), {
    target: { value: "待保留" },
  });
  writeDraft(
    "another-user",
    "save-1",
    "sun",
    { text: "他人草稿", act: 1 },
    "scene:sun",
  );
  fireEvent.click(screen.getByText("退出登录"));
  await screen.findByText("重试退出");
  expect(readDraft("test-user", "save-1", "sun", "scene:sun").text).toBe(
    "待保留",
  );
  fail = false;
  fireEvent.click(screen.getByText("重试退出"));
  await waitFor(() =>
    expect(readDraft("test-user", "save-1", "sun", "scene:sun").text).toBe(""),
  );
  expect(readDraft("another-user", "save-1", "sun", "scene:sun").text).toBe(
    "他人草稿",
  );
});
it("copies a discussion card into the scene draft without telling any character", async () => {
  server.use(
    http.post("/api/saves/save-1/jobs", () =>
      HttpResponse.json({
        id: "job",
        kind: "discussion",
        status: "completed",
        result: {
          cards: [{ id: "card", view: "建议", expression: "请先征求我的意见" }],
        },
      }),
    ),
  );
  const p = play();
  mount(p);
  fireEvent.click(screen.getByRole("button", { name: "知乎众议" }));
  fireEvent.click(await screen.findByText("带入输入框，再由我修改"));
  expect(screen.getByLabelText<HTMLTextAreaElement>("自由表达").value).toBe(
    "请先征求我的意见",
  );
  expect(ctrl.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  expect(ctrl.submit.mock.lastCall?.[4]).toMatchObject({
    discussion_id: "job",
    perspective_id: "card",
  });
});
it("paginates older messages using the first event cursor", async () => {
  const seen: string[] = [];
  server.use(
    http.get("/api/saves/save-1/events", ({ request }) => {
      const url = new URL(request.url);
      seen.push(url.searchParams.get("before") ?? "");
      return HttpResponse.json(
        url.searchParams.has("before")
          ? [{ ...sunReply, id: "old", text: "最早记录" }]
          : Array.from({ length: 100 }, (_, i) => ({
              ...sunReply,
              id: `event-${i}`,
              text: `消息 ${i}`,
            })),
      );
    }),
  );
  mount();
  fireEvent.click(screen.getByRole("button", { name: "我的手机" }));
  fireEvent.click(screen.getByRole("button", { name: /孙淼.*打开会话/ }));
  fireEvent.click(await screen.findByText("加载更早消息"));
  await screen.findByText("最早记录", { exact: false });
  expect(seen).toEqual(["", "event-0"]);
});

it("opens relationship evidence and historical cards without altering story facts", async () => {
  server.use(
    http.get("/api/saves/save-1/jobs", () =>
      HttpResponse.json([
        {
          id: "historical-card",
          kind: "discussion",
          status: "completed",
          act: 1,
          result: { cards: [{ id: "card", expression: "先问清具体要求" }] },
        },
      ]),
    ),
    http.get("/api/saves/save-1/snapshots", () => HttpResponse.json([])),
  );
  const p = play();
  p.save.state = { ...state(), work: { purchase: "returned" } };
  p.events = [
    {
      ...sunReply,
      channel: "scene",
      scene: "act_1",
      speaker: "sun",
      text: "这就是已确认的回复",
    },
    {
      ...sunReply,
      id: "proposal-event",
      channel: "scene",
      action: "propose",
      text: "不应显示的提议文本",
    },
  ];
  mount(p);
  expect(screen.getByText("这就是已确认的回复")).toBeTruthy();
  expect(screen.queryByText("不应显示的提议文本")).toBeNull();
  expect(
    screen.getByRole("button", { name: "工作系统 · 待处理" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关系图" }));
  expect(screen.getByText("选择一个人物，查看当前关系及其依据。")).toBeTruthy();
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: true }));
  fireEvent.click(screen.getByText("完整记录"));
  fireEvent.click(await screen.findByText("带入草稿（可编辑）"));
  expect(screen.getByLabelText<HTMLTextAreaElement>("自由表达").value).toBe(
    "先问清具体要求",
  );
  expect(ctrl.submit).not.toHaveBeenCalled();
});
it("uses the persisted ending instead of an active scene", async () => {
  server.use(
    http.post("/api/saves/save-1/jobs", () =>
      HttpResponse.json({
        id: "ending",
        kind: "ending",
        status: "completed",
        result: { text: "已保存的结局正文" },
      }),
    ),
  );
  const p = play();
  p.save.state = {
    ...state(),
    ending: "尚未破局",
    outcome: {
      id: "unresolved",
      title: "尚未破局",
      achievements: [],
      unresolved: [],
      key_event_ids: [],
    },
  };
  mount(p);
  await screen.findByText("已保存的结局正文");
  expect(screen.queryByLabelText("自由表达")).toBeNull();
});

it("returns to saves without logging out, submitting a turn, or clearing a draft", async () => {
  const logout = vi.fn();
  server.use(
    http.post("/api/auth/logout", () => {
      logout();
      return HttpResponse.json({ ok: true });
    }),
  );
  const p = play();
  mount(p);
  fireEvent.change(screen.getByLabelText("自由表达"), {
    target: { value: "稍后继续编辑" },
  });
  fireEvent.click(screen.getByRole("button", { name: "返回存档" }));
  await screen.findByRole("heading", { name: "存档列表入口" });
  expect(readDraft("test-user", p.save.id, "sun", "scene:sun").text).toBe(
    "稍后继续编辑",
  );
  expect(logout).not.toHaveBeenCalled();
  expect(ctrl.submit).not.toHaveBeenCalled();
  expect(p.save.state.ending).toBeNull();
});

it.each(["busy", "pending", "blocked"] as const)(
  "prevents leaving while the controller is %s",
  (mode) => {
    if (mode === "pending") ctrl.pending = "original-request";
    else ctrl[mode] = true;
    mount();
    const leave = screen.getByRole("button", {
      name: "返回存档",
    });
    expect(leave.hasAttribute("disabled")).toBe(true);
    fireEvent.click(leave);
    expect(screen.queryByText("存档列表入口")).toBeNull();
  },
);

it("keeps all four meter values and their labels", () => {
  const p = play();
  mount(p);
  const meters = screen.getAllByRole("meter");
  expect(meters.map((m) => m.getAttribute("aria-label"))).toEqual([
    "舆论温度",
    "专业信用",
    "内耗",
    "工作压力",
  ]);
  expect(meters.map((m) => Number(m.getAttribute("value")))).toEqual([
    p.save.state.heat,
    p.save.state.credit,
    25,
    25,
  ]);
});
