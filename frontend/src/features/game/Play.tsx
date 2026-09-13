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

import { clearIdentityDrafts, readDraft, writeDraft } from "./drafts";
import { imageSource } from "../../images";
import { ProductPanel } from "./ProductPanel";
import { Conversation } from "./Conversation";
import { GameDrawer } from "./GameDrawer";
import { GameStage } from "./GameStage";
import { playKey, useTurnController } from "./useTurnController";
function PlaySession({
  userId,
  guest = false,
}: {
  userId: string;
  guest?: boolean;
}) {
  const { id = "" } = useParams(),
    navigate = useNavigate(),
    client = useQueryClient();
  const { npc, panel, selectNpc, setPanel } = useUI();
  const [guestGate, setGuestGate] = useState(false);
  const config = useQuery({
    queryKey: ["config"],
    queryFn: ({ signal }) => gameApi.config(signal),
    enabled: guest,
  });
  const playQuery = useQuery({
    queryKey: playKey(userId, id),
    queryFn: ({ signal }) => gameApi.playState(id, signal),
  });
  const saveQuery = { data: playQuery.data?.save, error: playQuery.error };
  const eventsQuery = { data: playQuery.data?.events };
  const storyQuery = useQuery({
    queryKey: ["story", saveQuery.data?.story_version ?? 1],
    queryFn: ({ signal }) =>
      gameApi.story(signal, saveQuery.data?.story_version ?? 1),
    enabled: !!saveQuery.data,
  });
  const [, refreshDraft] = useState(0);
  const draft = readDraft(userId, id, npc);
  const input = draft.text;
  const setInput = (text: string) => {
    writeDraft(userId, id, npc, {
      ...draft,
      text,
      act: saveQuery.data?.state.act ?? 0,
    });
    refreshDraft((n) => n + 1);
  };
  const clearCompletedDraft = useCallback(
    (submitted: Partial<TurnInput>) => {
      if ((submitted.action ?? "speak") !== "speak") return;
      const target = submitted.npc ?? "sun";
      const existing = readDraft(userId, id, target);
      if (existing.text === submitted.text) {
        writeDraft(userId, id, target, { text: "", act: existing.act });
        refreshDraft((n) => n + 1);
      }
    },
    [userId, id],
  );
  useEffect(() => {
    void gameApi.visit(id).catch(() => {});
  }, [id]);
  const {
    busy,
    pending,
    error,
    issue,
    blocked,
    aiBlocked,
    status,
    submit,
    recover,
  } = useTurnController(
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
  useEffect(() => {
    const nextReady = playQuery.data?.available_actions?.some(
      (a) => a.action === "next" && a.enabled,
    );
    const next = storyQuery.data?.acts[(saveQuery.data?.state.act ?? 4) + 1];
    if (!nextReady || !next) return;
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "image";
    link.href = imageSource(next.background, window.innerWidth);
    document.head.append(link);
    return () => link.remove();
  }, [
    playQuery.data?.available_actions,
    storyQuery.data,
    saveQuery.data?.state.act,
  ]);
  const [logoutError, setLogoutError] = useState<unknown>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await gameApi.logout();
      clearIdentityDrafts(userId);
      await client.cancelQueries();
      client.clear();
      void navigate("/");
    } catch (error) {
      setLogoutError(error);
    } finally {
      setLoggingOut(false);
    }
  }
  async function act(
    action: Action,
    text = "",
    target: Npc = npc,
    extra: Partial<TurnInput> = {},
  ) {
    if (!saveQuery.data) return;
    selectNpc(target);
    const option = playQuery.data?.available_actions?.find(
      (a) => a.action === action,
    );
    if (option?.requires_confirmation && !extra.proposal_id) {
      await submit(saveQuery.data, "propose", "", target, {
        proposed_action: action,
      });
      return;
    }
    await submit(saveQuery.data, action, text, target, {
      ...(action === "speak" && draft.act === saveQuery.data.state.act
        ? {
            discussion_id: draft.discussion_id,
            perspective_id: draft.perspective_id,
          }
        : {}),
      ...extra,
    });
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
    scene = story.acts[state.act]
      ? {
          ...story.acts[state.act]!,
          intro: save.scene_intro ?? story.acts[state.act]!.intro,
        }
      : undefined,
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
      {draft.text && draft.act !== state.act && (
        <p className={s.notice}>这份未发送的草稿来自第 {draft.act} 幕。</p>
      )}
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
        aiDisabled={aiBlocked || playQuery.data?.ai?.available === false}
        availableActions={playQuery.data?.available_actions}
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
          guest && state.act === 1
            ? setGuestGate(true)
            : scene.interlude
              ? setInterludeAct(state.act)
              : void act("next")
        }
      />
      {guestGate && (
        <section className={s.confirmation} aria-label="试玩完成">
          <h2>第一幕已完成</h2>
          <p>试玩进度已保存。绑定知乎后，可继承进度进入第二幕。</p>
          {config.data?.zhihu_login ? (
            <a href="/api/auth/zhihu">绑定知乎并继续</a>
          ) : (
            <p>知乎登录尚未配置，当前进度会保留。</p>
          )}
          <button onClick={() => setGuestGate(false)}>稍后再说</button>
        </section>
      )}
      {playQuery.data?.proposal && (
        <section className={s.confirmation} aria-label="重要选择确认">
          <h2>{playQuery.data.proposal.label}</h2>
          <p>{playQuery.data.proposal.effect}</p>
          <button
            disabled={disabled}
            onClick={() => {
              const proposal = playQuery.data?.proposal;
              if (proposal)
                void act(proposal.action, "", npc, {
                  proposal_id: proposal.id,
                });
            }}
          >
            确认这个选择
          </button>
          <button
            disabled={disabled}
            onClick={() => void act("cancel_proposal")}
          >
            暂不决定
          </button>
        </section>
      )}
      <ProductPanel
        save={save}
        userId={userId}
        events={events}
        disabled={disabled}
        fillDraft={(text, discussion_id, perspective_id) => {
          writeDraft(userId, id, npc, {
            text,
            act: state.act,
            discussion_id,
            perspective_id,
          });
          refreshDraft((n) => n + 1);
        }}
      />
      {interludeAct !== null && (
        <SceneInterlude
          key={`${id}:${interludeAct}`}
          scene={story.acts[interludeAct]?.interlude ?? null}
          choices={
            save.story_version === 2 &&
            state.act === 2 &&
            !("partner_choice" in state && state.partner_choice) ? (
              <div>
                {playQuery.data?.available_actions
                  ?.filter((a) => a.action.startsWith("partner_"))
                  .map((a) => (
                    <button
                      key={a.action}
                      disabled={disabled}
                      onClick={() => {
                        setInterludeAct(null);
                        void act(a.action);
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
              </div>
            ) : undefined
          }
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
        availableActions={playQuery.data?.available_actions}
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
  return (
    <PlaySession
      key={`${user.data.id}:${id}`}
      userId={user.data.id}
      guest={user.data.identity_type === "guest"}
    />
  );
}
