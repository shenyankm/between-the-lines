import {
  Bookmark,
  BriefcaseBusiness,
  Clock3,
  Feather,
  History,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router";
import s from "../../App.module.css";
import type { Npc, Save, Story } from "../../types";

import type { Panel } from "../../store";
export function GameStage({
  story,
  state,
  scene,
  character,
  setPanel,
}: {
  story: Story;
  state: Save["state"];
  scene: Story["acts"][number];
  character: Story["npcs"][Npc];
  npc: Npc;
  setPanel: (panel: Panel) => void;
}) {
  return (
    <>
      <header className={s.gameHeader}>
        <Link to="/" className={s.brand}>
          <Feather size={21} />
          <span>言外之意</span>
        </Link>
        <div className={s.chapterNav}>
          {story.acts.slice(1, 4).map((a, i) => (
            <span
              key={a.title}
              className={state.act === i + 1 ? s.currentChapter : ""}
            >
              {String(i + 1).padStart(2, "0")}
              <span>{a.chapter_title}</span>
            </span>
          ))}
        </div>
        <Link to="/saves" className={s.iconText} aria-label="存档">
          <Bookmark size={17} />
          <span>存档</span>
        </Link>
      </header>
      <section
        className={s.stage}
        style={
          {
            "--character-color": character.color,
            "--scene-background": `url("${scene.background}")`,
          } as React.CSSProperties
        }
      >
        <div className={s.sceneInfo}>
          <span className={s.overline}>{scene.title}</span>
          <h2>{scene.location}</h2>
          <p>
            <Clock3 size={14} />
            {scene.time}
          </p>
        </div>
        <div className={s.stats}>
          <div>
            <span>专业信用</span>
            <strong>{state.credit}</strong>
            <div className={s.meter}>
              <i style={{ width: `${state.credit}%` }} />
            </div>
          </div>
          <div>
            <span>心绪消耗</span>
            <strong>{state.stress}</strong>
            <div className={s.meter}>
              <i style={{ width: `${state.stress}%` }} />
            </div>
          </div>
        </div>
        <div className={s.sceneCaption}>
          <span>场景 {String(state.act + 1).padStart(2, "0")}</span>
          <p>{scene.intro}</p>
        </div>
        <aside className={s.characterCard}>
          <img
            className={s.characterPortrait}
            src={character.portrait}
            alt={`${character.name}立绘`}
          />
          <div>
            <small>当前交谈</small>
            <h3>{character.name}</h3>
            <p>{character.role}</p>
          </div>
        </aside>
        <div className={s.toolbar}>
          {(
            [
              { key: "phone", icon: Smartphone, label: "手机" },
              { key: "work", icon: BriefcaseBusiness, label: "工作系统" },
              { key: "tips", icon: Sparkles, label: "锦囊" },
              { key: "history", icon: History, label: "回顾" },
            ] as const
          ).map(({ key, icon: Icon, label }) => (
            <button key={key} onClick={() => setPanel(key)} aria-label={label}>
              <Icon size={21} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
