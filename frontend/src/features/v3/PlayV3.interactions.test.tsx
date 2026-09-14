import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { server } from "../../testing/server";
import { save, sunReply } from "../../testing/fixtures";
import type { PlayState, Story, TurnInput } from "../../types";
import {
  readDraft,
  readFormDraft,
  writeDraft,
  writeFormDraft,
} from "../game/drafts";
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
  saved: false,
  savedStatus: undefined as string | undefined,
  savedEffects: undefined as string[] | undefined,
  status: "",
  error: "",
  completed: undefined as ((input: Partial<TurnInput>) => void) | undefined,
}));
vi.mock("../game/useTurnController", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../game/useTurnController")>()),
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
        <PlayV3 userId="test-user" play={next} story={s} />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const rendered = render(wrap(p));
  return {
    ...rendered,
    rerenderPlay: (next: PlayState) => rendered.rerender(wrap(next)),
  };
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
    savedStatus: undefined,
    savedEffects: undefined,
    error: "",
  });
  ctrl.submit.mockReset();
  ctrl.recover.mockReset();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
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
  fireEvent.click(screen.getByRole("button", { name: "返回会话列表" }));
  fireEvent.click(screen.getByRole("button", { name: /研发部工作群 · 未读/ }));
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
  fireEvent.click(screen.getByRole("button", { name: "返回会话列表" }));
  fireEvent.click(screen.getByLabelText("关闭面板"));
  expect(screen.getByLabelText<HTMLTextAreaElement>("自由表达").value).toBe(
    "现场草稿",
  );
  act(() => ctrl.completed?.({ action: "speak", text: "现场草稿" }));
  expect(readDraft("test-user", p.save.id, "sun", "scene:sun").text).toBe("");
});
it("keeps deterministic actions available without AI and recovers an accepted turn", () => {
  const p = play();
  p.ai = { available: false, reason: "模型未配置" };
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
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
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
  expect(screen.queryByLabelText("减少动态")).toBeNull();
});
it("waits for the matching scene version and honors storage restrictions", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("denied");
  });
  const p = play();
  p.performance_version = p.save.version - 1;
  mount(p);
  expect(screen.getByText("正在切换场景…")).toBeTruthy();
  expect(screen.queryByLabelText("减少动态")).toBeNull();
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
  fireEvent.click(screen.getByRole("button", { name: "返回会话列表" }));
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
  fireEvent.click(screen.getByRole("button", { name: /研发部工作群/ }));
  fireEvent.click(screen.getByText("clarify"));
  expect(ctrl.submit.mock.lastCall?.[4]).toEqual({
    channel: "group",
    target: "group",
    proposed_action: "clarify",
  });
});
it("does not show logout while playing", () => {
  mount(play());
  expect(
    screen.getByRole("button", { name: "返回首页" }).closest("header"),
  ).not.toBeNull();
  expect(
    within(screen.getByRole("navigation")).queryByRole("button", {
      name: "返回首页",
    }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "退出登录" })).toBeNull();
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
  fireEvent.click(screen.getByRole("button", { name: /^孙淼/ }));
  fireEvent.click(await screen.findByText("加载更早消息"));
  await screen.findByText("最早记录", { exact: false });
  expect(seen).toEqual(["", "event-0"]);
});

it("opens relationship evidence without altering story facts", () => {
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
  expect(screen.queryByRole("button", { name: "完整记录" })).toBeNull();
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
  expect(
    screen.queryByRole("navigation", { name: "故事工具与账户" }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "返回首页" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "我的手机" })).toBeNull();
});

