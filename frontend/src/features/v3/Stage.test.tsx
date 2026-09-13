import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Script, Portraits } from "./Stage";
import { story } from "../../testing/fixtures";

afterEach(() => vi.useRealTimers());
it("lets the reader reveal text before advancing and supports reduced motion", () => {
  vi.useFakeTimers();
  const advance = vi.fn();
  const lines = [{ id: "line", speaker: "sun", text: "请先核对工作材料。" }];
  const view = render(
    <Script lines={lines} position={0} reduced={false} advance={advance} />,
  );
  void act(() => vi.advanceTimersByTime(35));
  expect(screen.getByText("请先")).toBeTruthy();
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText(lines[0]!.text)).toBeTruthy();
  expect(advance).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button"));
  expect(advance).toHaveBeenCalledOnce();
  view.rerender(
    <Script
      lines={[{ id: "line", speaker: "unknown", text: "记录" }]}
      position={0}
      reduced
      advance={advance}
    />,
  );
  expect(screen.getByText("现场")).toBeTruthy();
  fireEvent.click(screen.getByRole("button"));
  expect(advance).toHaveBeenCalledTimes(2);
  view.rerender(
    <Script lines={[]} position={0} reduced={false} advance={advance} />,
  );
  expect(screen.queryByRole("button")).toBeNull();
});
it("finishes a short line automatically", () => {
  vi.useFakeTimers();
  render(
    <Script
      lines={[{ id: "line", speaker: "inner", text: "好" }]}
      position={0}
      reduced={false}
      advance={vi.fn()}
    />,
  );
  void act(() => vi.advanceTimersByTime(35));
  expect(screen.getByText("点击继续 →")).toBeTruthy();
});
it("uses authored portrait presence, clothing, and speaker fallback", () => {
  const view = render(<Portraits story={story} speaker="sun" />);
  expect(view.container.querySelectorAll("img")).toHaveLength(2);
  view.rerender(
    <Portraits
      story={story}
      speaker="li"
      portraits={["player-coat", "sun-coat"]}
    />,
  );
  expect(
    [...view.container.querySelectorAll("img")].map((x) => x.src).join(" "),
  ).toContain("sun-coat");
  expect(
    [...view.container.querySelectorAll("img")].map((x) => x.src).join(" "),
  ).toContain("player-coat");
  view.rerender(
    <Portraits story={story} speaker="sun" portraits={["player"]} />,
  );
  expect(view.container.querySelectorAll("img")).toHaveLength(1);
  view.rerender(
    <Portraits
      story={story}
      speaker="narrator"
      player={false}
      portraits={[]}
    />,
  );
  expect(view.container.querySelectorAll("img")).toHaveLength(0);
});
