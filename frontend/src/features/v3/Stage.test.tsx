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
it("reserves the finished line height from the first frame while revealing", () => {
  vi.useFakeTimers();
  const lines = [{ id: "line", speaker: "sun", text: "请先核对工作材料。" }];
  render(
    <Script lines={lines} position={0} reduced={false} advance={vi.fn()} />,
  );
  void act(() => vi.advanceTimersByTime(35));
  expect(screen.getByText("请先")).toBeTruthy();
  // The hidden remainder keeps the pinned hint and the panel from moving.
  expect(screen.getByText("核对工作材料。")).toBeTruthy();
  fireEvent.click(screen.getByRole("button"));
  expect(screen.queryByText("核对工作材料。")).toBeNull();
  expect(screen.getByText(lines[0]!.text)).toBeTruthy();
});
it("keeps the speaker name on the speaker's own side of the panel", () => {
  const view = render(
    <Script
      lines={[{ id: "line", speaker: "player", text: "我是周菱菱。" }]}
      position={0}
      reduced
      advance={vi.fn()}
    />,
  );
  const name = () => view.container.querySelector("strong")!;
  expect(name().textContent).toBe("周菱菱");
  expect(name().dataset.side).toBe("left");
  view.rerender(
    <Script
      lines={[{ id: "line", speaker: "sun", text: "你买的啊？" }]}
      position={0}
      reduced
      advance={vi.fn()}
    />,
  );
  expect(name().textContent).toBe("孙淼");
  expect(name().dataset.side).toBe("right");
  // Only the current speaker's name is rendered.
  expect(view.container.querySelectorAll("strong")).toHaveLength(1);
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
it("honors slow and instant reading preferences while reduced motion wins", () => {
  vi.useFakeTimers();
  const advance = vi.fn();
  const lines = [{ id: "line", speaker: "sun", text: "请先核对工作材料。" }];
  const view = render(
    <Script
      lines={lines}
      position={0}
      reduced={false}
      speed={70}
      advance={advance}
    />,
  );
  void act(() => vi.advanceTimersByTime(35));
  expect(screen.queryByText("请先")).toBeNull();
  void act(() => vi.advanceTimersByTime(35));
  expect(screen.getByText("请先")).toBeTruthy();
  view.rerender(
    <Script
      lines={lines}
      position={0}
      reduced={false}
      speed={0}
      advance={advance}
    />,
  );
  expect(screen.getByText(lines[0]!.text)).toBeTruthy();
  fireEvent.click(screen.getByRole("button"));
  expect(advance).toHaveBeenCalledOnce();
  view.rerender(
    <Script lines={lines} position={0} reduced speed={70} advance={advance} />,
  );
  expect(screen.getByText(lines[0]!.text)).toBeTruthy();
  expect(vi.getTimerCount()).toBe(0);
});