it.each(["busy", "pending"] as const)(
  "prevents leaving during %s without discarding the draft",
  (phase) => {
    if (phase === "busy") ctrl.busy = true;
    else ctrl.pending = "unfinished-request";
    mount();
    fireEvent.change(screen.getByLabelText("自由表达"), {
      target: { value: "保留我的草稿" },
    });
    const leave = screen.getByRole<HTMLButtonElement>("button", {
      name: "返回首页",
    });
    expect(leave.disabled).toBe(true);
    fireEvent.click(leave);
    expect(readDraft("test-user", "save-1", "sun", "scene:sun").text).toBe(
      "保留我的草稿",
    );
    expect(ctrl.submit).not.toHaveBeenCalled();
  },
);
it("returns without logging out or clearing identity cache and drafts", () => {
  const client = new QueryClient();
  client.setQueryData(["user"], { id: "test-user" });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/play/save-1"]}>
        <Routes>
          <Route
            path="/play/:id"
            element={
              <PlayV3 userId="test-user" play={play()} story={story()} />
            }
          />
          <Route path="/" element={<h1>故事首页</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("自由表达"), {
    target: { value: "下次继续" },
  });
  fireEvent.click(screen.getByRole("button", { name: "返回首页" }));
  fireEvent.click(screen.getByRole("button", { name: "确认返回" }));
  expect(screen.getByRole("heading", { name: "故事首页" })).toBeTruthy();
  expect(client.getQueryData(["user"])).toEqual({ id: "test-user" });
  expect(readDraft("test-user", "save-1", "sun", "scene:sun").text).toBe(
    "下次继续",
  );
  expect(ctrl.submit).not.toHaveBeenCalled();
});

it("follows system motion changes and removes the retired stored override", () => {
  let update: (() => void) | undefined;
  const preference = {
    matches: false,
    addEventListener: vi.fn((_event: string, listener: () => void) => {
      update = listener;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => preference),
  );
  localStorage.setItem("reduced-motion:test-user", "true");
  const scene = story();
  scene.scenes = {
    act_1: [
      {
        id: "motion-line",
        speaker: "sun",
        text: "系统减少动态时立即显示这段完整台词。",
      },
    ],
  };
  const view = mount(play(), scene);
  expect(localStorage.getItem("reduced-motion:test-user")).toBeNull();
  expect(screen.queryByLabelText("减少动态")).toBeNull();
  act(() => {
    preference.matches = true;
    update?.();
  });
  expect(screen.getByText("系统减少动态时立即显示这段完整台词。")).toBeTruthy();
  view.unmount();
  expect(preference.removeEventListener).toHaveBeenCalledWith("change", update);
});

it("moves turn errors and recovery into the open panel without duplicating feedback or clearing drafts", () => {
  ctrl.error = "提交未完成，请检查安排。";
  ctrl.pending = "accepted-request";
  mount();
  fireEvent.change(screen.getByLabelText("自由表达"), {
    target: { value: "现场保留" },
  });
  fireEvent.click(screen.getByRole("button", { name: "我的手机" }));
  fireEvent.click(screen.getByRole("button", { name: /孙淼/ }));
  const panel = screen.getByRole("dialog");
  fireEvent.change(within(panel).getByLabelText("自由表达"), {
    target: { value: "私聊保留" },
  });
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(within(panel).getByRole("alert").textContent).toContain(ctrl.error);
  fireEvent.click(within(panel).getByRole("button", { name: "恢复回合结果" }));
  expect(ctrl.recover).toHaveBeenCalledOnce();
  expect(
    within(panel).getByLabelText<HTMLTextAreaElement>("自由表达").value,
  ).toBe("私聊保留");
  fireEvent.click(within(panel).getByRole("button", { name: "返回会话列表" }));
  fireEvent.click(within(panel).getByRole("button", { name: "关闭面板" }));
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.getByLabelText<HTMLTextAreaElement>("自由表达").value).toBe(
    "现场保留",
  );
});
it("focuses the decision title before a long confirmation and shows errors inside it", () => {
  const p = play();
  p.proposal = {
    id: "proposal",
    version: 2,
    action: "submit_exit",
    label: "确认退出申请",
    effect: "申请需要后续办理",
  };
  ctrl.error = "申请暂未提交";
  mount(p);
  const dialog = screen.getByRole("alertdialog");
  expect(document.activeElement).toBe(
    within(dialog).getByRole("heading", { name: "确认退出申请" }),
  );
  expect(within(dialog).getByRole("alert").textContent).toContain(ctrl.error);
  expect(screen.getAllByRole("alert")).toHaveLength(1);
});

