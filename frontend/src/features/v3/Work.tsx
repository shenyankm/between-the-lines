import { useState } from "react";
import { SupportForm } from "./SupportForm";
import type { Action, Npc, TurnInput } from "../../types";
import type { components } from "../../generated/api";
import s from "./V3.module.css";
export type StateV3 = components["schemas"]["GameStateV3"];
export type Option = components["schemas"]["AvailableAction"];
export type Act = (
  action: Action,
  npc?: Npc,
  extra?: Partial<TurnInput>,
) => void;
export function Actions({
  options,
  act,
  busy,
}: {
  options: Option[];
  act: Act;
  busy: boolean;
}) {
  return (
    <div className={s.actions}>
      {options.map((a) => (
        <button
          key={a.action}
          disabled={busy || !a.enabled}
          title={a.reason || a.effect}
          onClick={() => act(a.action, a.target ?? "sun")}
        >
          {a.completed ? "✓ " : ""}
          {a.label}
          {!a.enabled && !a.completed && <small>{a.reason}</small>}
        </button>
      ))}
    </div>
  );
}
const procurement = new Set([
  "request_materials",
  "dispute_return",
  "report",
  "support_project",
  "approve_purchase",
  "joint_review",
  "request_extension",
  "deliver",
  "project_review",
  "correct_loss",
  "confirm_responsibility",
  "change_rules",
  "apply_rules",
  "review_clarification",
]);
export function Work({
  state,
  options,
  act,
  busy,
}: {
  state: StateV3;
  options: Option[];
  act: Act;
  busy: boolean;
}) {
  const [purpose, setPurpose] = useState("实验项目耗材采购");
  const [evidence, setEvidence] = useState<("quote" | "purpose" | "urgency")[]>(
    [],
  );
  const [kind, setKind] = useState<"resign" | "transfer" | "withdraw">(
    "resign",
  );
  const [reason, setReason] = useState("");
  const [tab, setTab] = useState("purchase");
  const enabled = (name: Action) =>
    !busy && options.some((a) => a.action === name && a.enabled);
  return (
    <>
      <nav className={s.tabs}>
        {(
          [
            ["purchase", "采购与项目"],
            ["hr", "人事申请"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === "purchase" ? (
        <>
          <h3>
            采购申请 ·{" "}
            {
              {
                pending: "尚未开始",
                returned: "已退回",
                review: "等待审核",
                approved: "已通过",
              }[state.work?.purchase ?? "pending"]
            }
          </h3>
          <p>
            普通采购需报价及用途说明；加急依据仅在申请加急时使用。原始申请与每次处理意见分别保留。
          </p>
          {!state.work?.submissions?.length && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                act("submit_purchase", "sun", { params: { purpose } });
              }}
            >
              <label>
                实验用途
                <textarea
                  value={purpose}
                  maxLength={1000}
                  required
                  onChange={(e) => setPurpose(e.target.value)}
                />
              </label>
              <button disabled={!enabled("submit_purchase")}>
                提交第一版申请
              </button>
            </form>
          )}
          <fieldset>
            <legend>游戏内材料附件</legend>
            {(
              [
                ["quote", "报价单", "供应商报价已核对；用于本项目实验耗材。"],
                [
                  "purpose",
                  "用途说明",
                  "材料用于当前实验项目，与交付报告对应。",
                ],
                [
                  "urgency",
                  "加急依据",
                  "排期与项目节点说明；延期需由张工确认。",
                ],
              ] as const
            ).map(([id, label, detail]) => (
              <div key={id}>
                <label>
                  <input
                    type="checkbox"
                    checked={evidence.includes(id)}
                    onChange={(e) =>
                      setEvidence((xs) =>
                        e.target.checked
                          ? [...xs, id]
                          : xs.filter((x) => x !== id),
                      )
                    }
                  />
                  {label}
                </label>
                <details>
                  <summary>查看材料</summary>
                  <p>{detail}</p>
                </details>
              </div>
            ))}
          </fieldset>
          <button
            disabled={
              !enabled("supplement") ||
              !evidence.includes("quote") ||
              !evidence.includes("purpose")
            }
            onClick={() => act("supplement", "sun", { params: { evidence } })}
          >
            提交所选材料与说明
          </button>
          <h3>处理时间线</h3>
          {state.work?.submissions?.length ? (
            <ol>
              {state.work.submissions.map((row, i) => (
                <li key={i}>
                  材料第 {row.version} 版 ·{" "}
                  {row.version === 1 ? "昨日提交" : "本次补充"}
                  <p>{row.purpose}</p>
                  <p>
                    附件：
                    {row.evidence
                      .map(
                        (id) =>
                          ({
                            quote: "报价单",
                            purpose: "用途说明",
                            urgency: "加急依据",
                          })[id as "quote" | "purpose" | "urgency"] ?? id,
                      )
                      .join("、")}
                  </p>
                  <small>事件 {row.event_id.slice(0, 8)}</small>
                </li>
              ))}
            </ol>
          ) : (
            <p>尚未提交。聊天不会推进截止时间。</p>
          )}
          <ol aria-label="审核处理记录">
            {state.work?.reviews?.map((row, i) => (
              <li key={i}>
                {row.time} ·{" "}
                {
                  { sun: "孙淼", li: "李姐", zhang: "张工", wang: "王会计" }[
                    row.actor
                  ]
                }{" "}
                · {row.decision}
                <p>
                  针对材料第 {row.version} 版：{row.detail}
                </p>
              </li>
            ))}
          </ol>
          <Actions
            options={options.filter((a) => procurement.has(a.action))}
            act={act}
            busy={busy}
          />
        </>
      ) : (
        <>
          <SupportForm state={state} options={options} act={act} busy={busy} />
          <h3>退出申请</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act("draft_exit", "sun", { params: { kind, reason } });
            }}
          >
            <label>
              申请类型
              <select
                value={kind}
                onChange={(e) =>
                  setKind(e.target.value as "resign" | "transfer" | "withdraw")
                }
              >
                <option value="resign">离职</option>
                <option value="transfer">调岗</option>
                <option value="withdraw">退出合作</option>
              </select>
            </label>
            <label>
              申请理由
              <textarea
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button disabled={!enabled("draft_exit")}>保存并预览</button>
          </form>
          {state.exit_draft && (
            <section className={s.notice}>
              <h4>
                {state.exit_draft.submitted
                  ? "退出申请 · 已提交"
                  : "申请预览 · 尚未提交"}
              </h4>
              {state.exit_draft.submitted && (
                <p>手续仍待后续办理，不代表已获批准或完成交接。</p>
              )}
              <p>
                {
                  { resign: "离职", transfer: "调岗", withdraw: "退出合作" }[
                    state.exit_draft.kind
                  ]
                }
              </p>
              <p>{state.exit_draft.reason}</p>
              <Actions
                options={options.filter((a) => a.action === "submit_exit")}
                act={act}
                busy={busy}
              />
            </section>
          )}
        </>
      )}
    </>
  );
}
