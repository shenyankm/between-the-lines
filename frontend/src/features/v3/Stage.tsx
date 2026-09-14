import { Button } from "@heroui/react";
import { useEffect, useState } from "react";
import type { Story } from "../../types";
import { imageSource } from "../../images";
import s from "./V3.module.css";

export function speakerSide(speaker: string): "left" | "right" {
  // 周菱菱 stands on the left of the stage and the others on the right; the
  // current speaker's name stays on their own side of the dialogue panel.
  return ["sun", "li", "zhang", "wang", "group"].includes(speaker)
    ? "right"
    : "left";
}
export function Script({
  lines,
  position,
  reduced,
  speed = 35,
  advance,
}: {
  lines: NonNullable<Story["scenes"]>[string];
  position: number;
  reduced: boolean;
  speed?: number;
  advance: () => void;
}) {
  const line = lines[position];
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (reduced || speed === 0 || !line || count >= line.text.length) return;
    const timer = setTimeout(
      () => setCount((n) => Math.min(n + 2, line.text.length)),
      speed,
    );
    return () => clearTimeout(timer);
  }, [line, reduced, count, speed]);
  if (!line) return null;
  const full = reduced || speed === 0 || count >= line.text.length;
  return (
    <Button
      variant="secondary"
      className={s.script}
      onClick={() => {
        if (!full) setCount(line.text.length);
        else {
          setCount(0);
          advance();
        }
      }}
    >
      <strong data-side={speakerSide(line.speaker)}>
        {{
          sun: "孙淼",
          li: "李姐",
          zhang: "张工",
          wang: "王会计",
          narrator: "旁白",
          inner: "内心独白",
          group: "同事群像",
          player: "周菱菱",
        }[line.speaker] ?? "现场"}
      </strong>
      <span>
        <span>{full ? line.text : line.text.slice(0, count)}</span>
        {!full && (
          // The hidden remainder keeps the finished line's height from the first
          // frame so the pinned 点击继续 and the panel never move while revealing.
          <span className={s.reserve} aria-hidden="true">
            {line.text.slice(count)}
          </span>
        )}
      </span>
      <small>{full ? "点击继续 →" : "点击显示全文"}</small>
    </Button>
  );
}
export function Portraits({
  story,
  speaker,
  player = true,
  portraits,
}: {
  story: Story;
  speaker: string;
  player?: boolean;
  portraits?: string[];
}) {
  const shown =
    portraits?.find((p) => !p.startsWith("player")) ??
    (portraits ? "" : speaker);
  const person = story.npcs[shown.replace("-coat", "") as keyof Story["npcs"]];
  const playerAsset = portraits?.includes("player-coat")
    ? "/assets/player-coat.png"
    : "/assets/player.png";
  const npcAsset =
    shown === "sun-coat" ? "/assets/sun-coat.png" : person?.portrait;
  return (
    <div className={s.portraits} aria-hidden="true">
      {player &&
        (!portraits || portraits.some((p) => p.startsWith("player"))) && (
          <img className={s.left} src={imageSource(playerAsset, 512)} alt="" />
        )}
      {person && npcAsset && (
        <img className={s.right} src={imageSource(npcAsset, 512)} alt="" />
      )}
    </div>
  );
}
