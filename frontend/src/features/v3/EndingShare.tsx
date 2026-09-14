import { Button } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { imageSource } from "../../images";
import type { StateV3 } from "./Work";
import { endingVisual, shareLines } from "./endingPresentation";
import { drawShareCard, loadShareImage, preparePosterFonts } from "./shareCard";
import s from "./V3.module.css";

export function EndingShare({ state }: { state: StateV3 }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState("");
  const [readyText, setReadyText] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cachedImage = useRef<{
    source: string;
    promise: Promise<HTMLImageElement | null>;
  } | null>(null);
  const facts = [
    ...(state.outcome?.achievements ?? []).map((fact) => `已确认：${fact}`),
    ...(state.outcome?.unresolved ?? []).map((fact) => `尚待处理：${fact}`),
  ].filter((fact, index, all) => all.indexOf(fact) === index);
  const lines = shareLines(
    state,
    selected.filter((fact) => facts.includes(fact)),
  );
  const text = lines.join("\n");
  const visual = endingVisual(state);
  const source = visual
    ? imageSource(`/assets/ending-${visual.asset}.png`, 941)
    : "";

  useEffect(() => {
    if (!preview) return;
    let cancelled = false;
    setRendering(true);
    setReadyText(null);
    setMessage("");
    if (source && cachedImage.current?.source !== source) {
      cachedImage.current = { source, promise: loadShareImage(source) };
    }
    void Promise.all([
      source ? cachedImage.current!.promise : Promise.resolve(null),
      preparePosterFonts(text),
    ])
      .then(([image]) => {
        if (cancelled || !canvas.current) return;
        drawShareCard(canvas.current, text.split("\n"), image, visual);
        setReadyText(text);
        if (source && !image) setMessage("插画暂时不可用，已生成文字分享卡。");
      })
      .catch(() => {
        if (!cancelled) setMessage("图片预览暂时不可用，可以复制下方文案。");
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [preview, source, text, visual]);

  function download() {
    const el = canvas.current;
    if (!el || readyText !== text) return;
    try {
      el.toBlob((blob) => {
        if (!blob) {
          setMessage("导出失败，请重试或复制文案。");
          return;
        }
        try {
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `章外回声-${state.outcome?.title ?? "本局记录"}.png`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          setMessage("分享图片已导出。");
        } catch {
          setMessage("导出失败，请重试或复制文案。");
        }
      }, "image/png");
    } catch {
      setMessage("导出失败，请重试或复制文案。");
    }
  }

  return (
    <section className={s.endingShare} aria-label="分享本局">
      <h2>留下一张本局记录</h2>
      {!!facts.length && (
        <fieldset>
          <legend>额外加入分享卡的事实（最多三条）</legend>
          {facts.map((fact) => (
            <label key={fact} className={s.shareChoice}>
              <input
                type="checkbox"
                checked={selected.includes(fact)}
                disabled={!selected.includes(fact) && selected.length >= 3}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [...selected, fact]
                      : selected.filter((value) => value !== fact),
                  )
                }
              />
              <span>{fact}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className={s.endingActions}>
        <Button variant="secondary" onClick={() => setPreview(true)}>
          预览分享卡
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            void Promise.resolve()
              .then(() => navigator.clipboard.writeText(text))
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
      </div>
      <p role="status">{rendering ? "正在准备图片与文字…" : message}</p>
      {preview && (
        <div className={s.sharePreviewGrid}>
          <div>
            <canvas
              ref={canvas}
              className={s.share}
              aria-label={text}
              hidden={readyText !== text}
            />
            <Button
              variant="secondary"
              isDisabled={readyText !== text || rendering}
              onClick={download}
            >
              导出图片
            </Button>
          </div>
          <pre className={s.shareCopy}>{text}</pre>
        </div>
      )}
    </section>
  );
}
