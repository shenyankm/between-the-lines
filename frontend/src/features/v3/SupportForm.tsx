import { Form, TextArea, Button } from "@heroui/react";
import { useState } from "react";
import { Actions, type Act, type Option, type StateV3 } from "./Work";

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
  return (
    <section aria-label="请假与求助申请">
      <h3>请假与求助</h3>
      <Form
        onSubmit={(event) => {
          event.preventDefault();
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
        <Button variant="primary" type="submit" isDisabled={busy || processing}>
          保存并预览申请
        </Button>
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
          {current.approval && <p>{current.approval.detail}</p>}
          <Actions
            options={options.filter((option) =>
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
