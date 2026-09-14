import type { endingVisual } from "./endingPresentation";

export function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  width: number,
) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const char of Array.from(paragraph)) {
      if (line && context.measureText(line + char).width > width) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}

export function loadShareImage(
  source: string,
): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = setTimeout(() => finish(null), 8000);
    function finish(value: HTMLImageElement | null) {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(value);
    }
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.src = source;
  });
}

export const posterFont = '"Ending Serif", "Songti SC", "SimSun", serif';

export async function preparePosterFonts(text: string) {
  if (!document.fonts) return;
  await document.fonts.load?.(`400 30px ${posterFont}`, text);
  await document.fonts.load?.(`600 96px ${posterFont}`, text);
  await document.fonts.ready;
}

export function drawShareCard(
  canvas: HTMLCanvasElement,
  lines: string[],
  image: HTMLImageElement | null,
  visual: ReturnType<typeof endingVisual> = null,
) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas_unavailable");
  context.font = `30px ${posterFont}`;
  const body = lines
    .slice(visual ? 3 : 2)
    .flatMap((line) => wrapText(context, line, 700));
  context.font = `600 92px ${posterFont}`;
  const title = wrapText(context, lines[1] ?? "", 790);
  const artTop = 190 + title.length * 115;
  const artHeight = image ? (900 * 820) / 941 : 0;
  const bodyTop = artTop + artHeight + 65;
  canvas.width = 900;
  canvas.height = Math.max(1600, bodyTop + body.length * 49 + 180);
  context.fillStyle = "#f5f0e5";
  context.fillRect(0, 0, 900, canvas.height);
  if (image) {
    const scale = image.naturalWidth / 941;
    context.drawImage(
      image,
      0,
      0,
      image.naturalWidth,
      320 * scale,
      0,
      0,
      900,
      artTop,
    );
    context.drawImage(
      image,
      0,
      320 * scale,
      image.naturalWidth,
      820 * scale,
      0,
      artTop,
      900,
      artHeight,
    );
    const footerHeight = (900 * 532) / 941;
    context.drawImage(
      image,
      0,
      1140 * scale,
      image.naturalWidth,
      532 * scale,
      0,
      canvas.height - footerHeight,
      900,
      footerHeight,
    );
  }
  context.strokeStyle = "#a6aa91";
  context.lineWidth = 1;
  context.strokeRect(22, 18, 856, canvas.height - 36);
  context.fillStyle = "#455442";
  context.font = `26px ${posterFont}`;
  context.fillText("言外之意", 53, 70);
  context.textAlign = "right";
  context.font = `40px ${posterFont}`;
  context.fillText(visual?.code ?? "", 847, 72);
  context.fillStyle = "#b6baa2";
  context.fillRect(53, 88, 794, 1);
  context.textAlign = "center";
  context.fillStyle = "#30352d";
  context.font = `24px ${posterFont}`;
  context.fillText("本 局 已 收 束", 450, 131);
  context.font = `600 92px ${posterFont}`;
  title.forEach((line, i) => context.fillText(line, 450, 235 + i * 115));
  if (visual) {
    context.fillStyle = "#455442";
    context.font = `24px ${posterFont}`;
    context.fillText(visual.subtitle, 450, artTop - 25);
  }
  context.textAlign = "left";
  context.fillStyle = "#30352d";
  context.font = `30px ${posterFont}`;
  body.forEach((line, i) => context.fillText(line, 100, bodyTop + i * 49));
}
