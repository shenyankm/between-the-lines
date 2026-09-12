import { useEffect, useRef } from "react";
import { interludes } from "./scenes";
import s from "./App.module.css";

export function SceneInterlude({
  act,
  onClose,
  onContinue,
}: {
  act: number;
  onClose: () => void;
  onContinue: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const scene = interludes[act];
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
      <img src={scene.image} alt={scene.location} />
      <div className={s.interludeCopy}>
        <small>幕间独白 · {scene.time}</small>
        <h2 id="interlude-title">{scene.location}</h2>
        <p>{scene.text}</p>
        <div>
          <button className={s.primary} onClick={onContinue}>
            进入下一幕
          </button>
          <button className={s.textButton} onClick={onClose}>
            返回当前剧情
          </button>
        </div>
      </div>
    </dialog>
  );
}
