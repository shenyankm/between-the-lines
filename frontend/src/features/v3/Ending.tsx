import { Button, Card } from "@heroui/react";
import { type CSSProperties, useRef, useState } from "react";
import type { StateV3 } from "./Work";
import s from "./V3.module.css";
import type { Save } from "../../types";
import { EndingNarrative } from "./EndingNarrative";
import { Link } from "react-router";
import { imageSet, imageSource } from "../../images";
import { endingVisual, expressionStyle } from "./endingPresentation";
import "./ending-fonts.css";
export function Ending({
  state,
  save,
  userId,
}: {
  state: StateV3;
  save: Save;
  userId: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState("");
  const visual = endingVisual(state);
  const source = visual ? `/assets/ending-${visual.asset}.png` : "";
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const evidence = Object.entries(state.relationship?.facts ?? {}).filter(
    ([k]) => ["boundary", "sun_cut", "friendship", "sun_observe"].includes(k),
  );
  const style = expressionStyle(state);
  const text = `《言外之意》｜${state.outcome?.title}\n我的表达风格：${style}\n${evidence.map(([, f]) => f.detail).join("\n")}\n这是本局选择的记录，不是心理测评。`;
  function draw() {
    setPreview(true);
    requestAnimationFrame(() => {
      const el = canvas.current;
      if (!el) return;
      const c = el.getContext("2d");
      if (!c) return;
      c.fillStyle = "#172825";
      c.fillRect(0, 0, 900, 1200);
      c.fillStyle = "#dec7a0";
      c.font = "28px sans-serif";
      c.fillText("言 外 之 意  /  本 局 记 录", 70, 100);
      c.font = "60px serif";
      c.fillText(style, 70, 230);
      c.font = "32px sans-serif";
      c.fillText(state.outcome?.title ?? "", 70, 310);
      c.fillStyle = "#f7f0e4";
      c.font = "25px sans-serif";
      let y = 420;
      for (const line of text.split("\n").slice(2)) {
        for (let i = 0; i < line.length; i += 25) {
          c.fillText(line.slice(i, i + 25), 70, y);
          y += 44;
        }
      }
      c.fillStyle = "#dec7a0";
      c.fillText(`舆论 ${state.heat} · 信用 ${state.credit}`, 70, 1030);
      c.fillText(`内耗 ${state.rumination} · 压力 ${state.pressure}`, 70, 1080);
    });
  }
  return (
    <Card className={s.ending} role="region" aria-label="故事结局">
      <div
        className={s.endingPoster}
        style={
          {
            "--poster-image":
              source && failedImage !== source
                ? `url("${imageSource(source, 941)}")`
                : "none",
          } as CSSProperties
        }
      >
        <Card.Header className={s.endingPosterHeader}>
          <div className={s.endingBrand}>
            <span>言外之意</span>
            <span>{visual?.code}</span>
          </div>
          <small className={s.endingClosed}>本局已收束</small>
          <h1>{state.outcome?.title ?? state.ending ?? "本局记录"}</h1>
          {visual && <p className={s.endingSubtitle}>{visual.subtitle}</p>}
        </Card.Header>
        <div className={s.endingStory}>
          {source && failedImage !== source && (
            <div className={s.endingArtFrame}>
              <img
                className={s.endingArt}
                src={imageSource(source, 768)}
                srcSet={imageSet(source)}
                sizes="(min-width: 1000px) 941px, calc(100vw - 48px)"
                width={941}
                height={1672}
                alt={`${state.outcome?.title ?? "故事结局"}插画`}
                onError={() => setFailedImage(source)}
              />
            </div>
          )}
          <div className={s.endingNarrative}>
            <h2 className={s.sr}>结局回顾</h2>
            <EndingNarrative save={save} userId={userId} />
          </div>
        </div>
      </div>
      <Card.Content className={s.endingColumns}>
        <section className={s.endingFacts} aria-label="已保存事实">
          <h2>已保存事实</h2>
          <h3>这一局留下的余波</h3>
          <p>
            舆论温度 {state.heat}：
            {state.heat >= 70
              ? "争议受到较多关注，后续仍需以核查记录回应。"
              : state.heat <= 30
                ? "争议的公开关注相对有限。"
                : "争议仍有一定关注。"}
          </p>
          <p>
            专业信用 {state.credit}：
            {state.credit >= 70
              ? "工作记录积累了较高的专业信任，但不能代替证据。"
              : state.credit <= 30
                ? "专业信任仍需通过后续工作重建，已核实事实仍然有效。"
                : "后续交付与记录仍会影响职业处境。"}
          </p>
          <p>
            内耗 {state.rumination}：
            {(state.rumination ?? 25) >= 70
              ? "本局人际消耗较高，取得成果也不意味着已经释然。"
              : (state.rumination ?? 25) <= 30
                ? "本局记录的人际消耗较低，不代表你必须原谅任何人。"
                : "本局仍留下了一些人际消耗。"}
          </p>
          <p>
            工作压力 {state.pressure}：
            {(state.pressure ?? 25) >= 70
              ? "工作负担较重，后续需要恢复与支持。"
              : (state.pressure ?? 25) <= 30
                ? "当前工作负担相对缓和。"
                : "仍需安排精力处理后续工作。"}
          </p>
          <h3>已经留下的成果</h3>
          {state.outcome?.achievements.length ? (
            <ul>
              {state.outcome.achievements.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          ) : (
            <p>本局没有记录已完成的成果。</p>
          )}
          <h3>仍未解决</h3>
          {state.outcome?.unresolved.length ? (
            <ul>
              {state.outcome.unresolved.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          ) : (
            <p>本局已发生的事项中，没有记录尚待处理的工作问题。</p>
          )}
          <h3>我的职场人格 · {style}</h3>
          <p>标签只描述本局表达风格，并非人格诊断。</p>
          {evidence.map(([k, f]) => (
            <p key={k}>{f.detail}</p>
          ))}
        </section>
      </Card.Content>
      <Card.Footer className={s.endingActions}>
        <Link to="/">重新开始一个独立故事</Link>
        <Button variant="secondary" onClick={draw}>
          预览分享卡
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            void navigator.clipboard
              .writeText(text)
              .then(() => setMessage("文案已复制"))
              .catch(() => setMessage("复制失败，请从预览手动复制"))
          }
        >
          复制文案
        </Button>
        <a
          href="https://www.zhihu.com/search?type=content&q=职场沟通边界"
          target="_blank"
          rel="noreferrer"
        >
          打开知乎讨论
        </a>
      </Card.Footer>
      <p role="status">{message}</p>
      {preview && (
        <div>
          <canvas
            ref={canvas}
            width={900}
            height={1200}
            className={s.share}
            aria-label={text}
          />
          <Button
            variant="secondary"
            onClick={() => {
              canvas.current?.toBlob((blob) => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "言外之意-本局记录.png";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              });
            }}
          >
            导出图片
          </Button>
        </div>
      )}
    </Card>
  );
}