it("labels the recipient before sending and offers an explicit contact switch", () => {
  mount();
  expect(screen.getByText("现场 · 对孙淼说")).toBeTruthy();
  expect(
    screen.getByLabelText("自由表达").getAttribute("aria-describedby"),
  ).toBe("scene-recipient");
  fireEvent.click(screen.getByRole("button", { name: "切换对话对象" }));
  fireEvent.click(screen.getByRole("button", { name: /张工/ }));
  expect(screen.getByText("私聊 · 张工")).toBeTruthy();
});

it("applies stored reading preferences and rejects invalid options", () => {
  writeFormDraft("test-user", "save-1", "reading-preferences", {
    size: "invalid",
    speed: "-1",
  });
  let view = mount();
  expect(
    view.container
      .querySelector("main")
      ?.style.getPropertyValue("--story-text-size"),
  ).toBe("18px");
  view.unmount();
  writeFormDraft("test-user", "save-1", "reading-preferences", {
    size: "23",
    speed: "0",
  });
  view = mount();
  expect(
    view.container
      .querySelector("main")
      ?.style.getPropertyValue("--story-text-size"),
  ).toBe("23px");
});

it("keeps the scene compact after editing without letting private input change its layout", () => {
  const view = mount();
  const root = view.container.querySelector("main")!;
  expect(root.dataset.composing).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "我的手机" }));
  fireEvent.click(screen.getByRole("button", { name: "孙淼" }));
  fireEvent.focus(
    within(screen.getByRole("dialog")).getByLabelText("自由表达"),
  );
  expect(root.dataset.composing).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "返回会话列表" }));
  fireEvent.click(screen.getByLabelText("关闭面板"));
  const input = screen.getByLabelText("自由表达");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "保留输入" } });
  fireEvent.blur(input);
  expect(root.dataset.composing).toBe("true");
  expect(screen.getByLabelText<HTMLTextAreaElement>("自由表达").value).toBe(
    "保留输入",
  );
});

it("shows minimal empty conversations without greeting messages or submitting a turn", async () => {
  server.use(http.get("/api/saves/:id/events", () => HttpResponse.json([])));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "我的手机" }));
  fireEvent.click(screen.getByRole("button", { name: "张工" }));
  const dialog = screen.getByRole("dialog");
  expect(await within(dialog).findByText("暂无聊天记录")).toBeTruthy();
  expect(within(dialog).queryByText(/当前情景/)).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "关闭面板" })).toBeNull();
  expect(within(dialog).queryByText(/坐吧，项目最近怎么样/)).toBeNull();
  expect(ctrl.submit).not.toHaveBeenCalled();
});

it("retains the authored final clothing and empty stage after reading and phone navigation", () => {
  const p = play();
  p.performance = [
    {
      id: "coat-end",
      speaker: "inner",
      text: "我需要想一想。",
      portraits: ["player-coat"],
    },
  ];
  p.performance_version = p.save.version;
  p.reading = { act_1: 1 };
  const view = mount(p);
  const portraits = () => view.container.querySelector('[class*="portraits"]')!;
  expect(portraits().querySelectorAll("img")).toHaveLength(1);
  expect(portraits().querySelector("img")!.src).toContain("player-coat-");
  fireEvent.click(screen.getByRole("button", { name: "我的手机" }));
  fireEvent.click(screen.getByRole("button", { name: "李姐" }));
  expect(portraits().querySelectorAll("img")).toHaveLength(1);
  expect(portraits().querySelector("img")!.src).toContain("player-coat-");
  view.rerenderPlay({
    ...p,
    performance: [{ ...p.performance[0]!, portraits: [] }],
  });
  expect(portraits().querySelectorAll("img")).toHaveLength(0);
});

