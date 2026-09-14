import { Button } from "@heroui/react";
import { useLayoutEffect, useRef, useState } from "react";
import type { GameEvent, Story } from "../../types";
import { imageSource } from "../../images";
import s from "./V3.module.css";

export function PhoneMessages({
  story,
  events,
  loading,
  error,
  retry,
  hasMore,
  loadingMore,
  loadMore,
  scene,
  group,
}: {
  story: Story;
  events: GameEvent[];
  loading: boolean;
  error: boolean;
  retry: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  scene: Story["acts"][number];
  group: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const bottom = useRef(true);
  const previous = useRef({ first: "", last: "", height: 0, top: 0 });
  const [unseen, setUnseen] = useState(false);
  const first = events[0]?.id ?? "";
  const last = events.at(-1)?.id ?? "";
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element || !events.length) return;
    const before = previous.current;
    if (before.first && before.first !== first && before.last === last) {
      element.scrollTop = before.top + element.scrollHeight - before.height;
    } else if (bottom.current) {
      element.scrollTop = element.scrollHeight;
    } else if (before.last !== last) {
      setUnseen(true);
    }
    previous.current = {
      first,
      last,
      height: element.scrollHeight,
      top: element.scrollTop,
    };
  }, [first, last, events.length]);
  return (
    <div className={s.phoneTimeline}>
      <div
        className={s.phoneMessages}
        ref={scroll}
        aria-label="聊天记录"
        onScroll={() => {
          const element = scroll.current!;
          bottom.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            48;
          previous.current.top = element.scrollTop;
          previous.current.height = element.scrollHeight;
          if (bottom.current) setUnseen(false);
        }}
      >
        {hasMore && (
          <Button variant="ghost" isDisabled={loadingMore} onClick={loadMore}>
            加载更早消息
          </Button>
        )}
        {loading && <p role="status">正在读取会话…</p>}
        {error && (
          <div role="alert">
            会话读取失败。
            <Button variant="secondary" onClick={retry}>
              重试读取
            </Button>
          </div>
        )}
        {!loading && !error && !events.length && (
          <div className={s.emptyConversation}>
            <aside className={s.sceneHint}>
              <strong>当前情景 · {scene.title}</strong>
              <p>{scene.intro}</p>
            </aside>
            <p>暂无聊天记录</p>
            <small>发送消息，开始这次交谈。</small>
            {group && <small>群内只发布已核实的工作事实。</small>}
          </div>
        )}
        {events.map((event) => {
          const system =
            event.speaker === "system" ||
            !["npc", "player"].includes(event.kind);
          const person = story.npcs[event.npc];
          const incoming = event.kind === "npc";
          return (
            <div
              key={event.id}
              className={s.messageRow}
              data-side={system ? "system" : incoming ? "incoming" : "outgoing"}
            >
              {incoming && !system && person && (
                <img
                  className={s.avatar}
                  src={imageSource(person.portrait, 256)}
                  alt=""
                />
              )}
              <div className={s.messageBubble}>
                <strong>
                  {system
                    ? "事件记录"
                    : incoming
                      ? (person?.name ?? "联系人")
                      : "我"}
                </strong>
                <p>{event.text}</p>
              </div>
            </div>
          );
        })}
      </div>
      {unseen && (
        <Button
          className={s.newMessages}
          variant="secondary"
          onClick={() => {
            scroll.current!.scrollTop = scroll.current!.scrollHeight;
            bottom.current = true;
            setUnseen(false);
          }}
        >
          有新消息 ↓
        </Button>
      )}
    </div>
  );
}
