import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { sunReply } from "../../testing/fixtures";
import { EffectDetails } from "./EffectDetails";

it("reports signed deltas and causal facts, without manufacturing rewards or trusting NPC effects", () => {
  const event = {
    ...sunReply,
    speaker: "system",
    effects: [
      {
        text: "提交申请",
        changes: { credit: 5, pressure: -10 },
        facts: [{ before: null, after: "申请已提交，等待处理" }],
      },
    ],
  };
  const view = render(<EffectDetails event={event} />);
  expect(screen.getByText("专业信用 +5；工作压力 -10")).toBeTruthy();
  expect(screen.getByText("变化原因：提交申请")).toBeTruthy();
  expect(screen.getByText(/申请已提交，等待处理/)).toBeTruthy();
  view.rerender(
    <EffectDetails event={{ ...event, effects: [{ changes: {} }] }} />,
  );
  expect(screen.getByText("本次没有指标增减。")).toBeTruthy();
  view.rerender(<EffectDetails event={{ ...event, speaker: "sun" }} />);
  expect(screen.queryByLabelText("已提交的状态变化")).toBeNull();
});