it("keeps completed receipts only in full history and shows a compact save hint", () => {
  server.use(
    http.get("/api/saves/save-1/jobs", () => HttpResponse.json([])),
    http.get("/api/saves/save-1/snapshots", () => HttpResponse.json([])),
  );
  ctrl.saved = true;
  ctrl.savedStatus = "回合已完成，进度已保存。";
  ctrl.savedEffects = ["已保存之后的故事。"];
  const p = play();
  p.events = [
    {
      ...sunReply,
      id: "input",
      kind: "player",
      speaker: "player",
      action: "begin",
      channel: "scene",
    },
  ];
  mount(p);
  expect(screen.queryByText("最近一轮 · 已保存记录")).toBeNull();
  expect(screen.queryByText(ctrl.savedStatus)).toBeNull();
  expect(screen.queryByText("已保存")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "我的手机" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).queryByText("最近一轮 · 已保存记录")).toBeNull();
  expect(within(dialog).queryByText(ctrl.savedStatus)).toBeNull();
  expect(within(dialog).getByLabelText("操作反馈").textContent).toBe("");
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭面板" }));
  expect(screen.queryByRole("button", { name: "完整记录" })).toBeNull();
});

it.each(["appeased:act_1", "boundary:act_1", "farewell_requested"])(
  "hides the opening choices after persisted response %s",
  (flag) => {
    const p = play();
    const s = story();
    s.acts[1]!.choices = authored.acts[1]!
      .choices as Story["acts"][number]["choices"];
    p.available_actions = [
      option("appease"),
      option("boundary"),
      option("join_farewell"),
      option("next"),
    ];
    const view = mount(p, s);
    expect(
      screen.getByRole("button", { name: "没事，你们继续聊。" }),
    ).toBeTruthy();
    const chosen = {
      ...p,
      save: {
        ...p.save,
        version: p.save.version + 1,
        state: { ...p.save.state, flags: [...p.save.state.flags, flag] },
      },
    };
    view.rerenderPlay(chosen);
    for (const choice of s.acts[1]!.choices) {
      expect(screen.queryByRole("button", { name: choice.label })).toBeNull();
    }
    expect(
      screen.getByRole("button", { name: "带着当前进度进入下一幕 →" }),
    ).toBeTruthy();
  },
);

it.each([6, 7])(
  "enters act one directly from the final prologue line at reading position %i",
  (reading) => {
    const p = play();
    p.save.state = { ...state(), act: 0, node: "prologue" };
    p.save.scene_intro = "不应再次显示的序幕介绍";
    p.reading = { prologue: reading };
    p.performance = authored.scenes.prologue;
    p.available_actions = [option("begin")];
    const view = mount(p, { ...authored, scenes: {} } as Story);
    fireEvent.click(screen.getByRole("button", { name: /点击显示全文/ }));
    const enter = screen.getByRole("button", { name: /进入故事/ });
    fireEvent.click(enter);
    expect(ctrl.submit).toHaveBeenCalledExactlyOnceWith(
      p.save,
      "begin",
      "",
      "sun",
      expect.objectContaining({ channel: "scene", target: "sun" }),
    );
    expect(screen.queryByText(p.save.scene_intro)).toBeNull();
    expect(screen.getByText("进入故事")).toBeTruthy();
    ctrl.busy = true;
    view.rerenderPlay(p);
    expect(enter.hasAttribute("disabled")).toBe(true);
    fireEvent.click(enter);
    expect(ctrl.submit).toHaveBeenCalledTimes(1);
    ctrl.busy = false;
    ctrl.error = "请求失败，请重试。";
    view.rerenderPlay(p);
    expect(screen.getByText("进入故事")).toBeTruthy();
    expect(screen.queryByText(p.save.scene_intro)).toBeNull();
    ctrl.error = "";
    const next = play();
    next.save.version = p.save.version + 1;
    next.performance = authored.scenes.act_1;
    view.rerenderPlay(next);
    expect(screen.queryByText("进入故事")).toBeNull();
    expect(screen.getByText("旁白")).toBeTruthy();
    expect(view.container.querySelector("main")?.dataset.prologue).toBe(
      "false",
    );
  },
);

