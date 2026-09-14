import { Button } from "@heroui/react";
import { useEffect, useRef, type ReactNode } from "react";
import { imageSource, imageSet } from "./images";
import s from "./App.module.css";
import type { Interlude } from "./types";

export function SceneInterlude({
  scene,
  onClose,
  onContinue,
  choices,
  feedback,
}: {
  scene: Interlude | null;
  onClose: () => void;
  onContinue: () => void;
  choices?: ReactNode;
  feedback?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  if (!scene) return null;
  return (
    <dialog
      ref={ref}
      className={s.interlude}
      onCancel={onClose}
      aria-labelledby="interlude-title"
    >
      <div className={s.interludeBody}>
        <img
          src={imageSource(scene.image)}
          srcSet={imageSet(scene.image)}
          sizes="100vw"
          alt={scene.location}
        />
        <div className={s.interludeCopy}>
          <small>幕间独白 · {scene.time}</small>
          <h2 id="interlude-title">{scene.location}</h2>
          <p>{scene.text}</p>
        </div>
      </div>
      {feedback}
      <div className={s.interludeActions}>
        {choices || (
          <Button variant="primary" className={s.primary} onClick={onContinue}>
            进入下一幕
          </Button>
        )}
        <Button variant="secondary" className={s.textButton} onClick={onClose}>
          返回当前剧情
        </Button>
      </div>
    </dialog>
  );
}
