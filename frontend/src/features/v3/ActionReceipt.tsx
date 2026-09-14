import { Button } from "@heroui/react";
import type { PlayState } from "../../types";

/** Only persisted event records establish an action; NPC prose is never evidence. */
export function ActionReceipt({
  play,
  openActions,
}: {
  play: PlayState;
  openActions: () => void;
}) {
  const start = play.events.reduce(
    (last, event, index) => (event.kind === "player" ? index : last),
    -1,
  );
  if (start < 0) return null;
  const events = play.events.slice(start);
  const input = events[0]!;
  if (["propose", "cancel_proposal"].includes(input.action ?? "")) return null;
  const actions = events.filter(
    (event) => event.speaker === "system" && (event.effects?.length ?? 0) > 0,
  );
  return (
    <section aria-label="最近一轮记录">
      <h3>最近一轮 · 已保存记录</h3>
      {actions.map((event) => (
        <p key={event.id}>{event.text}</p>
      ))}
      {input.action === "speak" && !actions.length && (
        <p>
          {play.active_turn
            ? "对白已保存，正在核对行动与回复。"
            : play.proposal
              ? "候选行动等待确认，尚未执行。"
              : "本轮已作为对话保存；没有已执行行动的记录。可使用行动按钮，需填写的申请请先完善表单。"}
        </p>
      )}
      {input.action === "speak" && !actions.length && !play.active_turn && (
        <Button variant="secondary" onClick={openActions}>
          查看可用行动与表单
        </Button>
      )}
    </section>
  );
}
