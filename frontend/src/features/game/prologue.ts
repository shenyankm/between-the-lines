// Authored scene text, adapted from the supplied design document. Reading these
// pages never submits a player action or creates a fabricated conversation event.
export const prologue = [
  {
    title: "我的身份",
    speaker: "周菱菱",
    role: "研发部 · 研发专员",
    portrait: "/assets/zhou-editorial.png",
    text: "我是周菱菱，一名研发专员。写方案、跟进项目、整理会议纪要，我习惯把事情留痕、做完整。孙淼是我的同期同事，也是我曾经很信任的朋友。李姐负责财务审核，张工是我的上级。",
  },
  {
    title: "那句玩笑",
    speaker: "孙淼",
    role: "财务出纳 · 同期同事",
    portrait: "/assets/sun-editorial.png",
    text: "周一早上，我穿着新买的黑色羽绒服来到公司。孙淼看了一眼：“怎么说呢……有点像野猪。”我还没接话，她又笑着补上：“哎呀，我开玩笑的，你不会真的生气吧？”",
  },
  {
    title: "我的感受",
    speaker: "周菱菱",
    role: "内心独白",
    portrait: "/assets/zhou-editorial.png",
    text: "先说一句难听的话，再补一句“开玩笑”。如果我不高兴，是不是就成了太敏感？我还没有想好怎样回应，但至少，我想认真对待自己的不舒服。接下来怎样相处，由我决定。",
  },
] as const;
