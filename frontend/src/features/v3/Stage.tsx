import { Button } from "@heroui/react";
import { useEffect, useState } from "react";
import type { Story } from "../../types";
import { imageSource } from "../../images";
import s from "./V3.module.css";

export function Script({
  lines,
  position,
  reduced,
  advance,
}: {
  lines: NonNullable<Story["scenes"]>[string];
  position: number;
  reduced: boolean;
  advance: () => void;
}) {
  const line = lines[position];
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (reduced || !line || count >= line.text.length) return;
    const timer = setTimeout(
      () => setCount((n) => Math.min(n + 2, line.text.length)),
      35,
    );
    return () => clearTimeout(timer);
  }, [line, reduced, count]);
  if (!line) return null;
  const full = reduced || count >= line.text.length;
  return (
    <Button
      type="button"
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
      <strong>
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
      <span>{full ? line.text : line.text.slice(0, count)}</span>
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
