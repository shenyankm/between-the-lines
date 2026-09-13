import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ErrorNotice } from "../../ErrorNotice";
import { ApiError, gameApi } from "../../api";
import s from "../../App.module.css";
import { SceneInterlude } from "../../SceneInterlude";
import { useUI } from "../../store";
import type { Action, Npc, TurnInput } from "../../types";

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
  const clearCompletedDraft = useCallback((submitted: Partial<TurnInput>) => {
    if ((submitted.action ?? "speak") === "speak")
      setInput((current) => (current === submitted.text ? "" : current));
  }, []);
  const { busy, pending, error, issue, blocked, status, submit, recover } =
    useTurnController(
      userId,
      id,
      playQuery.data?.active_turn?.request_id,
      clearCompletedDraft,
    );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [interludeAct, setInterludeAct] = useState<number | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (panel) dialog?.showModal();
    else dialog?.close();
  }, [panel]);
  const [logoutError, setLogoutError] = useState<unknown>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await gameApi.logout();
      await client.cancelQueries();
      client.clear();
      void navigate("/");
    } catch (error) {
      setLogoutError(error);
    } finally {
      setLoggingOut(false);
    }
  }
  async function act(action: Action, text = "", target: Npc = npc) {
    const submittedDraft = input;
    if (
      saveQuery.data &&
      (await submit(saveQuery.data, action, text, target))
    ) {
      setInput((current) => (current === submittedDraft ? "" : current));
      selectNpc(target);
    }
  }
  if (saveQuery.error)
    return (
      <main className={s.page}>
        <Link to="/">返回首页</Link>
        <ErrorNotice
          error={saveQuery.error}
          onRetry={() => void playQuery.refetch()}
        />
      </main>
    );
  if (!saveQuery.data || !storyQuery.data)
    return (
      <main className={s.page}>
        {storyQuery.error ? (
          <ErrorNotice
            error={storyQuery.error}
            onRetry={() => void storyQuery.refetch()}
          />
        ) : (
          "正在翻开你的故事…"
        )}
      </main>
    );
  const save = saveQuery.data,
    state = save.state,
    story = storyQuery.data,
    scene = story.acts[state.act],
    character = {
      ...story.npcs[npc],
      greeting: save.npc_greetings?.[npc] ?? story.npcs[npc].greeting,
    },
    events = eventsQuery.data || [];
  if (!scene)
    return (
      <main className={s.page}>
        <Link to="/">返回首页</Link>
        <p role="alert">第 {state.act + 1} 幕的场景数据缺失，请刷新重试。</p>
      </main>
    );
  const latestInteraction = [...events]
    .reverse()
    .find(
      (e) =>
        e.act === state.act &&
        ((e.kind === "npc" && e.npc === npc) ||
          (npc === "sun" &&
            e.action &&
            ["boundary", "cut_ties", "keep_distance"].includes(e.action))),
    );
  const lastReply =
    latestInteraction?.kind === "npc" ? latestInteraction : undefined;
  const disabled = busy || !!pending || blocked;
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
        issue={issue}
        recoveryDisabled={blocked}
        refresh={() => void playQuery.refetch()}
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
        relationships={save.relationships}
      />
      <ErrorNotice
        error={logoutError}
        onRetry={() => void logout()}
        retryLabel="重试退出"
        disabled={loggingOut}
      />
      <button
        disabled={loggingOut}
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
  if (
    !user.data ||
    (user.error instanceof ApiError && user.error.status === 401)
  )
    return (
      <main className={s.page}>
        <Link to="/">返回首页</Link>
        {user.error ? (
          <ErrorNotice error={user.error} onRetry={() => void user.refetch()} />
        ) : (
          <p>正在读取身份…</p>
        )}
      </main>
    );
  return <PlaySession key={`${user.data.id}:${id}`} userId={user.data.id} />;
}
