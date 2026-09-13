import { useState } from "react";
import type { Action, GameState, Npc, PlayState, Story } from "../../types";
import s from "./Investigation.module.css";

type Option = NonNullable<
  NonNullable<PlayState["investigation"]>["actions"]
>[number];
export function Investigation({
  state,
  data,
  story,
  disabled,
  act,
}: {
  state: GameState;
  data?: PlayState["investigation"];
  story: Story;
  disabled: boolean;
  act: (action: Action, text?: string, target?: Npc) => Promise<void>;
}) {
  const [choice, setChoice] = useState<Option | null>(null);
  const [reason, setReason] = useState("");
  const actions = data?.actions ?? [];
  const views = (story.community ?? []).filter((v) => v.act === state.act);
  if (![2, 3].includes(state.act)) return null;
  return (
    <section className={s.panel} aria-label="调查与取舍">
      <details open>
        <summary>
          调查与取舍 <small>先听口径，再对记录</small>
        </summary>
        <div className={s.relationships}>
          {(["sun", "li", "zhang"] as const).map((npc) => (
            <div key={npc}>
              <span>
                {story.npcs[npc].name} · {npc === "sun" ? "熟悉度" : "工作信任"}
              </span>
              <strong>{state.trust?.[npc] ?? 45}</strong>
              <meter
                min={0}
                max={100}
                value={state.trust?.[npc] ?? 45}
                aria-label={`${story.npcs[npc].name}关系`}
              />
            </div>
          ))}
        </div>
        <p className={s.muted}>
          熟悉不代表善意。关系影响对方愿意透露多少；公开记录仍是另一条查证路径。
        </p>
        <p className={s.muted}>
          舆论 {state.heat}/100 · 达到 60 会触发公司协调。内耗 {state.stress}
          /100 · 达到 80 需先休整。
        </p>
        <div className={s.actions}>
          {actions.map((option) => (
            <div key={option.action}>
              <button
                disabled={disabled || !!option.blocked}
                title={option.blocked || option.tradeoff}
                onClick={() => {
                  if (option.decision) {
                    setChoice(option);
                    setReason("");
                  } else void act(option.action, "", option.target);
                }}
              >
                {option.label}
                {option.blocked === "已完成" ? " ✓" : ""}
              </button>
              {option.blocked && option.blocked !== "已完成" && (
                <small>{option.blocked}</small>
              )}
            </div>
          ))}
        </div>
        {choice && (
          <form
            className={s.confirmation}
            aria-label="确认剧情选择"
            onSubmit={(e) => {
              e.preventDefault();
              if (disabled || reason.trim().length < 2) return;
              void act(choice.action, reason.trim(), choice.target);
              setChoice(null);
            }}
          >
            <h3>{choice.label}</h3>
            <p>{choice.tradeoff}</p>
            <label>
              我为什么这样选
              <textarea
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="例如：我希望先保住项目，也留下后续追查的依据。"
              />
            </label>
            <small>2—500 字，保存到本局结果卡；下载前可以回看。</small>
            <div>
              <button disabled={disabled || reason.trim().length < 2}>
                确认这个选择
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setChoice(null)}
              >
                再想想
              </button>
            </div>
          </form>
        )}
        <h3>
          已取得的记录 <small>虚构剧情素材</small>
        </h3>
        {!data?.records?.length && (
          <p className={s.muted}>
            还没有取得记录。先向当事人核对，解锁的材料会保存在这里。
          </p>
        )}
        {data?.records?.map((record) => (
          <details className={s.record} key={record.id}>
            <summary>{record.title}</summary>
            <p>{record.text}</p>
          </details>
        ))}
        <details className={s.views}>
          <summary>换个角度想 · 知乎观点</summary>
          {views.map((v) => (
            <article key={v.url}>
              <h4>{v.title}</h4>
              <p>{v.text}</p>
              <a href={v.url} target="_blank" rel="noreferrer">
                {v.author} · {v.source_title} ↗
              </a>
              <small>
                {v.provenance} 获取于 {v.retrieved}
              </small>
            </article>
          ))}
        </details>
      </details>
    </section>
  );
}
