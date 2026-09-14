import { Form, TextArea, Button } from "@heroui/react";
import {
  useFormDraft,
  FormDraftNotice,
  type DraftIdentity,
} from "./useFormDraft";
import { useEffect, useRef, useState } from "react";
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
export function unavailableReason(
  options: Option[],
  action: Action,
  busy: boolean,
): string {
  if (busy) return "当前行动正在处理，请稍候。";
  const option = options.find((item) => item.action === action);
  return option?.enabled
    ? ""
    : option?.reason || "当前故事进度暂不能执行此操作。";
}
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
        <Button
          variant="secondary"
          key={a.action}
          data-action={a.action}
          isDisabled={busy || !a.enabled}
          aria-description={a.reason || a.effect}
          onClick={() => act(a.action, a.target ?? "sun")}
        >
          {a.completed ? "✓ " : ""}
          {a.label}
          {!a.enabled && !a.completed && <small>{a.reason}</small>}
        </Button>
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
  draftIdentity,
  requireMentions = false,
}: {
  state: StateV3;
  options: Option[];
  act: Act;
  busy: boolean;
  draftIdentity?: DraftIdentity;
  requireMentions?: boolean;
}) {
  const supplement = useFormDraft(draftIdentity, "supplement", {
    note: "",
    mentions: "",
    evidence: "",
    kind: state.work?.submissions?.at(-1)?.kind ?? "standard",
  });
  const purchaseKind =
    supplement.value.kind === "urgent" ? "urgent" : "standard";
  const setPurchaseKind = (kind: "standard" | "urgent") =>
    supplement.update({ kind });
  const note = supplement.value.note ?? "";
  const recipients = ["sun", "li", "zhang"] as const;
  const mentions = recipients.filter((id) =>
    supplement.value.mentions?.split(",").includes(id),
  );
  const evidence = (["quote", "purpose", "urgency"] as const).filter((id) =>
    supplement.value.evidence?.split(",").includes(id),
  );
  const setEvidence = (update: (xs: typeof evidence) => typeof evidence) =>
    supplement.update({ evidence: update(evidence).join(",") });
  const noteInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (requireMentions) {
      noteInput.current?.focus();
      noteInput.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [requireMentions]);
  const purchaseDraft = useFormDraft(draftIdentity, "purchase", {
    purpose: "实验项目耗材采购",
  });
  const purpose = purchaseDraft.value.purpose ?? "";
  const latest = state.work?.submissions?.at(-1);
  const review = state.work?.reviews?.at(-1);
  const names = { sun: "孙淼", li: "李姐", zhang: "张工", wang: "王会计" };
  const status = {
    pending: "尚未开始",
    returned: "已退回",
    review: "等待审核",
    approved: "已通过",
  }[state.work?.purchase ?? "pending"];
  const exit = useFormDraft(draftIdentity, "exit", {
    kind: state.exit_draft?.kind ?? "resign",
    reason: state.exit_draft?.reason ?? "",
  });
  const kind = ["resign", "transfer", "withdraw"].includes(
    exit.value.kind ?? "",
  )
    ? exit.value.kind!
    : "resign";
  const reason = exit.value.reason ?? "";
  const [reasonError, setReasonError] = useState(false);
  const [tab, setTab] = useState("purchase");
  const enabled = (name: Action) =>
    !busy && options.some((a) => a.action === name && a.enabled);
  const materialReason =
    unavailableReason(options, "supplement", busy) ||
    ((requireMentions || mentions.length > 0) && !note.trim()
      ? "请填写补充说明。"
      : "") ||
    (requireMentions && mentions.length === 0
      ? "请至少选择一位相关人员。"
      : "") ||
    (!evidence.includes("quote") ||
    !evidence.includes("purpose") ||
    (purchaseKind === "urgent" && !evidence.includes("urgency"))
      ? purchaseKind === "urgent"
        ? "加急申请还需选择加急依据。"
        : "请同时选择报价单和用途说明。"
      : "");
  return (
    <>
      <nav className={s.tabs}>
        {(
          [
            ["purchase", "采购与项目"],
            ["hr", "人事申请"],
          ] as const
        ).map(([id, label]) => (
          <Button
            variant="secondary"
            key={id}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
      </nav>
      {tab === "purchase" ? (
        <div className={s.purchasePage}>
          <header className={s.purchaseHeading}>
            <div>
              <h3>
                试制材料采购{" "}
                <span data-status={state.work?.purchase}>{status}</span>
              </h3>
              <p>用于当前实验项目的材料采购申请</p>
            </div>
            <small>
              把每一件小事，
              <br />
              做成值得的事。
            </small>
          </header>
          <div className={s.workWorkspace}>
            <section className={s.workForm} aria-label="采购申请表">
              <h3>
                采购申请 <small>认真填写，确保信息准确完整</small>
              </h3>
              <h4 className={s.formBand}>申请信息</h4>
              <Form
                id="purchase-application"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (enabled("submit_purchase"))
                    act("submit_purchase", "sun", { params: { purpose } });
                }}
              >
                <div className={s.purchaseFields}>
                  {[
                    ["申请人", "周菱菱"],
                    ["所属部门", "研发工位"],
                    ["材料类别", "实验耗材"],
                    ["数量", "未登记"],
                    ["预算归属", "未登记"],
                    ["预计到货日期", "未登记"],
                  ].map(([label, value]) => (
                    <label key={label}>
                      {label}
                      <input readOnly value={value} />
                    </label>
                  ))}
                  <label className={s.fullField}>
                    采购用途
                    <TextArea
                      aria-label="实验用途"
                      value={latest?.purpose ?? purpose}
                      readOnly={!!latest}
                      maxLength={1000}
                      required
                      onChange={(e) =>
                        purchaseDraft.update({ purpose: e.target.value })
                      }
                    />
                  </label>
                  <label className={s.fullField}>
                    备注
                    <TextArea readOnly value="" placeholder="暂无备注" />
                  </label>
                </div>
              </Form>
              {state.content_revision >= 3 && (
                <label className={s.purchaseKind}>
                  本次采购类型
                  <select
                    value={purchaseKind}
                    onChange={(event) =>
                      setPurchaseKind(
                        event.target.value as "standard" | "urgent",
                      )
                    }
                  >
                    <option value="standard">普通采购</option>
                    <option value="urgent">加急采购（需加急依据）</option>
                  </select>
                </label>
              )}
              {latest && (
                <section className={s.supplementFields}>
                  <label>
                    补充说明
                    <TextArea
                      ref={noteInput}
                      aria-label="补充说明"
                      value={note}
                      maxLength={1000}
                      disabled={busy}
                      onChange={(e) =>
                        supplement.update({ note: e.target.value })
                      }
                    />
                  </label>
                  <fieldset>
                    <legend>@相关人员</legend>
                    {recipients.map((id) => (
                      <label key={id}>
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={mentions.includes(id)}
                          onChange={(e) =>
                            supplement.update({
                              mentions: recipients
                                .filter((x) =>
                                  x === id
                                    ? e.target.checked
                                    : mentions.includes(x),
                                )
                                .join(","),
                            })
                          }
                        />
                        {names[id]} ·{" "}
                        {
                          {
                            sun: "采购经办",
                            li: "财务审核",
                            zhang: "研发负责人",
                          }[id]
                        }
                      </label>
                    ))}
                  </fieldset>
                  <small>
                    提交后通知所选人员并留痕，不代表已读、审批或正式风险汇报。
                  </small>
                  <FormDraftNotice storageIssue={supplement.storageIssue} />
                </section>
              )}
              <fieldset>
                <legend>
                  附件材料 <small>（已选 {evidence.length} 项）</small>
                </legend>
                {(
                  [
                    [
                      "quote",
                      "报价单",
                      "供应商报价已核对；用于本项目实验耗材。",
                    ],
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
                )
                  .filter(
                    ([id]) =>
                      id !== "urgency" ||
                      purchaseKind === "urgent" ||
                      state.content_revision < 3,
                  )
                  .map(([id, label, detail]) => (
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
                        <article className={s.materialDocument}>
                          <h4>{label}</h4>
                          <p>{detail}</p>
                          <p>采购用途：{latest?.purpose ?? purpose}</p>
                          <small>
                            勾选后随本次补充提交，审核结果以审批意见为准。
                          </small>
                        </article>
                      </details>
                    </div>
                  ))}
              </fieldset>
            </section>
            <aside className={s.workReview} aria-label="审批与提交记录">
              <section className={s.reviewCard}>
                <h3>审核意见</h3>
                {review ? (
                  <>
                    <div className={s.reviewer}>
                      <span>{names[review.actor].slice(0, 1)}</span>
                      <div>
                        <strong>{names[review.actor]}</strong>
                        <small>
                          {review.time} · 材料第 {review.version} 版
                        </small>
                      </div>
                      <b data-status={state.work?.purchase}>
                        {review.decision}
                      </b>
                    </div>
                    <p
                      className={s.reviewComment}
                      data-status={state.work?.purchase}
                    >
                      {review.detail}
                    </p>
                  </>
                ) : (
                  <p>暂无审批意见。</p>
                )}
              </section>
              <section className={s.reviewCard}>
                <h3>提交记录</h3>
                {!latest && <p>尚未提交。聊天不会推进截止时间。</p>}
                <ol className={s.submissionTimeline}>
                  {state.work?.submissions?.map((row, i) => (
                    <li key={i}>
                      <strong>
                        {row.version === 1 ? "提交申请" : "补充材料"}
                      </strong>
                      <small>
                        材料第 {row.version} 版 ·{" "}
                        {row.kind === "urgent" ? "加急采购" : "普通采购"}
                      </small>
                      <p>{row.purpose}</p>
                      {row.supplement_note && (
                        <p>补充说明：{row.supplement_note}</p>
                      )}
                      {!!row.mentions?.length && (
                        <p>
                          已通知：
                          {row.mentions.map((id) => names[id]).join("、")}
                        </p>
                      )}
                      <details>
                        <summary>查看提交材料</summary>
                        <p>
                          附件：
                          {row.evidence
                            .map(
                              (id) =>
                                ({
                                  quote: "报价单",
                                  purpose: "用途说明",
                                  urgency: "加急依据",
                                })[id] ?? id,
                            )
                            .join("、") || "无"}
                        </p>
                      </details>
                      {state.work?.reviews
                        ?.filter((r) => r.version === row.version)
                        .map((r, j) => (
                          <div className={s.timelineReview} key={j}>
                            <strong>{r.decision}</strong>
                            <small>
                              {r.time} · {names[r.actor]}
                            </small>
                            <p>
                              {r === review
                                ? `针对材料第 ${r.version} 版，详见审核意见。`
                                : r.detail}
                            </p>
                          </div>
                        ))}
                    </li>
                  ))}
                </ol>
              </section>
            </aside>
          </div>
          <details className={s.workActions}>
            <summary>后续工作事项</summary>
            {options.find(
              (a) => a.action === "project_review" && a.enabled,
            ) && (
              <section className={s.notice} aria-label="项目复核后果">
                <h3>复核前核对</h3>
                <p>
                  {options.find((a) => a.action === "project_review")?.effect}
                </p>
                {options.find((a) => a.action === "project_review")
                  ?.requires_confirmation && (
                  <p>
                    可先处理上方采购与交付事项，或选择“申请延期并获批”；继续复核需要确认。
                  </p>
                )}
              </section>
            )}
            <Actions
              options={options.filter((a) => procurement.has(a.action))}
              act={act}
              busy={busy}
            />
          </details>
          <footer className={s.purchaseFooter}>
            <div>
              <small>
                {purchaseDraft.storageIssue
                  ? "输入暂存失败，请保留输入"
                  : "材料修改 · 尚未提交"}
              </small>
              {!latest && !enabled("submit_purchase") && (
                <p id="purchase-hint">
                  {unavailableReason(options, "submit_purchase", busy)}
                </p>
              )}
              {latest && (
                <p>
                  本次提交：
                  {evidence
                    .map(
                      (id) =>
                        ({
                          quote: "报价单",
                          purpose: "用途说明",
                          urgency: "加急依据",
                        })[id],
                    )
                    .join("、") || "未选材料"}
                  ；通知：
                  {mentions.map((id) => names[id]).join("、") || "不通知"}
                </p>
              )}
              {materialReason && <p id="materials-hint">{materialReason}</p>}
            </div>
            <div>
              {!latest && (
                <Button
                  variant="primary"
                  type="submit"
                  form="purchase-application"
                  isDisabled={!enabled("submit_purchase")}
                  aria-describedby={
                    !enabled("submit_purchase") ? "purchase-hint" : undefined
                  }
                >
                  提交第一版申请
                </Button>
              )}
              <Button
                variant="primary"
                aria-label="提交所选材料与说明"
                aria-describedby={materialReason ? "materials-hint" : undefined}
                isDisabled={!!materialReason}
                onClick={() =>
                  act("supplement", "sun", {
                    params: {
                      evidence,
                      ...(note.trim() ? { supplement_note: note.trim() } : {}),
                      ...(mentions.length ? { mentions } : {}),
                      ...(state.content_revision >= 3
                        ? { purchase_kind: purchaseKind }
                        : {}),
                    },
                  })
                }
              >
                {latest ? "重新提交" : "提交所选材料与说明"}
              </Button>
            </div>
          </footer>
        </div>
      ) : (
        <div className={s.hrPage}>
          <SupportForm
            state={state}
            options={options}
            act={act}
            busy={busy}
            draftIdentity={draftIdentity}
          />
          <h3>退出申请</h3>
          <FormDraftNotice storageIssue={exit.storageIssue} />
          <Button
            variant="secondary"
            isDisabled={!!state.exit_draft?.submitted}
            onClick={() => exit.update({ kind: "resign", reason: "" })}
          >
            清空退出申请输入
          </Button>
          {reasonError && (
            <p id="exit-reason-error" role="alert">
              请填写申请理由，不能只输入空格。
            </p>
          )}
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              if (!enabled("draft_exit")) return;
              if (!reason.trim()) {
                setReasonError(true);
                return;
              }
              setReasonError(false);
              act("draft_exit", "sun", {
                params: {
                  kind: kind as "resign" | "transfer" | "withdraw",
                  reason,
                },
              });
            }}
          >
            <label>
              申请类型
              <select
                value={kind}
                onChange={(e) => exit.update({ kind: e.target.value })}
              >
                <option value="resign">离职</option>
                <option value="transfer">调岗</option>
                <option value="withdraw">退出合作</option>
              </select>
            </label>
            <label>
              申请理由
              <TextArea
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => {
                  exit.update({ reason: e.target.value });
                  setReasonError(false);
                }}
                aria-invalid={reasonError}
                aria-describedby={reasonError ? "exit-reason-error" : undefined}
              />
            </label>
            <Button
              variant="primary"
              type="submit"
              isDisabled={!enabled("draft_exit")}
              aria-describedby={
                !enabled("draft_exit") ? "exit-hint" : undefined
              }
            >
              保存并预览
            </Button>
            {!enabled("draft_exit") && (
              <p id="exit-hint">
                {unavailableReason(options, "draft_exit", busy)}
              </p>
            )}
          </Form>
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
        </div>
      )}
    </>
  );
}
