import {
  ArrowRight,
  Check,
  ChevronRight,
  MessageSquare,
  RefreshCw,
  Send,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import s from "../../App.module.css";
import type {
  Action,
  GameEvent,
  Npc,
  Save,
  Story,
  PlayState,
} from "../../types";
import { Investigation } from "./Investigation";
import { ResultCard } from "./ResultCard";
import { actionUnavailable, nextStep } from "./progress";

export function Conversation({
  story,
  investigation,
  state,
  npc,
  submittedText = "",
  preview = "",
  scene,
  character,
  save,
  lastReply,
  events,
  disabled,
  act,
  input,
  setInput,
  busy,
  status,
  error,
  pending,
  recover,
  onNext,
}: {
  investigation?: PlayState["investigation"];
  submittedText?: string;
  preview?: string;
  story: Story;
  state: Save["state"];
  scene: Story["acts"][number];
  character: Story["npcs"][Npc];
  save: Save;
  npc: Npc;
  lastReply: GameEvent | undefined;
  events: GameEvent[];
  disabled: boolean;
  act: (action: Action, text?: string, target?: Npc) => Promise<void>;
  input: string;
  setInput: (input: string) => void;
  busy: boolean;
  status: string;
  error: string;
  pending: string | null;
  recover: () => Promise<void>;
  onNext: () => void;
}) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const options = scene.choices.filter(
    (c) =>
      !["repair", "written_record"].includes(c.action) ||
      state.flags.includes("confronted"),
  );
  const latestPlayerIndex =
    events.length -
    1 -
    [...events].reverse().findIndex((e) => e.kind === "player");
  const suggestion = events
    .slice(latestPlayerIndex + 1)
    .reverse()
    .find(
      (e) => e.kind === "suggestion" && e.npc === npc && e.act === state.act,
    );
  const proposal =
    suggestion &&
    suggestion.id !== dismissed &&
    suggestion.action &&
    !actionUnavailable(state, suggestion.action)
      ? suggestion
      : null;
  const targets: Partial<Record<Action, Npc>> = {
    boundary: "sun",
    public_confront: "sun",
    repair: "sun",
    supplement: "li",
    written_record: "li",
    report: "zhang",
    clarify: "zhang",
    document_rumor: "zhang",
    deliver: "zhang",
  };
  const hint = nextStep(state);
  const lastPlayer = [...events]
    .reverse()
    .find(
      (e) =>
        e.kind === "player" &&
        e.act === state.act &&
        (e.npc === npc || e.action !== "speak") &&
        !["begin", "next"].includes(e.action ?? ""),
    );
  const playerText = submittedText || lastPlayer?.text;

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
          <p>
            {[...events].reverse().find((e) => e.kind === "epilogue")?.text ||
              "故事结局已保存，回顾文字还未生成。"}
          </p>
          {!events.some((e) => e.kind === "epilogue") && (
            <button
              className={s.secondary}
              disabled={disabled}
              onClick={() => void act("epilogue")}
            >
              生成故事回顾
            </button>
          )}
          <ResultCard state={state} data={investigation} story={story} />
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
          {playerText && (
            <p className={s.playerLine}>
              <span>你</span>
              {playerText}
            </p>
          )}
          <p className={s.dialogue} aria-live="polite" aria-busy={busy}>
            {busy
              ? preview || status || "对方正在回复…"
              : state.act === 0
                ? scene.intro
                : lastReply?.text || character.greeting}
          </p>
          {(state.consequences ?? []).length > 0 && (
            <aside className={s.note} aria-label="选择带来的后果">
              <strong>事情的变化</strong>
              <p>{state.consequences?.at(-1)}</p>
            </aside>
          )}
          {state.act === 2 &&
            state.procurement === "approved" &&
            !state.flags.includes("supported") && (
              <aside className={s.note} aria-label="排期风险">
                采购通过了，实验排期还没有落实。可以联系张工争取支持，或直接继续并承担延期风险。
              </aside>
            )}
          {proposal && (
            <aside className={s.note} aria-label="待确认行动">
              <strong>把这句话变成行动？</strong>
              <p>{proposal.text}。确认后才会改变故事进度。</p>
              <button
                className={s.primary}
                disabled={disabled}
                onClick={() =>
                  void act(proposal.action!, "", targets[proposal.action!])
                }
              >
                确认行动
              </button>
              <button
                className={s.textButton}
                disabled={disabled}
                onClick={() => setDismissed(proposal.id)}
              >
                暂不执行
              </button>
            </aside>
          )}
          {state.act === 2 && (
            <div className={s.quickWork} aria-label="快捷工作沟通">
              {!state.flags.includes("requirements") && (
                <button
                  disabled={disabled}
                  onClick={() =>
                    void act("speak", "请列出采购材料要求。", "li")
                  }
                >
                  询问采购材料
                </button>
              )}
              {state.flags.includes("materials") &&
                state.procurement !== "approved" && (
                  <button
                    disabled={disabled}
                    onClick={() => void act("speak", "请审核采购。", "li")}
                  >
                    请李姐审核
                  </button>
                )}
              {state.flags.includes("reported") &&
                !state.flags.includes("supported") && (
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void act("speak", "请落实实验排期支持。", "zhang")
                    }
                  >
                    请张工落实支持
                  </button>
                )}
            </div>
          )}
          <Investigation
            state={state}
            data={investigation}
            story={story}
            disabled={disabled}
            act={act}
          />
          <div className={s.choices}>
            {options.map(({ label, action, target }) => (
              <button
                key={action}
                aria-label={label}
                title={actionUnavailable(state, action) || undefined}
                disabled={disabled || !!actionUnavailable(state, action)}
                onClick={() => void act(action, "", target ?? targets[action])}
              >
                <span>
                  {label}
                  {actionUnavailable(state, action) === "已完成" && (
                    <small> · 已完成</small>
                  )}
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
          {state.act > 0 && (
            <form
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
              <button
                type="submit"
                aria-label="发送"
                disabled={disabled || !input.trim()}
              >
                <Send size={18} />
              </button>
            </form>
          )}
          <div className={s.conversationFooter}>
            <span>
              {busy
                ? "回复完成后将自动保存，你可以打开回顾或手机查看已有内容。"
                : hint || "这一幕的关键行动已完成，可以继续交流或进入下一幕。"}
            </span>
            {state.act > 0 && (
              <button
                disabled={disabled || !!hint}
                title={hint || undefined}
                onClick={() => onNext()}
              >
                继续故事 <ArrowRight size={16} />
              </button>
            )}
          </div>
        </>
      )}
      {error && (
        <div role="alert" className={s.error}>
          {error}
        </div>
      )}
      {pending && !busy && (
        <button className={s.textButton} onClick={() => void recover()}>
          <RefreshCw size={16} />
          恢复回合结果
        </button>
      )}
    </section>
  );
}
