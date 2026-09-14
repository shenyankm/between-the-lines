import { Form } from "@heroui/react";
import { Button } from "@heroui/react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  MessageSquare,
  RefreshCw,
  Send,
} from "lucide-react";
import { Link } from "react-router";
import { ErrorNotice } from "../../ErrorNotice";
import s from "../../App.module.css";
import type { Action, GameEvent, Npc, Save, Story } from "../../types";
import { choiceProgress, nextStep } from "./progress";

export function Conversation({
  state,
  scene,
  story,
  character,
  save,
  lastReply,
  events,
  disabled,
  aiDisabled = false,
  availableActions,
  act,
  input,
  setInput,
  busy,
  status,
  error,
  issue,
  recoveryDisabled,
  refresh,
  pending,
  recover,
  onNext,
}: {
  story: Story;
  state: Save["state"];
  scene: Story["acts"][number];
  character: NonNullable<Story["npcs"][Npc]>;
  save: Save;
  npc: Npc;
  lastReply: GameEvent | undefined;
  events: GameEvent[];
  disabled: boolean;
  aiDisabled?: boolean;
  availableActions?: import("../../types").PlayState["available_actions"];
  act: (action: Action, text?: string, target?: Npc) => Promise<void>;
  input: string;
  setInput: (input: string) => void;
  busy: boolean;
  status: string;
  error: string;
  issue?: unknown;
  recoveryDisabled?: boolean;
  refresh: () => void;
  pending: string | null;
  recover: () => Promise<void>;
  onNext: () => void;
}) {
  const relationshipChosen = state.flags.some((f) =>
    ["sun_cut", "sun_observe"].includes(f),
  );
  const workComplete = ["clarified", "delivered"].every((f) =>
    state.flags.includes(f),
  );
  const options =
    save.story_version === 2
      ? (availableActions ?? []).filter(
          (a) => a.action !== "next" && !a.action.startsWith("partner_"),
        )
      : scene.choices.filter(
          ({ action }) =>
            !["cut_ties", "keep_distance"].includes(action) ||
            (workComplete && !relationshipChosen),
        );
  const nextAction = availableActions?.find((a) => a.action === "next");
  const next =
    save.story_version === 2
      ? {
          ready: nextAction?.enabled ?? false,
          message:
            nextAction?.reason ||
            "行动结果会记录在故事里；普通聊天不重复计分。",
        }
      : nextStep(state);
  return (
    <section className={s.conversation}>
      <div className={s.speakerRow}>
        <div className={s.speaker}>
          <span className={s.speakerDot} />
          {state.ending ? "故事结局" : character.name}
          <small>{state.ending ? "你留下的边界" : character.role}</small>
        </div>
        <span className={s.saved}>
          <Check size={13} />
          已存档 · {save.version}
        </span>
      </div>
      {state.ending ? (
        <div className={s.ending}>
          <h1>{state.ending}</h1>
          {save.ending_summary && <p>{save.ending_summary}</p>}
          <p>
            {[...events].reverse().find((e) => e.kind === "epilogue")?.text ||
              "故事结局已保存。你可以选择生成回顾，尝试另一种回应。"}
          </p>
          {save.story_version !== 2 &&
            !events.some((e) => e.kind === "epilogue") && (
              <Button
                type="button"
                variant="secondary"
                className={s.secondary}
                isDisabled={disabled || aiDisabled}
                onClick={() => void act("epilogue")}
              >
                生成故事回顾
              </Button>
            )}
          <Link className={s.primary} to="/saves">
            回看我的故事 <ArrowRight size={18} />
          </Link>
          <a
            className={s.textButton}
            href="https://www.zhihu.com/question/668921709"
            target="_blank"
            rel="noreferrer"
          >
            阅读相关职场讨论 ↗
          </a>
        </div>
      ) : (
        <>
          <p className={s.dialogue}>
            {state.act === 0
              ? scene.intro
              : lastReply?.text || character.greeting}
          </p>
          {state.act === 0 && (
            <p className={s.muted}>{story.adaptation_note}</p>
          )}
          {state.act > 0 && (
            <p role="status" className={s.muted}>
              {next.message}
            </p>
          )}
          {aiDisabled && (
            <p className={s.notice}>AI 暂不可用，仍可使用行动按钮推进故事。</p>
          )}
          {events
            .filter(
              (e) =>
                e.act === state.act &&
                ((e.kind === "player" && e.action === "speak") ||
                  e.kind === "npc"),
            )
            .slice(-6)
            .map((e) => (
              <p key={e.id} className={s.muted}>
                {e.kind === "player"
                  ? "你"
                  : (story.npcs[e.npc] ?? story.npcs.sun).name}
                ：{e.text}
              </p>
            ))}
          {events
            .filter((e) => (e.effects?.length ?? 0) > 0 && e.action !== "begin")
            .slice(-3)
            .map((e) => (
              <p key={e.id} className={s.notice}>
                {e.text}{" "}
                {e.effects
                  ?.map((effect) =>
                    effect.changes && typeof effect.changes === "object"
                      ? Object.entries(effect.changes)
                          .map(
                            ([key, value]) =>
                              `${({ credit: "专业信用", stress: "心绪消耗", heat: "关注度" } as Record<string, string>)[key] ?? key} ${Number(value) > 0 ? "+" : ""}${String(value)}`,
                          )
                          .join(" · ")
                      : "",
                  )
                  .join(" ")}
              </p>
            ))}
          <div className={s.choices}>
            {options.map(({ label, action, target }) => {
              const entry = availableActions?.find((a) => a.action === action);
              const progress =
                save.story_version === 2 && entry
                  ? {
                      disabled: !entry.enabled,
                      completed: entry.completed,
                      reason: entry.reason,
                    }
                  : choiceProgress(state, action);
              return (
                <Button
                  type="button"
                  variant="secondary"
                  key={action}
                  isDisabled={disabled || progress.disabled}
                  aria-description={progress.reason || undefined}
                  onClick={() => void act(action, "", target ?? undefined)}
                >
                  <span>
                    {label}
                    {progress.completed ? " · 已完成" : ""}
                  </span>
                  {progress.completed ? (
                    <Check size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                </Button>
              );
            })}
          </div>
          {state.act > 0 && (
            <Form
              className={s.composer}
              onSubmit={(e) => {
                e.preventDefault();
                void act("speak", input);
              }}
            >
              <MessageSquare size={18} />
              <input
                aria-label="对角色说的话"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={1500}
                placeholder="也可以用自己的话回应…"
                disabled={disabled}
              />
              <Button
                type="submit"
                aria-label="发送"
                isDisabled={disabled || aiDisabled || !input.trim()}
              >
                <Send size={18} />
              </Button>
            </Form>
          )}
          <div className={s.conversationFooter}>
            <span>{busy ? status : "你的表达，会成为故事的一部分。"}</span>
            {state.act > 0 && (
              <Button
                type="button"
                variant="secondary"
                isDisabled={
                  disabled ||
                  !(
                    next.ready ||
                    (save.story_version === 2 &&
                      state.act === 2 &&
                      state.procurement === "approved")
                  )
                }
                onClick={() => onNext()}
              >
                继续故事 <ArrowRight size={16} />
              </Button>
            )}
          </div>
        </>
      )}
      <ErrorNotice
        error={issue}
        message={error}
        onRetry={pending ? undefined : refresh}
      />
      {pending && !busy && (
        <Button
          type="button"
          variant="secondary"
          isDisabled={recoveryDisabled}
          className={s.textButton}
          onClick={() => void recover()}
        >
          <RefreshCw size={16} />
          恢复回合结果
        </Button>
      )}
    </section>
  );
}
