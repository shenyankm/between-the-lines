const defaultActBackground = "/assets/office.png";

export const actBackgrounds = [
  "/assets/office-morning.png",
  "/assets/cafeteria-noon.png",
  "/assets/finance-rain.png",
  "/assets/meeting-morning.png",
  defaultActBackground,
];

/** Background for an act; falls back to the default when the index is out of range. */
export function actBackground(act: number): string {
  return actBackgrounds[act] ?? defaultActBackground;
}

// These are authored inner monologues, never private facts sent to NPC agents.
export const interludes: Record<
  number,
  { image: string; location: string; time: string; text: string }
> = {
  1: {
    image: "/assets/bedroom-night.png",
    location: "卧室 · 把注意力还给自己",
    time: "周五 · 夜间",
    text: "回到家，我把手机扣在桌上。谢川常把我的烦恼说成敏感，妈妈又希望我回县城安稳生活。可我的感受，不必等别人认同才算数。想起学姐谈过的关系：有的相互支持，有的拉扯，有的靠合作维系，也有的只留下消耗。今晚，我先分清事实与感受，再决定下一步。",
  },
  2: {
    image: "/assets/corridor-evening.png",
    location: "走廊 · 从流程回到事实",
    time: "周二 · 下班前",
    text: "离开财务窗口，走廊里的声音渐渐远了。我不需要在每一次试探中证明自己好相处。哪些材料已经提交，哪些节点仍需跟进，都可以清楚记录。下一次走进会议室，我要带上事实，也带上自己的边界。",
  },
};
