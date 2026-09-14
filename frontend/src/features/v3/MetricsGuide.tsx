import type { StateV3 } from "./Work";
import { EventEvidence } from "./EventEvidence";

export function MetricsGuide({
  state,
  saveId,
}: {
  state: StateV3;
  saveId: string;
}) {
  const review = state.work?.facts?.company_review;
  return (
    <details>
      <summary>指标如何影响本局</summary>
      <p>
        数值记录本局经历，不能代替工作证据，也不直接决定六种结局。角色不会读取你的私人心理数值。
      </p>
      <ul>
        <li>
          专业信用：描述工作记录与表达带来的认可变化。高信用不能绕过材料、审批或交付。
        </li>
        <li>
          内耗：描述主角体验，用于结局回顾；高内耗不会自动导致失败、离职或替你作私人决定。
        </li>
        <li>
          工作压力：描述工作负担与休息、分工后的变化；不会自动替你申请休息或定义能力。
        </li>
        <li>
          舆论温度：描述争议关注度。达到 70
          后，下一次行动结算会记录公司核查现有记录；核查不自动判责，也不代替澄清和交付。
        </li>
      </ul>
      <p>
        目前没有按数值高低自动改变 NPC
        语气或审批难度的机制。具体增减及原因见行动回执和完整记录。
      </p>
      {review && (
        <section aria-label="公司核查记录">
          <h3>已发生：公司核查</h3>
          <p>{review.detail}</p>
          <p>职责范围是核查已有工作记录；私人心理状态不向角色公开。</p>
          <EventEvidence saveId={saveId} eventId={review.event_id} />
        </section>
      )}
    </details>
  );
}
