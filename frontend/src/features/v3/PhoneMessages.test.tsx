import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PhoneMessages } from "./PhoneMessages";
import type { GameEvent, Story } from "../../types";
import authored from "../../testing/story-v3.json";

const story = authored as Story;
const event = (id: string): GameEvent => ({
  id,
  npc: "sun",
  kind: "npc",
  text: id,
  channel: "dm",
});
const base = {
  story,
  events: [event("message-2")],
  loading: false,
  error: false,
  retry: vi.fn(),
  hasMore: true,
  loadingMore: false,
  loadMore: vi.fn(),
  group: false,
};
it("preserves the reading anchor on prepend and offers new messages without stealing scroll", () => {
  const view = render(<PhoneMessages {...base} />);
  const messages = screen.getByLabelText("聊天记录");
  let height = 1000;
  Object.defineProperties(messages, {
    scrollHeight: { get: () => height },
    clientHeight: { value: 300 },
  });
  messages.scrollTop = 200;
  fireEvent.scroll(messages);
  fireEvent.click(screen.getByRole("button", { name: "加载更早消息" }));
  expect(base.loadMore).toHaveBeenCalledOnce();
  height = 1500;
  view.rerender(
    <PhoneMessages
      {...base}
      events={[event("message-1"), event("message-2")]}
    />,
  );
  expect(messages.scrollTop).toBe(700);
  fireEvent.scroll(messages);
  height = 1700;
  view.rerender(
    <PhoneMessages
      {...base}
      events={[event("message-1"), event("message-2"), event("message-3")]}
    />,
  );
  expect(messages.scrollTop).toBe(700);
  fireEvent.click(screen.getByRole("button", { name: "有新消息 ↓" }));
  expect(messages.scrollTop).toBe(1700);
  expect(screen.queryByRole("button", { name: "有新消息 ↓" })).toBeNull();
});
it("never labels a loading or failed conversation as empty, and distinguishes system records", () => {
  const view = render(<PhoneMessages {...base} events={[]} loading />);
  expect(screen.getByRole("status")).toBeTruthy();
  expect(screen.queryByText("暂无聊天记录")).toBeNull();
  view.rerender(<PhoneMessages {...base} events={[]} error />);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.queryByText("暂无聊天记录")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重试读取" }));
  expect(base.retry).toHaveBeenCalledOnce();
  view.rerender(
    <PhoneMessages
      {...base}
      events={[{ ...event("record"), kind: "work", speaker: "system" }]}
    />,
  );
  expect(screen.getByText("事件记录")).toBeTruthy();
  expect(view.container.querySelector('[data-side="system"]')).toBeTruthy();
});
