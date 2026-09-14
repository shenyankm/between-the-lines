import type { StateV3 } from "./Work";

export const endingVisuals = {
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

export function expressionStyle(state: StateV3) {
  const evidence = Object.keys(state.relationship?.facts ?? {}).some((key) =>
    ["boundary", "sun_cut", "friendship", "sun_observe"].includes(key),
  );
  return state.relationship?.intention === "professional"
    ? "清晰守界"
    : state.relationship?.intention === "friendship"
      ? "审慎修复"
      : evidence
        ? "主动表达"
        : "保留空间";
}

export function shareLines(state: StateV3, facts: string[]) {
  return [
    `《言外之意》 · 本局已收束${endingVisual(state) ? ` · ${endingVisual(state)!.code}` : ""}`,
    state.outcome?.title ?? state.ending ?? "本局记录",
    ...(endingVisual(state) ? [endingVisual(state)!.subtitle] : []),
    `本局表达倾向：${expressionStyle(state)}`,
    `舆论温度 ${state.heat} · 专业信用 ${state.credit}`,
    `内耗值 ${state.rumination ?? 25} · 工作压力 ${state.pressure ?? 25}`,
    ...facts,
    "这是本局选择的记录，不是心理测评。",
  ];
}
