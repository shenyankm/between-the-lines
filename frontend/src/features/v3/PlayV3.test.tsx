import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Action, PlayState, Story } from "../../types";
import { save } from "../../testing/fixtures";
import authored from "../../testing/story-v3.json";
import { PlayV3 } from "./PlayV3";

function state(node = "act_3"): PlayState {
  return {
    save: {
      ...save(),
      story_version: 3,
      state: {
        ...save().state,
        story_version: 3,
        content_revision: 2,
        node,
        act: 3,
        tick: 3,
        rumination: 25,
        pressure: 25,
        partner_choice: null,
        exit_draft: null,
        outcome: null,
        quiet_turns: 0,
      },
    },
    events: [],
    active_turn: null,
    performance_version: 2,
    performance: [
      {
        id: "current",
        speaker: "sun",
        text: "这次你想参加吗？",
        portraits: [],
      },
    ],
    reading: { [node]: 1 },
    available_actions: (["follow_up", "close_story"] as Action[]).map(
      (action) => ({
        action,
        label: action,
        target: "sun",
        enabled: true,
        completed: false,
        requires_confirmation: action === "close_story",
        reason: "",
        effect: "",
      }),
    ),
  };
}
function show(play: PlayState) {
  localStorage.setItem("reduced-motion:stage-test", "true");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PlayV3 userId="stage-test" play={play} story={authored as Story} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it("does not let a stale performance consume the next scene's reading position", () => {
  const play = state();
  play.performance_version = 1;
  play.reading = {};
  show(play);
  expect(screen.getByText("正在切换场景…")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /点击继续/ })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "自由表达" })).toBeNull();
});
it("offers the follow-up responses and an explicit ending entry after reading", () => {
  show(state("act_3_follow_up"));
  expect(
    screen.getByRole("button", { name: "这次不参加，工作资料请照常发我。" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "先告诉我安排，我再决定。" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "按当前进度结束本局" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "直接在群里澄清谣言。" }),
  ).toBeNull();
});

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => vi.unstubAllGlobals());
