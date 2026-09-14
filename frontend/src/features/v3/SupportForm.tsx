import { Form, TextArea, Button } from "@heroui/react";
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
}: {
  state: StateV3;
  options: Option[];
  act: Act;
  busy: boolean;
}) {
  const [kind, setKind] = useState<"leave" | "help">("leave");
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState("");
  const current = state.support_requests?.at(-1);
  const processing = !!current?.submitted && !current.completion;
  const disabledReason = processing
    ? "申请已提交，等待处理完成。"
    : unavailableReason(options, "draft_support", busy);
  return (
    <section aria-label="请假与求助申请">
      <h3>请假与求助</h3>
      <Form
        onSubmit={(event) => {
          event.preventDefault();
          if (disabledReason) return;
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
            onChange={(event) =>
              setKind(event.target.value as "leave" | "help")
            }
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
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <label>
          交接或分工安排
          <TextArea
            required
            maxLength={1000}
            value={plan}
            disabled={processing}
            onChange={(event) => setPlan(event.target.value)}
          />
        </label>
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
