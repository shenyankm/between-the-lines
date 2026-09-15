import type { StateV3 } from "./Work";

const endingVisuals = {
  rules_rewritten: {
    code: "E01",
    asset: "rules",
    subtitle: "规则改变 · 边界有据",
  },
  professional_boundary: {
    code: "E02",
    asset: "boundary",
    subtitle: "保持距离 · 工作有界",
  },
  limited_repair: {
    code: "E03",
    asset: "repair",
    subtitle: "承认伤害 · 谨慎重建",
  },
  active_exit: {
    code: "E04",
    asset: "exit",
    subtitle: "行动已启动 · 后续待完成",
  },
  career_cost: { code: "E05", asset: "cost", subtitle: "后果已成 · 代价未消" },
  unresolved: {
    code: "E06",
    asset: "unresolved",
    subtitle: "本局已收束 · 问题仍待解决",
  },
} as const;

export function endingVisual(state: StateV3) {
  const id = state.outcome?.id;
  return id && id in endingVisuals ? endingVisuals[id] : null;
}