it("clears only the matching successful supplement draft", () => {
  const p = play();
  const fields = {
    note: "补充说明",
    mentions: "li,zhang",
    evidence: "quote,purpose",
    kind: "standard",
  };
  writeFormDraft("test-user", p.save.id, "supplement", fields);
  const view = mount(p);
  act(() =>
    ctrl.completed?.({
      action: "supplement",
      params: {
        supplement_note: "补充说明",
        mentions: ["li", "zhang"],
        evidence: ["quote", "purpose"],
      },
    }),
  );
  expect(readFormDraft("test-user", p.save.id, "supplement")?.note).toBe("");
  writeFormDraft("test-user", p.save.id, "supplement", {
    ...fields,
    note: "更新的草稿",
  });
  act(() =>
    ctrl.completed?.({
      action: "supplement",
      params: {
        supplement_note: "补充说明",
        mentions: ["li", "zhang"],
        evidence: ["quote", "purpose"],
      },
    }),
  );
  expect(readFormDraft("test-user", p.save.id, "supplement")?.note).toBe(
    "更新的草稿",
  );
  view.unmount();
});

it("restores the open phone and contact on remount, and remembers explicit dismissal", () => {
  let view = mount();
  fireEvent.click(screen.getByRole("button", { name: "我的手机" }));
  view.unmount();
  view = mount();
  expect(
    within(screen.getByRole("dialog")).getByRole("heading", { name: "通讯" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "孙淼" }));
  view.unmount();
  view = mount();
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "孙淼" })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "返回会话列表" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭面板" }));
  view.unmount();
  mount();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("isolates panel navigation by save and ignores invalid stored navigation", () => {
  const p = play();
  const view = mount(p);
  fireEvent.click(screen.getByRole("button", { name: "我的手机" }));
  const other = { ...p, save: { ...p.save, id: "another-save" } };
  view.rerenderPlay(other);
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerenderPlay(p);
  expect(
    within(screen.getByRole("dialog")).getByRole("heading", { name: "通讯" }),
  ).toBeTruthy();
  writeFormDraft("test-user", "another-save", "panel-navigation", {
    panel: "invalid",
    contact: "invalid",
  });
  view.rerenderPlay(other);
  expect(screen.queryByRole("dialog")).toBeNull();
  writeFormDraft("test-user", "another-save", "panel-navigation", {
    panel: "phone",
    contact: "invalid",
  });
  view.rerenderPlay(other);
  expect(
    within(screen.getByRole("dialog")).getByRole("heading", { name: "通讯" }),
  ).toBeTruthy();
});

it("sends phone messages with Enter, preserving Shift+Enter and IME confirmation", () => {
  const p = play();
  mount(p);
  fireEvent.click(screen.getByRole("button", { name: "我的手机" }));
  fireEvent.click(screen.getByRole("button", { name: "孙淼" }));
  const input = within(screen.getByRole("dialog")).getByLabelText("自由表达");
  fireEvent.change(input, { target: { value: "没关系的" } });
  expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(true);
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  fireEvent.keyDown(input, { key: "Enter", repeat: true });
  expect(ctrl.submit).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
  expect(ctrl.submit).toHaveBeenCalledExactlyOnceWith(
    p.save,
    "speak",
    "没关系的",
    "sun",
    expect.objectContaining({ channel: "dm", target: "sun" }),
  );
});

