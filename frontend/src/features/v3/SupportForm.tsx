import { Form, TextArea, Button } from "@heroui/react";
import {
  useFormDraft,
  FormDraftNotice,
  type DraftIdentity,
} from "./useFormDraft";
import { useState } from "react";
import {
  Actions,
  unavailableReason,
  type Act,
  type Option,
  type StateV3,
} from "./Work";

export function SupportForm({
  state,
  options,
  act,
  busy,
  draftIdentity,
}: {
  state: StateV3;
  options: Option[];
  act: Act;
  busy: boolean;
  draftIdentity?: DraftIdentity;
}) {
  const current = state.support_requests?.at(-1);
  const selection = useFormDraft(draftIdentity, "support-selection", {
    kind: current?.kind ?? "leave",
  });
  const kind = selection.value.kind === "help" ? "help" : "leave";
  const fields = useFormDraft(draftIdentity, `support:${kind}`, {
    reason: current?.kind === kind ? current.reason : "",
    plan: current?.kind === kind ? current.plan : "",
  });
  const reason = fields.value.reason ?? "",
    plan = fields.value.plan ?? "";
  const [errors, setErrors] = useState({ reason: false, plan: false });
  const processing = !!current?.submitted && !current.completion;
  const disabledReason = processing
    ? "申请已提交，等待处理完成。"
    : unavailableReason(options, "draft_support", busy);
  return (
    <section aria-label="请假与求助申请">
      <h3>请假与求助</h3>
      <FormDraftNotice
        storageIssue={fields.storageIssue || selection.storageIssue}
      />
      <Button
        variant="secondary"
        isDisabled={processing}
        onClick={() => fields.update({ reason: "", plan: "" })}
      >
        清空本类申请输入
      </Button>
      <Form
        onSubmit={(event) => {
          event.preventDefault();
          if (disabledReason) return;
          const invalid = { reason: !reason.trim(), plan: !plan.trim() };
          setErrors(invalid);
          if (invalid.reason || invalid.plan) return;
          act("draft_support", "sun", {
            params: { support_kind: kind, reason, plan },
          });
        }}
      >
        <label>
          申请事项
          <select
            value={kind}
            disabled={processing}
            onChange={(event) => selection.update({ kind: event.target.value })}
          >
            <option value="leave">请假休息</option>
            <option value="help">请求协作支持</option>
          </select>
        </label>
        <label>
          原因
          <TextArea
            required
            maxLength={1000}
            value={reason}
            disabled={processing}
            onChange={(event) => fields.update({ reason: event.target.value })}
            aria-invalid={errors.reason}
            aria-describedby={
              errors.reason ? "support-reason-error" : undefined
            }
          />
        </label>
        {errors.reason && (
          <p id="support-reason-error" role="alert">
            请填写原因，不能只输入空格。
          </p>
        )}
        <label>
          交接或分工安排
          <TextArea
            required
            maxLength={1000}
            value={plan}
            disabled={processing}
            onChange={(event) => fields.update({ plan: event.target.value })}
            aria-invalid={errors.plan}
            aria-describedby={errors.plan ? "support-plan-error" : undefined}
          />
        </label>
        {errors.plan && (
          <p id="support-plan-error" role="alert">
            请填写交接或分工安排。
          </p>
        )}
        <Button
          variant="primary"
          type="submit"
          isDisabled={!!disabledReason}
          aria-describedby={disabledReason ? "support-hint" : undefined}
        >
          保存并预览申请
        </Button>
        {disabledReason && <p id="support-hint">{disabledReason}</p>}
      </Form>
      {current && (
        <article>
          <h4>{current.kind === "leave" ? "请假" : "求助"}申请预览</h4>
          <p>{current.reason}</p>
          <p>工作安排：{current.plan}</p>
          <p>
            {current.completion
              ? "已落实"
              : current.approval
                ? "已获批，等待落实"
                : current.submitted
                  ? "已提交，等待处理"
                  : "草稿，尚未提交"}
          </p>
          {current.submitted && <p>我：已提交上述申请与工作安排。</p>}
          {current.approval ? (
            <section aria-label="负责人处理答复">
              <h4>张工的答复 · 已记录</h4>
              <p>{current.approval.detail}</p>
              <p>批准与实际落实不同。你可以稍后落实；此前不会记录恢复效果。</p>
            </section>
          ) : (
            current.submitted && (
              <p>尚未记录负责人的答复。查看处理意见时才会推进到答复场景。</p>
            )
          )}
          {current.completion && <p>实际落实：{current.completion.detail}</p>}
          <Actions
            options={options.filter(
              (option) =>
                !option.completed &&
                [
                  "submit_support",
                  "review_support",
                  current.kind === "leave" ? "rest" : "request_help",
                ].includes(option.action),
            )}
            act={act}
            busy={busy}
          />
        </article>
      )}
      <details>
        <summary>申请处理记录</summary>
        {state.support_requests?.map((request, i) => (
          <article key={i}>
            <h4>
              第 {i + 1} 份 · {request.kind === "leave" ? "请假" : "求助"}
            </h4>
            {[
              request.draft,
              request.submitted,
              request.approval,
              request.completion,
            ].map(
              (record) =>
                record && <p key={record.event_id}>{record.detail}</p>,
            )}
          </article>
        ))}
      </details>
    </section>
  );
}
