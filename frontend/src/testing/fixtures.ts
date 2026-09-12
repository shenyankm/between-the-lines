import type { GameEvent, Save, Story } from "../types";
import type { components } from "../generated/api";

/** Request body the backend accepts for `POST /api/saves/{id}/turns`. */
export type TurnInput = components["schemas"]["TurnInput"];

type GameState = Save["state"];

/**
 * Mirrors `backend/app/story.json`: five acts (prologue plus four), three
 * interlocutors and editor tips. Act titles keep the ` · ` separator that
 * `Play` splits on when it renders the chapter navigation.
 */
export const story: Story = {
  title: "言外之意",
  subtitle: "BETWEEN THE LINES",
  acts: [
    {
      title: "序幕 · 微妙的恶意",
      location: "研发工位",
      time: "周一 · 09:10",
      intro: "你是周凌，大家叫你菱菱，在一家传统化工国企做催化剂研发。",
    },
    {
      title: "第一幕 · 缺席的欢送会",
      location: "公司食堂",
      time: "周五 · 12:15",
      intro: "王会计的欢送会结束了，却没人通知你。",
    },
    {
      title: "第二幕 · 被卡住的采购单",
      location: "财务窗口",
      time: "周二 · 10:30",
      intro: "加急采购两天没有进展，先确认缺少什么。",
    },
    {
      title: "第三幕 · 流言的回声",
      location: "项目会议室",
      time: "周四 · 09:00",
      intro: "“听说你要跳槽？”传言已经到了例会上。",
    },
    {
      title: "终幕 · 你的选择",
      location: "研发工位",
      time: "故事之后",
      intro: "每次回应，都在为你和他人之间画下一条线。",
    },
  ],
  npcs: {
    sun: { name: "孙淼", role: "财务出纳 · 同期同事" },
    li: { name: "李姐", role: "财务会计" },
    zhang: { name: "张工", role: "研发负责人" },
  },
  tips: [
    {
      title: "先确认事实",
      text: "把“她是不是针对我”转成“目前缺少哪些材料”。",
      source: "游戏编辑建议",
    },
  ],
};

function gameState(over: Partial<GameState> = {}): GameState {
  return {
    act: 1,
    credit: 60,
    stress: 20,
    heat: 10,
    flags: [],
    procurement: "pending",
    ending: null,
    ...over,
  };
}

export function save(
  over: { id?: string; version?: number; state?: Partial<GameState> } = {},
): Save {
  return {
    id: over.id ?? "save-1",
    version: over.version ?? 2,
    state: gameState(over.state),
  };
}

/** An NPC reply in the act the default save sits in. */
export const sunReply: GameEvent = {
  id: "evt-1",
  kind: "npc",
  npc: "sun",
  act: 1,
  text: "菱菱，你不会又生气了吧？我只是随口一说。",
};

/** Same interlocutor, earlier act: must not be picked as the latest reply. */
export const olderSunReply: GameEvent = {
  id: "evt-0",
  kind: "npc",
  npc: "sun",
  act: 0,
  text: "这句是上一幕的旧回复。",
};

export const epilogueEvent: GameEvent = {
  id: "evt-9",
  kind: "epilogue",
  npc: "sun",
  text: "你为这段经历选择了一条清晰的边界。",
};
