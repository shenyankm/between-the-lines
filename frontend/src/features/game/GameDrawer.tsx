import { Check, ChevronRight, Sparkles, X } from "lucide-react";
import s from "../../App.module.css";
import type { Action, GameEvent, Npc, Save, Story } from "../../types";

import type { Panel } from "../../store";
export function GameDrawer({
  dialogRef,
  panel,
  setPanel,
  story,
  state,
  npc,
  selectNpc,
  disabled,
  act,
  events,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  panel: Panel;
  setPanel: (panel: Panel) => void;
  story: Story;
  state: Save["state"];
  npc: Npc;
  selectNpc: (npc: Npc) => void;
  disabled: boolean;
  act: (action: Action, text?: string, target?: Npc) => Promise<void>;
  events: GameEvent[];
}) {
  return (
    <>
      {/* Backdrop click is a pointer-only convenience: the native <dialog>
          already gives keyboard users the same dismissal path, because
          Escape fires onCancel above. Both a11y rules model the element as
          a non-interactive static node and miss that native behaviour. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- native <dialog> keyboard parity via Esc/onCancel */}
      <dialog
        ref={dialogRef}
        className={s.drawer}
        onCancel={() => setPanel(null)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setPanel(null);
        }}
      >
        <div className={s.drawerInside}>
          <div className={s.drawerHeader}>
            <h2>
              {
                {
                  phone: "手机",
                  work: "工作系统",
                  tips: "锦囊",
                  history: "故事回顾",
                }[panel || "phone"]
              }
            </h2>
            <button aria-label="关闭面板" onClick={() => setPanel(null)}>
              <X />
            </button>
          </div>
          {panel === "phone" && (
            <>
              <p className={s.muted}>联系人</p>
              {(Object.keys(story.npcs) as Npc[]).map((key) => (
                <button
                  className={`${s.contact} ${key === npc ? s.selectedContact : ""}`}
                  key={key}
                  onClick={() => {
                    selectNpc(key);
                    setPanel(null);
                  }}
                >
                  <img
                    className={s.avatar}
                    src={story.npcs[key].portrait}
                    alt=""
                  />
                  <span>
                    <strong>{story.npcs[key].name}</strong>
                    <small>{story.npcs[key].role}</small>
                  </span>
                  <ChevronRight size={18} />
                </button>
              ))}
              <article className={s.note}>
                <span className={s.overline}>朋友圈 · 王会计</span>
                <p>感谢大家的祝福，正式开启退休生活！</p>
                <small>
                  {state.flags.includes("wang_contacted")
                    ? "已发送私人祝福"
                    : "你还没有联系王会计"}
                </small>
              </article>
            </>
          )}
          {panel === "work" && (
            <>
              <span className={s.overline}>RD-2026-017</span>
              <h3>催化剂优化 · 加急采购</h3>
              <p className={s.muted}>
                {state.procurement === "approved"
                  ? "审核已通过，材料可以进入采购。"
                  : "当前状态：等待财务审核"}
              </p>
              {[
                { key: "requirements", label: "确认材料要求" },
                { key: "materials", label: "提交报价与用途说明" },
                { key: "reported", label: "同步项目进度风险" },
                { key: "supported", label: "获得研发支持" },
              ].map((item) => (
                <div className={s.checkRow} key={item.key}>
                  <span
                    className={
                      state.flags.includes(item.key) ? s.checked : s.unchecked
                    }
                  >
                    {state.flags.includes(item.key) ? (
                      <Check size={14} />
                    ) : null}
                  </span>
                  {item.label}
                </div>
              ))}
              <div className={s.note}>
                先与孙淼或李姐对话确认材料要求；补齐后，请李姐审核。张工可以提供项目支持，但不能代替财务审批。
              </div>
              {state.act > 0 && !state.ending && (
                <button
                  className={s.textButton}
                  disabled={disabled}
                  onClick={() => {
                    if (window.confirm("确定让这段故事以主动离开结束吗？")) {
                      void act("leave");
                      setPanel(null);
                    }
                  }}
                >
                  选择离开当前环境
                </button>
              )}
            </>
          )}
          {panel === "tips" &&
            story.tips.map((tip) => (
              <article className={s.note} key={tip.title}>
                <Sparkles size={20} />
                <h3>{tip.title}</h3>
                <p>{tip.text}</p>
                <small>{tip.source}</small>
              </article>
            ))}
          {panel === "history" && (
            <>
              {events.length === 0 && <p>还没有记录。</p>}
              {events.map((event) => (
                <article className={s.historyItem} key={event.id}>
                  <small>
                    {event.kind === "player"
                      ? "周凌"
                      : event.kind === "work"
                        ? "工作记录"
                        : event.kind === "epilogue"
                          ? "结局回顾"
                          : story.npcs[event.npc]?.name}
                  </small>
                  <p>{event.text}</p>
                </article>
              ))}
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
