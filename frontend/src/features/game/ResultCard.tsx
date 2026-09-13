import { useState } from "react";
import type { GameState, PlayState, Story } from "../../types";
import s from "./Investigation.module.css";

const labels: Record<string, string> = {
  settle_purchase: "私下纠正采购流程",
  escalate_purchase: "提交采购延误记录",
  resolve_rumor: "私下纠正转述",
  publish_rumor: "公开完整上下文",
};
export function resultLines(
  state: GameState,
  data?: PlayState["investigation"],
) {
  const decisions = state.decisions ?? [];
  const lines = [
    "言外之意 · 我的选择",
    state.ending ?? "故事未结束",
    "这是一段虚构职场经历，不是人格测评。",
  ];
  for (const d of decisions)
    lines.push(labels[d.action] ?? d.action, "我的理由：" + d.reason);
  if (!decisions.length)
    lines.push(
      "本局未填写调查选择理由。",
      ...state.flags
        .filter((f) =>
          [
            "boundary",
            "confronted",
            "clarified",
            "rumor_documented",
            "delivered",
          ].includes(f),
        )
        .map(
          (f) =>
            ({
              boundary: "明确表达边界",
              confronted: "当众质问孙淼",
              clarified: "公开澄清传言",
              rumor_documented: "请张工私下核实",
              delivered: "完成项目交付",
            })[f] ?? f,
        ),
    );
  lines.push(
    "我掌握的记录：" +
      (data?.records?.map((r) => r.title).join("、") || "未取得调查记录"),
  );
  lines.push("选择带来的变化", ...(state.consequences ?? []));
  return lines;
}
export function ResultCard({
  state,
  data,
  story,
}: {
  state: GameState;
  data?: PlayState["investigation"];
  story: Story;
}) {
  const [message, setMessage] = useState("");
  const lines = resultLines(state, data);
  async function download() {
    try {
      await document.fonts.ready;
      const canvas = document.createElement("canvas"),
        ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建图片");
      ctx.font = '28px "PingFang SC", "Microsoft YaHei", SimHei, sans-serif';
      const wrapped: string[] = [];
      for (const line of lines) {
        let part = "";
        for (const ch of line) {
          if (ch === "\n" || ctx.measureText(part + ch).width > 912) {
            wrapped.push(part);
            part = ch === "\n" ? "" : ch;
          } else part += ch;
        }
        if (part) wrapped.push(part);
        wrapped.push("");
      }
      canvas.width = 1080;
      canvas.height = Math.max(1350, 160 + wrapped.length * 43);
      ctx.fillStyle = "#131f2c";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = '28px "PingFang SC", "Microsoft YaHei", SimHei, sans-serif';
      wrapped.forEach((line, i) => {
        ctx.fillStyle = i === 0 ? "#d4b68c" : "#e4e9ee";
        ctx.fillText(line, 84, 95 + i * 43);
      });
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("图片生成失败"))),
          "image/png",
        ),
      );
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = "言外之意-我的选择.png";
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("结果卡已生成，可在下载中查看并分享。");
    } catch {
      setMessage("图片生成失败，请使用复制文字。");
    }
  }
  return (
    <section className={s.result} aria-label="我的结果卡">
      <h2>我为什么这样选</h2>
      <p className={s.muted}>
        记录本局行动、你填写的理由与代价。熟悉度不是善恶评分，也不是人格测评。
      </p>
      {lines.slice(3).map((line, i) => (
        <p key={i}>{line}</p>
      ))}
      <div className={s.actions}>
        <button onClick={() => void download()}>下载结果卡</button>
        <button
          onClick={() =>
            void navigator.clipboard.writeText(lines.join("\n\n")).then(
              () => setMessage("结果文字已复制。"),
              () => setMessage("复制失败，可以选择上方文字手动复制。"),
            )
          }
        >
          复制分享文字
        </button>
      </div>
      <p role="status">{message}</p>
      <details className={s.views}>
        <summary>再看看不同观点</summary>
        {(story.community ?? []).map((v) => (
          <article key={v.url}>
            <h4>{v.title}</h4>
            <p>{v.text}</p>
            <a href={v.url} target="_blank" rel="noreferrer">
              {v.author} · 阅读原讨论 ↗
            </a>
            <small>{v.provenance}</small>
          </article>
        ))}
      </details>
    </section>
  );
}
