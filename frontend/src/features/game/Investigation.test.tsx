import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import story from "../../testing/story.json";
import type { GameState, PlayState, Story } from "../../types";
import { Investigation } from "./Investigation";
import { resultLines } from "./ResultCard";
const state: GameState = {
  act: 2,
  credit: 65,
  stress: 30,
  heat: 10,
  flags: [],
  procurement: "pending",
  ending: null,
};
const data: PlayState["investigation"] = {
  actions: [
    {
      action: "settle_purchase",
      label: "私下纠正流程，保留记录",
      target: "sun",
      blocked: "",
      decision: true,
      tradeoff: "未形成正式责任认定",
    },
  ],
  records: [],
};
describe("investigated decisions", () => {
  it("waits for the player's reason and explicit submission", () => {
    const act = vi.fn();
    render(
      <Investigation
        state={state}
        data={data}
        story={story as Story}
        disabled={false}
        act={act}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "私下纠正流程，保留记录" }),
    );
    expect(act).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("button", { name: "确认这个选择" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "我为什么这样选" }), {
      target: { value: "先保留记录" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认这个选择" }));
    expect(act).toHaveBeenCalledWith("settle_purchase", "先保留记录", "sun");
  });
  it("blocks gated evidence and permits cancellation without action", () => {
    const act = vi.fn();
    render(
      <Investigation
        state={state}
        data={{
          ...data,
          actions: [
            ...data.actions!,
            {
              action: "confide_sun",
              label: "私下追问",
              target: "sun",
              blocked: "需要熟悉度60",
              decision: false,
              tradeoff: "",
            },
          ],
        }}
        story={story as Story}
        disabled={false}
        act={act}
      />,
    );
    expect(
      screen.getByRole("button", { name: "私下追问" }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "私下纠正流程，保留记录" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "再想想" }));
    expect(act).not.toHaveBeenCalled();
    expect(screen.queryByRole("form", { name: "确认剧情选择" })).toBeNull();
  });
  it("uses only saved rationale and actually acquired records for sharing", () => {
    const lines = resultLines(
      {
        ...state,
        ending: "克制纠偏，保留记录",
        decisions: [
          {
            act: 2,
            action: "settle_purchase",
            reason: "保留这份依据\n以后再核对",
            evidence: ["purchase_timeline"],
          },
        ],
      },
      {
        records: [
          { id: "purchase_timeline", title: "采购流转日志", text: "虚构记录" },
        ],
      },
    );
    expect(lines.join("\n")).toContain("保留这份依据\n以后再核对");
    expect(lines.join("\n")).toContain("采购流转日志");
    expect(lines.join("\n")).not.toContain("孙淼私下的解释");
    expect(resultLines(state).join("\n")).toContain("未填写调查选择理由");
  });
});
