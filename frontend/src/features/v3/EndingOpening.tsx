import { Button, Card } from "@heroui/react";
import { useState } from "react";
import type { StateV3 } from "./Work";
import s from "./EndingOpening.module.css";

export function EndingOpening({
  state,
  onContinue,
}: {
  state: StateV3;
  onContinue: () => void;
}) {
  const [step, setStep] = useState(0);
  const leaving = state.exit_draft?.submitted;
  const intention = state.relationship?.intention ?? "undecided";
  const boundary = !!state.relationship?.facts?.boundary;
  const work = state.work;
  const narrator = [
    leaving
      ? "几次事件之后，周菱菱已经提交了退出申请。这一局的记录，停在她作出的选择上。"
      : intention === "undecided"
        ? "几次事件之后，周菱菱终于需要回答一个问题：\n一段让自己不断猜测、解释和自责的关系，还要继续维持吗？"
        : "几次事件之后，周菱菱已经表达了自己的关系选择。接下来，回看这一局实际留下的记录。",
    work?.purchase === "approved"
      ? "采购申请已经通过审核。"
      : "采购事项尚未完成审批。",
    work?.facts?.delivered
      ? "项目交付已经留下记录。"
      : "项目尚无完成交付的记录，后续工作仍需安排。",
  ].join("\n\n");
  const player = leaving
    ? `我已经提交了${state.exit_draft?.kind === "transfer" ? "转岗" : state.exit_draft?.kind === "withdraw" ? "退出项目" : "离职"}申请。\n这次选择已经留下记录，接下来的安排仍要一步一步落实。`
    : boundary
      ? "我曾经以为，只要我再体谅一点，再退一步，关系就会恢复原样。\n但现在我开始明白，边界不是翻脸，拒绝也不是恶意。\n" +
        (intention === "professional"
          ? "我已经选择只保留职业关系，工作合作仍按职责进行。"
          : intention === "friendship"
            ? "我表达了保留友谊的意愿，后续是否尊重边界，还要看实际行动。"
            : "我可以选择留下，但不能继续忽略自己的感受。")
      : "这段关系接下来如何相处，我可以按自己的经历作出选择。\n表达边界、保留距离，或继续沟通，都不需要替自己承诺原谅或释然。";
  return (
    <Card className={s.opening} role="region" aria-label="终幕开屏">
      <small>终幕 · 结算页</small>
      <h1>几次事件之后</h1>
      <div className={s.dialogue} aria-live="polite">
        <h2>{step === 0 ? "旁白" : "周菱菱"}</h2>
        <p>{step === 0 ? narrator : player}</p>
      </div>
      <footer>
        <span>{step + 1} / 2</span>
        <Button onClick={() => (step === 0 ? setStep(1) : onContinue())}>
          {step === 0 ? "继续" : "查看本局结算"}
        </Button>
      </footer>
    </Card>
  );
}
