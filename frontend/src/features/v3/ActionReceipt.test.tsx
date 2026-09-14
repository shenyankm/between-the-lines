import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { PlayState } from "../../types";
import { save, sunReply } from "../../testing/fixtures";
import { ActionReceipt } from "./ActionReceipt";

it("never treats NPC claims as execution, and distinguishes pending from absent actions", () => {
  const play: PlayState = {
    save: save(),
    active_turn: null,
    events: [
      {
        ...sunReply,
        channel: "scene",
        id: "input",
        kind: "player",
        action: "speak",
        text: "我希望你先问我",
      },
      { ...sunReply, channel: "scene", text: "已经完成" },
    ],
  };
  const view = render(<ActionReceipt play={play} openActions={() => {}} />);
  expect(screen.getByText(/没有已执行行动的记录/)).toBeTruthy();
  expect(screen.queryByText("已经完成")).toBeNull();
  view.rerender(
    <ActionReceipt
      play={{ ...play, active_turn: { id: "t", request_id: "r" } }}
      openActions={() => {}}
    />,
  );
  expect(screen.getByText(/正在核对行动与回复/)).toBeTruthy();
  view.rerender(
    <ActionReceipt
      play={{
        ...play,
        events: [
          ...play.events,
          {
            ...sunReply,
            channel: "scene",
            id: "fact",
            kind: "work",
            speaker: "system",
            text: "边界已记录",
            effects: [{ changes: { credit: 5 } }],
          },
        ],
      }}
      openActions={() => {}}
    />,
  );
  expect(screen.getByText("边界已记录")).toBeTruthy();
  expect(screen.queryByText(/没有已执行行动的记录/)).toBeNull();
});
