import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { gameApi } from "../../api";
import s from "../../App.module.css";
import { SceneInterlude } from "../../SceneInterlude";
import { useUI } from "../../store";
import type { Action, Npc } from "../../types";

import { Conversation } from "./Conversation";
import { GameDrawer } from "./GameDrawer";
import { GameStage } from "./GameStage";
import { playKey, useTurnController } from "./useTurnController";
function PlaySession({ userId }: { userId: string }) {
  const { id = "" } = useParams(),
    navigate = useNavigate(),
    client = useQueryClient();
  const { npc, panel, selectNpc, setPanel } = useUI();
  const playQuery = useQuery({
    queryKey: playKey(userId, id),
    queryFn: ({ signal }) => gameApi.playState(id, signal),
  });
  const saveQuery = { data: playQuery.data?.save, error: playQuery.error };
  const eventsQuery = { data: playQuery.data?.events };
  const storyQuery = useQuery({
    queryKey: ["story"],
    queryFn: ({ signal }) => gameApi.story(signal),
  });
  const [input, setInput] = useState("");
  const { busy, pending, error, status, submit, recover } = useTurnController(
    userId,
    id,
    playQuery.data?.active_turn?.request_id,
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [interludeAct, setInterludeAct] = useState<number | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (panel) dialog?.showModal();
    else dialog?.close();
  }, [panel]);
  async function logout() {
    await gameApi.logout();
    await client.cancelQueries();
    client.clear();
    void navigate("/");
  }
  async function act(action: Action, text = "", target: Npc = npc) {
    const submittedDraft = input;
    if (saveQuery.data && (await submit(saveQuery.data, action, text, target)))
      setInput((current) => (current === submittedDraft ? "" : current));
  }
  if (saveQuery.error)
    return (
      <main className={s.page}>
        <Link to="/">返回首页</Link>
        <p role="alert">{saveQuery.error.message}</p>
      </main>
    );
  if (!saveQuery.data || !storyQuery.data)
    return (
      <main className={s.page}>
        {storyQuery.error ? "故事资料读取失败，请刷新。" : "正在翻开你的故事…"}
      </main>
    );
  const save = saveQuery.data,
    state = save.state,
    story = storyQuery.data,
    scene = story.acts[state.act],
    character = story.npcs[npc],
    events = eventsQuery.data || [];
  if (!scene)
    return (
      <main className={s.page}>
        <Link to="/">返回首页</Link>
        <p role="alert">第 {state.act + 1} 幕的场景数据缺失，请刷新重试。</p>
      </main>
    );
  const lastReply = [...events]
    .reverse()
    .find((e) => e.kind === "npc" && e.npc === npc && e.act === state.act);
  const disabled = busy || !!pending;
  return (
    <main className={s.game}>
      <GameStage
        story={story}
        state={state}
        scene={scene}
        character={character}
        npc={npc}
        setPanel={setPanel}
      />
      <Conversation
        story={story}
        state={state}
        scene={scene}
        character={character}
        save={save}
        npc={npc}
        lastReply={lastReply}
        events={events}
        disabled={disabled}
        act={act}
        input={input}
        setInput={setInput}
        busy={busy}
        status={status}
        error={error}
        pending={pending}
        recover={recover}
        onNext={() =>
          scene.interlude ? setInterludeAct(state.act) : void act("next")
        }
      />
      {interludeAct !== null && (
        <SceneInterlude
          key={`${id}:${interludeAct}`}
          scene={story.acts[interludeAct]?.interlude ?? null}
          onClose={() => setInterludeAct(null)}
          onContinue={() => {
            setInterludeAct(null);
            void act("next");
          }}
        />
      )}
      <GameDrawer
        dialogRef={dialogRef}
        panel={panel}
        setPanel={setPanel}
        story={story}
        state={state}
        npc={npc}
        selectNpc={selectNpc}
        disabled={disabled}
        act={act}
        events={events}
      />
      <button
        className={s.logout}
        aria-label="退出登录"
        onClick={() => void logout()}
      >
        <LogOut size={14} />
      </button>
    </main>
  );
}

export function Play() {
  const { id = "" } = useParams();
  const user = useQuery({
    queryKey: ["user"],
    queryFn: ({ signal }) => gameApi.user(signal),
  });
  if (!user.data)
    return (
      <main className={s.page}>
        <Link to="/">返回首页</Link>
        <p role={user.error ? "alert" : undefined}>
          {user.error ? user.error.message : "正在读取身份…"}
        </p>
      </main>
    );
  return <PlaySession key={`${user.data.id}:${id}`} userId={user.data.id} />;
}
