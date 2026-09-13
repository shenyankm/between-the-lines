import {
  ArrowRight,
  Check,
  ChevronRight,
  MessageSquare,
  RefreshCw,
  Send,
} from "lucide-react";
import { Link } from "react-router";
import s from "../../App.module.css";
import type { Action, GameEvent, Npc, Save, Story } from "../../types";

export function Conversation({
  state,
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
  const options = scene.choices;
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
          <div className={s.choices}>
            {options.map(({ label, action, target }) => (
              <button
                key={action}
                disabled={disabled}
                onClick={() => void act(action, "", target ?? undefined)}
              >
                <span>{label}</span>
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
            <span>{busy ? status : "你的表达，会成为故事的一部分。"}</span>
            {state.act > 0 && (
              <button disabled={disabled} onClick={() => onNext()}>
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
