import {
  Bookmark,
  BriefcaseBusiness,
  Clock3,
  History,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { prologue } from "./prologue";
import { Link } from "react-router";
import s from "../../App.module.css";
import { backgroundImage, imageSet, imageSource } from "../../images";
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
  const [page, setPage] = useState(0);
  const visual = story.story_version >= 2;
  const opening = visual && state.act === 0;
  const reading = prologue[page] ?? prologue[0];
  const displayed = opening
    ? {
        ...character,
        name: reading.speaker,
        role: reading.role,
        portrait: reading.portrait,
      }
    : character;
  return (
    <>
      <header className={s.gameHeader}>
        <Link to="/" className={s.brand}>
          <img
            className={s.brandLogo}
            src="/assets/brand-logo.png"
            width={40}
            height={40}
            alt=""
          />
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
        className={`${s.stage} ${visual ? s.visualStage : ""}`}
        style={
          {
            "--character-color": character.color,
            "--scene-background": backgroundImage(scene.background),
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
          {opening && (
            <div className={s.prologuePages} role="group" aria-label="序幕片段">
              {prologue.map((item, index) => (
                <button
                  key={item.title}
                  aria-pressed={page === index}
                  onClick={() => setPage(index)}
                >
                  {item.title}
                </button>
              ))}
            </div>
          )}
          <p>{opening ? reading.text : scene.intro}</p>
        </div>
        <aside
          className={`${s.characterCard} ${visual ? s.visualCharacter : ""}`}
        >
          <img
            className={s.characterPortrait}
            src={imageSource(displayed.portrait, 512)}
            srcSet={imageSet(displayed.portrait)}
            sizes={
              visual
                ? "(max-width: 600px) 230px, 360px"
                : "(max-width: 600px) 160px, 320px"
            }
            alt={`${displayed.name}立绘`}
          />
          <div>
            <small>{opening ? "序幕 · " + reading.title : "当前交谈"}</small>
            <h3>{displayed.name}</h3>
            <p>{displayed.role}</p>
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