it("does not bypass disabled sending with Enter, and supports group messages without AI", () => {
  const p = play();
  const view = mount(p);
  fireEvent.click(screen.getByRole("button", { name: "我的手机" }));
  fireEvent.click(screen.getByRole("button", { name: "孙淼" }));
  const input = within(screen.getByRole("dialog")).getByLabelText("自由表达");
  fireEvent.change(input, { target: { value: "   " } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.change(input, { target: { value: "核查事实" } });
  ctrl.busy = true;
  view.rerenderPlay(p);
  fireEvent.keyDown(input, { key: "Enter" });
  ctrl.busy = false;
  view.rerenderPlay({ ...p, ai: { available: false, reason: "offline" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(ctrl.submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "返回会话列表" }));
  fireEvent.click(screen.getByRole("button", { name: "研发部工作群" }));
  const groupInput = within(screen.getByRole("dialog")).getByLabelText(
    "自由表达",
  );
  fireEvent.change(groupInput, { target: { value: "核查事实" } });
  fireEvent.keyDown(groupInput, { key: "Enter" });
  expect(ctrl.submit).toHaveBeenCalledExactlyOnceWith(
    p.save,
    "speak",
    "核查事实",
    "sun",
    expect.objectContaining({ channel: "group", target: "group" }),
  );
});

it("clears stale unread markers after saving reading and shows newly arrived messages", async () => {
  const p = play();
  p.contacts = {
    sun: { count: 3, preview: "采购的事在系统里说吧", unread: true },
  };
  const view = mount(p);
  fireEvent.click(screen.getByRole("button", { name: "我的手机" }));
  fireEvent.click(screen.getByRole("button", { name: "孙淼 · 未读" }));
  fireEvent.click(screen.getByRole("button", { name: "返回会话列表" }));
  expect(await screen.findByRole("button", { name: "孙淼" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "孙淼 · 未读" })).toBeNull();
  view.rerenderPlay({
    ...p,
    contacts: { sun: { ...p.contacts.sun!, count: 4 } },
  });
  expect(screen.getByRole("button", { name: "孙淼 · 未读" })).toBeTruthy();
});

it("keeps unread markers when saving reading fails", async () => {
  server.use(
    http.post(
      "/api/saves/save-1/reading",
      () => new HttpResponse(null, { status: 500 }),
    ),
  );
  const p = play();
  p.contacts = { sun: { count: 1, preview: "新消息", unread: true } };
  mount(p);
  fireEvent.click(screen.getByRole("button", { name: "我的手机" }));
  fireEvent.click(screen.getByRole("button", { name: "孙淼 · 未读" }));
  expect(await screen.findByText("阅读位置尚未保存，请重试。")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "返回会话列表" }));
  expect(screen.getByRole("button", { name: "孙淼 · 未读" })).toBeTruthy();
});

it("marks authored choices using phone evidence without declaring business completion", () => {
  const p = play();
  p.save.state = { ...p.save.state, act: 3, node: "act_3" };
  p.available_actions = [
    option("clarify"),
    option("report"),
    option("trace_rumor"),
  ];
  p.phone_choice_evidence = { report: ["sent-project-message"] };
  mount(p, { ...authored, scenes: {} } as Story);
  const report = screen.getByRole("button", { name: /只向张工同步项目事实/ });
  expect(report.textContent).toContain("✓");
  expect(report.textContent).toContain("已通过手机消息选择");
  for (const label of [/只向张工同步项目事实/, /联系李姐/, /直接在群里/]) {
    const button = screen.getByRole("button", { name: label });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
  }
  expect(
    screen.getByRole("button", { name: /联系李姐/ }).textContent,
  ).not.toContain("✓");
  expect(
    screen.getByRole("button", { name: /直接在群里/ }).textContent,
  ).not.toContain("✓");
  expect(ctrl.submit).not.toHaveBeenCalled();
});

it("finishes all act-three dialogue before offering the three choices", async () => {
  writeFormDraft("test-user", "save-1", "reading-preferences", { speed: "0" });
  const p = play();
  p.save.state = { ...p.save.state, act: 3, node: "act_3" };
  p.available_actions = [
    option("clarify"),
    option("report"),
    option("trace_rumor"),
  ];
  const lines = (authored as Story).scenes!.act_3!;
  mount(p, authored as Story);
  for (const line of lines) {
    await screen.findByText(line.text, {
      exact: false,
      normalizer: (value) => value,
    });
    expect(
      screen.queryByRole("button", { name: /直接在群里澄清谣言/ }),
    ).toBeNull();
    fireEvent.click(screen.getByText("点击继续 →"));
  }
  expect(
    await screen.findByRole("button", { name: /直接在群里澄清谣言/ }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: /只向张工同步项目事实/ }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: /联系李姐/ })).toBeTruthy();
  expect(ctrl.submit).not.toHaveBeenCalled();
});
