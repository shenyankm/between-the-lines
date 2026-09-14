import { Button } from "@heroui/react";
import { EffectDetails } from "./EffectDetails";
import { EventEvidence } from "./EventEvidence";
import type { Act } from "./Work";
import type { Action, PlayState } from "../../types";

/** Only persisted event records establish an action; NPC prose is never evidence. */
export function ActionReceipt({
  play,
  openActions,
  act,
  compact = false,
}: {
  play: PlayState;
  openActions: () => void;
  act?: Act;
  compact?: boolean;
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
  const next: Partial<Record<Action, Action[]>> = {
    request_materials: ["dispute_return", "supplement"],
    supplement: ["approve_purchase"],
    dispute_return: ["approve_purchase", "confirm_responsibility"],
    approve_purchase: ["deliver", "next"],
    deliver: ["project_review"],
    clarify: ["review_clarification"],
    review_clarification: ["confirm_responsibility", "project_review"],
    confirm_responsibility: ["change_rules"],
    change_rules: ["project_review"],
    request_extension: ["project_review"],
    project_review: ["correct_loss", "deliver", "apply_rules", "follow_up"],
    repair_friendship: ["acknowledge_harm", "cut_ties", "keep_distance"],
    acknowledge_harm: ["complete_remedy", "cut_ties", "keep_distance"],
    complete_remedy: ["project_review", "follow_up"],
    draft_support: ["submit_support"],
    submit_support: ["review_support"],
    review_support: ["rest", "request_help"],
    draft_exit: ["submit_exit"],
  };
  const lastAction = actions.at(-1)?.action;
  const choices = (play.available_actions ?? []).filter(
    (option) =>
      lastAction &&
      next[lastAction]?.includes(option.action) &&
      !option.completed,
  );
  return (
    <section aria-label="最近一轮记录">
      <details open={!compact}>
        <summary>最近一轮 · 已保存记录</summary>
        {actions.map((event) => (
          <article key={event.id}>
            <p role="status">{event.text}</p>
            <EffectDetails event={event} />
            <EventEvidence saveId={play.save.id} eventId={event.id} />
          </article>
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
        {!play.active_turn && choices.length > 0 && (
          <div aria-label="可追溯的下一步">
            <h4>接下来可以</h4>
            {choices.map((option) => (
              <div key={option.action}>
                <Button
                  variant="secondary"
                  isDisabled={!option.enabled}
                  onClick={() =>
                    option.action === "supplement" || !act
                      ? openActions()
                      : act(option.action, option.target ?? "sun")
                  }
                >
                  下一步：{option.label}
                </Button>
                <p>{option.reason || option.effect}</p>
              </div>
            ))}
          </div>
        )}
        {input.action === "speak" && !actions.length && !play.active_turn && (
          <Button variant="secondary" onClick={openActions}>
            查看可用行动与表单
          </Button>
        )}
      </details>
    </section>
  );
}
