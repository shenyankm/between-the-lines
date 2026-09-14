import type { StateV3 } from "./Work";

export function ClosingPreview({ state }: { state: StateV3 }) {
  const facts = state.work?.facts ?? {};
  return (
    <section aria-label="本局收束预览">
      <h3>按现有事实收束</h3>
      <p>确认前仍可返回处理。这里只核对当前记录，不提前确定结局。</p>
      <ul>
        {[
          ["采购", "purchase_submitted", "purchase_approved"],
          ["项目交付", "purchase_submitted", "delivered"],
          ["传言澄清", "rumor_spread", "clarified"],
          ["职责转交纠正", "career_loss", "loss_corrected"],
        ].map(([label, started, done]) => (
          <li key={label}>
            {label}：
            {facts[done!]
              ? `已完成 · ${facts[done!]!.detail}`
              : facts[started!]
                ? "已发生，尚未解决"
                : "尚未发生"}
          </li>
        ))}
      </ul>
      <p>
        私人关系意愿：
        {state.relationship?.intention === "friendship"
          ? "希望保留友谊，补救和信任仍以实际记录为准"
          : state.relationship?.intention === "professional"
            ? "仅保留职业关系"
            : "暂未决定"}
        。
      </p>
      {state.exit_draft?.submitted && (
        <p>退出申请已提交；审批和交接尚未完成。</p>
      )}
    </section>
  );
}
