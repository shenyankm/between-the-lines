import { Card } from "@heroui/react";
import { useState } from "react";
import type { StateV3 } from "./Work";
import s from "./V3.module.css";
import type { Save } from "../../types";
import { imageSource } from "../../images";
import { endingVisual } from "./endingPresentation";
import { EndingOpening } from "./EndingOpening";
import "./ending-fonts.css";
export function Ending({
  state,
}: {
  state: StateV3;
  save: Save;
  userId: string;
}) {
  const [openingComplete, setOpeningComplete] = useState(false);
  const visual = endingVisual(state);
  const source = visual ? `/assets/ending-${visual.asset}.png` : "";
  const [failedImage, setFailedImage] = useState<string | null>(null);
  if (!openingComplete) {
    return (
      <EndingOpening
        state={state}
        onContinue={() => setOpeningComplete(true)}
      />
    );
  }
  return (
    <Card
      className={`${s.ending} ${s.endingOriginal}`}
      role="region"
      aria-label="故事结局"
    >
      {source && failedImage !== source ? (
        <img
          className={s.endingOriginalImage}
          src={imageSource(source, 941)}
          width={941}
          height={1672}
          alt={`${visual?.code} ${state.outcome?.title ?? state.ending}：文档原版结局卡片`}
          onError={() => setFailedImage(source)}
        />
      ) : (
        <div role="status">
          <h1>{state.outcome?.title ?? state.ending ?? "本局记录"}</h1>
          {source && <p>结局卡片暂时未能加载，请刷新重试。</p>}
        </div>
      )}
    </Card>
  );
}
