import { Form } from "@heroui/react";
import { TextArea, Button, Modal } from "@heroui/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { isEvent } from "../../contracts";
import type { GameEvent } from "../../types";
import { Link, useNavigate } from "react-router";
import { api, gameApi } from "../../api";
import type { Action, Npc, PlayState, Story, TurnInput } from "../../types";
import { playKey, useTurnController } from "../game/useTurnController";
import { clearIdentityDrafts, readDraft, writeDraft } from "../game/drafts";
import { ProductPanel } from "../game/ProductPanel";
import { EventHistory } from "../game/EventHistory";
import { SceneInterlude } from "../../SceneInterlude";
import { imageSource } from "../../images";
import { Portraits, Script } from "./Stage";
import { Actions, Work, type StateV3 } from "./Work";
import { followUpChoices } from "./followUp";
import { Relations } from "./Relations";
import { Discussion } from "./Discussion";
import { Ending } from "./Ending";
import s from "./V3.module.css";

import { ErrorNotice } from "../../ErrorNotice";

type Panel = "phone" | "work" | "relations" | "discussion" | "history" | null;
const contacts: Npc[] = ["sun", "li", "zhang", "wang"];
export function PlayV3({
  userId,
  play,
  story,
}: {
  userId: string;
  play: PlayState;
  story: Story;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
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
  const save = play.save,
    state = save.state as StateV3;
  const [panel, setPanel] = useState<Panel>(null),
    [contact, setContact] = useState<Npc | "group" | null>(null);
  const [reduced, setReduced] = useState(() => {
    try {
      const saved = localStorage.getItem(`reduced-motion:${userId}`);
      if (saved !== null) return saved === "true";
    } catch {
      /* Storage may be unavailable; honor the system preference. */
    }
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    try {
      localStorage.setItem(`reduced-motion:${userId}`, String(reduced));
    } catch {
      /* Keep the in-memory setting. */
    }
  }, [reduced, userId]);
  const [positions, setPositions] = useState<Record<string, number>>(
    play.reading ?? {},
  );
  const [interlude, setInterlude] = useState(false);
  const [readError, setReadError] = useState("");
  const confirmation = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (play.proposal && !confirmation.current?.open)
      confirmation.current?.showModal();
  }, [play.proposal]);
  const [, refresh] = useState(0);
  const channel =
    panel === "phone" && contact
      ? contact === "group"
        ? "group"
        : "dm"
      : "scene";
  const target: Npc =
    channel === "dm" && contact !== "group" ? (contact ?? "sun") : "sun";
  const draftKey = `${channel}:${channel !== "scene" ? (contact ?? "sun") : "sun"}`;
  const draft = readDraft(userId, save.id, target, draftKey);
  const setInput = (text: string) => {
    writeDraft(
      userId,
      save.id,
      target,
      { ...draft, text, act: state.act },
      draftKey,
    );
    refresh((n) => n + 1);
  };
  const clear = useCallback(
    (input: Partial<TurnInput>) => {
      if (input.action !== "speak") return;
      const npc = input.npc ?? "sun";
      const key = `${input.channel ?? "scene"}:${input.channel === "group" ? "group" : input.channel === "dm" ? npc : "sun"}`;
      const old = readDraft(userId, save.id, npc, key);
      if (old.text === input.text) {
        writeDraft(userId, save.id, npc, { text: "", act: old.act }, key);
        refresh((n) => n + 1);
      }
    },
    [userId, save.id],
  );
  const controller = useTurnController(
    userId,
    save.id,
    play.active_turn?.request_id,
    clear,
  );
  const busy = controller.busy || !!controller.blocked;
  const act = (
    action: Action,
    npc: Npc = "sun",
    extra: Partial<TurnInput> = {},
  ) => {
    if (action === "next" && story.acts[state.act]?.interlude && !interlude) {
      setInterlude(true);
      return;
    }
    const option = play.available_actions?.find((a) => a.action === action);
    const work = [
      "submit_purchase",
      "supplement",
      "approve_purchase",
      "report",
      "deliver",
      "project_review",
      "draft_exit",
      "submit_exit",
      "rest",
      "draft_support",
      "submit_support",
      "review_support",
      "request_help",
    ].includes(action);
    const metadata: Partial<TurnInput> = {
      channel: work
        ? "work"
        : ["clarify", "review_clarification"].includes(action)
          ? "group"
          : channel,
      target: ["clarify", "review_clarification"].includes(action)
        ? "group"
        : npc,
      ...extra,
    };
    if (option?.requires_confirmation && !extra.proposal_id) {
      setPanel(null);
      void controller.submit(save, "propose", "", npc, {
        ...metadata,
        proposed_action: action,
      });
    } else void controller.submit(save, action, "", npc, metadata);
  };
  async function mark(key: string, position: number) {
    try {
      await api(`/saves/${save.id}/reading`, { key, position });
      // Requests can finish out of order after rapid clicks. Match the API's
      // monotonic position so a late response cannot replay an earlier line.
      setPositions((p) => ({ ...p, [key]: Math.max(p[key] ?? 0, position) }));
      client.setQueryData<PlayState>(playKey(userId, save.id), (cached) =>
        cached
          ? {
              ...cached,
              reading: {
                ...cached.reading,
                [key]: Math.max(cached.reading?.[key] ?? 0, position),
              },
            }
          : cached,
      );
      setReadError("");
    } catch {
      setReadError("阅读位置尚未保存，请重试。");
    }
  }
  const performanceReady =
    (play.performance_version ?? play.save.version) === save.version;
  const lines =
    play.performance ?? story.scenes?.[state.node ?? "prologue"] ?? [];
  const position = positions[state.node ?? "prologue"] ?? 0;
  const scripted = performanceReady && position < lines.length;
  const currentLine = scripted ? lines[position] : lines.at(-1);
  const scene = {
    ...story.acts[state.act]!,
    ...(currentLine?.location ? { location: currentLine.location } : {}),
    ...(currentLine?.background ? { background: currentLine.background } : {}),
  };
  const events = play.events.filter(
    (e) =>
      e.act === state.act &&
      (e.channel ?? "scene") === "scene" &&
      !["propose", "cancel_proposal"].includes(e.action ?? ""),
  );
  const latest = events.at(-1);
  const last =
    latest &&
    (latest.scene !== state.node ||
      [
        "begin",
        "next",
        "join_farewell",
        "attend_farewell",
        "project_review",
      ].includes(latest.action ?? ""))
      ? (lines.at(-1) ?? latest)
      : latest;
  const names = {
    sun: "孙淼",
    li: "李姐",
    zhang: "张工",
    wang: "王会计",
    player: "周菱菱",
    inner: "内心独白",
    narrator: "旁白",
    system: "事件记录",
  };
  const composer = (dm = false) => (
    <Form
      className={s.composer}
      onSubmit={(e) => {
        e.preventDefault();
        void controller.submit(save, "speak", draft.text, target, {
          channel: dm ? channel : "scene",
          target: channel === "group" ? "group" : target,
          ...(draft.act === state.act
            ? {
                discussion_id: draft.discussion_id,
                perspective_id: draft.perspective_id,
              }
            : {}),
        });
      }}
    >
      <label className={s.sr} htmlFor={dm ? "dm-input" : "scene-input"}>
        自由表达
      </label>
      <TextArea
        id={dm ? "dm-input" : "scene-input"}
        maxLength={1500}
        value={draft.text}
        onChange={(e) => setInput(e.target.value)}
        placeholder={
          dm
            ? contact === "group"
              ? "在工作群发言…"
              : `给${names[target]}发消息…`
            : "写下你真正想说的话…"
        }
      />
      <Button
        type="submit"
        variant="secondary"
        isDisabled={
          busy ||
          !draft.text.trim() ||
          (channel !== "group" && (!play.ai?.available || controller.aiBlocked))
        }
      >
        发送
      </Button>
    </Form>
  );
  const conversation = useInfiniteQuery({
    queryKey: ["conversation", userId, save.id, contact, save.version],
    enabled: panel === "phone" && !!contact,
    initialPageParam: "",
    getNextPageParam: (last: GameEvent[]) =>
      last.length === 100 ? last[0]?.id : undefined,
    queryFn: ({ signal, pageParam }) =>
      api<GameEvent[]>(
        `/saves/${save.id}/events?channel=${contact === "group" ? "group" : "dm"}${contact !== "group" ? `&target=${contact}` : ""}&limit=100${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`,
        undefined,
        signal,
        true,
        (v): v is GameEvent[] => Array.isArray(v) && v.every(isEvent),
      ),
  });
  const npcEvents = [...(conversation.data?.pages ?? [])].reverse().flat();
  const sceneOptions = (play.available_actions ?? []).filter((a) =>
    [
      "begin",
      "boundary",
      "contact_wang",
      "join_farewell",
      "attend_farewell",
      "appease",
      "public_confront",
      "next",
      "close_story",
    ].includes(a.action),
  );
  const authoredChoices = scene.choices.flatMap((choice) => {
    const option = choice.entry
      ? {
          action: choice.action,
          label: choice.label,
          enabled: true,
          completed: false,
          target: choice.target,
          requires_confirmation: false,
          reason: "",
          effect: "",
        }
      : play.available_actions?.find((a) => a.action === choice.action);
    return option
      ? [
          {
            ...option,
            label: choice.label,
            target: choice.target ?? option.target,
          },
        ]
      : [];
  });
  const stageChoices =
    state.node === "act_3_follow_up"
      ? []
      : state.node === "act_1_invitation"
        ? sceneOptions.filter((a) => a.action === "attend_farewell")
        : state.node === "act_1_farewell"
          ? sceneOptions.filter((a) => a.action === "contact_wang")
          : authoredChoices.length
            ? authoredChoices
            : sceneOptions.filter((a) => a.enabled).slice(0, 3);
  return (
    <main
      className={s.root}
      style={{
        backgroundImage: `linear-gradient(180deg,rgba(9,20,20,.3),rgba(9,20,20,.5)),url(${imageSource(scene.background, 1280)})`,
      }}
    >
      <header className={s.header}>
        <div>
          <Link to="/">言外之意</Link>
          <h2>{scene.title}</h2>
          <small>
            {scene.time} · {scene.location}
          </small>
        </div>
        <div className={s.metrics}>
          {[
            ["舆论温度", state.heat],
            ["专业信用", state.credit],
            ["内耗", state.rumination],
            ["工作压力", state.pressure],
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <meter
                min={0}
                max={100}
                low={30}
                high={70}
                value={Number(value)}
                aria-label={String(label)}
              />
            </div>
          ))}
        </div>
      </header>
      {!state.ending && (
        <Portraits
          story={story}
          speaker={
            scripted
              ? lines[position]!.speaker
              : "npc" in (last ?? {})
                ? (last as { npc: string }).npc
                : "sun"
          }
          portraits={scripted ? lines[position]!.portraits : undefined}
          player
        />
      )}
      <nav className={s.toolbar}>
        {(
          [
            ["phone", "我的手机"],
            ["work", "工作系统"],
            ["relations", "关系图"],
            ["discussion", "知乎众议"],
          ] as const
        ).map(([id, label]) => (
          <Button
            type="button"
            variant="secondary"
            key={id}
            onClick={() => {
              setPanel(id);
              setContact(null);
            }}
          >
            {label}
            {id === "work" && state.work?.purchase === "returned"
              ? " · 待处理"
              : ""}
          </Button>
        ))}
        <Button
          type="button"
          variant="secondary"
          onClick={() => setPanel("history")}
        >
          完整记录
        </Button>
        <Button
          type="button"
          variant="secondary"
          isDisabled={busy || !!controller.pending || loggingOut}
          onClick={() => void navigate("/saves")}
        >
          返回存档
        </Button>
        <Button
          type="button"
          variant="secondary"
          isDisabled={loggingOut}
          onClick={() => void logout()}
        >
          退出登录
        </Button>
        <label>
          <input
            type="checkbox"
            checked={reduced}
            onChange={(e) => setReduced(e.target.checked)}
          />
          减少动态
        </label>
      </nav>
      {state.ending ? (
        <Ending state={state} save={save} userId={userId} />
      ) : (
        <section className={s.dialogue}>
          {!performanceReady ? (
            <p role="status">正在切换场景…</p>
          ) : scripted ? (
            <Script
              key={`${state.node}:${position}`}
              lines={lines}
              position={position}
              reduced={reduced}
              advance={() => void mark(state.node ?? "prologue", position + 1)}
            />
          ) : (
            <>
              <strong>
                {names[(last?.speaker ?? "system") as keyof typeof names] ??
                  "现场"}
              </strong>
              <p className={s.current}>{last?.text || save.scene_intro}</p>
              <Actions
                options={stageChoices}
                act={(action, npc) => {
                  const entry = scene.choices.find(
                    (choice) => choice.action === action,
                  )?.entry;
                  if (entry === "phone") {
                    setPanel("phone");
                    setContact(npc ?? "sun");
                  } else if (entry === "work") setPanel("work");
                  else act(action, npc);
                }}
                busy={busy}
              />
              {state.node === "act_3_follow_up" &&
                play.available_actions?.some(
                  (a) => a.action === "follow_up" && a.enabled,
                ) && (
                  <div className={s.actions}>
                    {followUpChoices.map(([response, label]) => (
                      <Button
                        type="button"
                        variant="secondary"
                        key={response}
                        isDisabled={busy}
                        onClick={() =>
                          act("follow_up", "sun", {
                            params: { boundary_response: response },
                          })
                        }
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                )}
              <div className={s.dialogueFooter}>
                {state.act > 0 && composer()}
                <div className={s.actControls} aria-label="幕次操作">
                  {sceneOptions.some((a) => a.action === "close_story") && (
                    <Button
                      type="button"
                      variant="secondary"
                      isDisabled={busy}
                      onClick={() => act("close_story")}
                    >
                      按当前进度结束本局
                    </Button>
                  )}
                  {sceneOptions.some((a) => a.action === "next") && (
                    <Button
                      type="button"
                      variant="secondary"
                      isDisabled={busy}
                      onClick={() => act("next")}
                    >
                      带着当前进度进入下一幕 →
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
          {readError && (
            <p role="alert">
              {readError}
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  void mark(state.node ?? "prologue", position + 1)
                }
              >
                重试保存阅读位置
              </Button>
            </p>
          )}
          {state.quiet_turns >= 3 && (
            <p>这几轮没有新增进展。可以查看工作事项、表达边界，或继续故事。</p>
          )}
        </section>
      )}
      <div className={s.status} role="status">
        {controller.status}
        <ErrorNotice error={controller.issue} message={controller.error} />
        <ErrorNotice
          error={logoutError}
          onRetry={() => void logout()}
          retryLabel="重试退出"
          disabled={loggingOut}
        />
        {controller.pending && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void controller.recover()}
          >
            恢复回合结果
          </Button>
        )}
        {!play.ai?.available && <p>AI 暂不可用，工作和剧情行动仍可继续。</p>}
      </div>
      {play.proposal && (
        <dialog
          ref={confirmation}
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) act("cancel_proposal");
          }}
          className={s.confirm}
          role="alertdialog"
          aria-label="确认重要决定"
        >
          <strong>{play.proposal.label}</strong>
          <p>{play.proposal.effect}</p>
          {["leave", "submit_exit"].includes(play.proposal.action) &&
            state.exit_draft && (
              <>
                <p>
                  申请类型：
                  {
                    { resign: "离职", transfer: "调岗", withdraw: "退出合作" }[
                      state.exit_draft.kind
                    ]
                  }
                </p>
                <p>{state.exit_draft.reason}</p>
                <p>提交表示开始申请，不代表手续已经完成。</p>
              </>
            )}
          <Button
            type="button"
            variant="secondary"
            isDisabled={busy}
            onClick={() =>
              act(
                play.proposal!.action,
                play.available_actions?.find(
                  (a) => a.action === play.proposal!.action,
                )?.target ?? "sun",
                { proposal_id: play.proposal!.id },
              )
            }
          >
            确认并提交
          </Button>
          <Button
            type="button"
            variant="secondary"
            isDisabled={busy}
            onClick={() => act("cancel_proposal")}
          >
            暂不执行
          </Button>
        </dialog>
      )}
      {interlude && (
        <SceneInterlude
          scene={story.acts[state.act]?.interlude ?? null}
          onClose={() => setInterlude(false)}
          onContinue={() => {
            act("next");
            setInterlude(false);
          }}
        />
      )}
      <Modal
        isOpen={panel !== null}
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
      >
        <Modal.Backdrop>
          <Modal.Container placement="center" className={s.drawerShell}>
            <Modal.Dialog className={s.drawer}>
              <Modal.Header className={s.drawerHeader}>
                <Modal.Heading>
                  {
                    {
                      phone: "我的手机",
                      work: "工作系统",
                      relations: "关系图",
                      discussion: "知乎众议",
                      history: "本局记录",
                    }[panel ?? "phone"]
                  }
                </Modal.Heading>
                <Button
                  type="button"
                  variant="secondary"
                  aria-label="关闭面板"
                  onClick={() => setPanel(null)}
                >
                  关闭 ×
                </Button>
              </Modal.Header>
              <Modal.Body className={s.drawerBody}>
                {panel === "phone" && (
                  <>
                    {contact ? (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setContact(null)}
                        >
                          ← 会话列表
                        </Button>
                        <h3>
                          {contact === "group" ? "项目工作群" : names[contact]}
                        </h3>
                        <div className={s.messages}>
                          {conversation.hasNextPage && (
                            <Button
                              type="button"
                              variant="secondary"
                              isDisabled={conversation.isFetchingNextPage}
                              onClick={() => void conversation.fetchNextPage()}
                            >
                              加载更早消息
                            </Button>
                          )}
                          {conversation.error && (
                            <p role="alert">
                              会话读取失败。
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => void conversation.refetch()}
                              >
                                重试读取
                              </Button>
                            </p>
                          )}
                          {npcEvents.map((e) => (
                            <p key={e.id}>
                              <strong>
                                {e.speaker === "system"
                                  ? "事件记录"
                                  : e.kind === "npc"
                                    ? names[e.npc]
                                    : "我"}
                                ：
                              </strong>
                              {e.text}
                            </p>
                          ))}
                          {!npcEvents.length && (
                            <p>
                              {contact === "group"
                                ? "群内只发布已核实的工作事实。"
                                : story.npcs[contact]?.greeting}
                            </p>
                          )}
                        </div>
                        {contact === "group" && (
                          <Actions
                            options={(play.available_actions ?? []).filter(
                              (a) =>
                                [
                                  "clarify",
                                  "review_clarification",
                                  "trace_rumor",
                                ].includes(a.action),
                            )}
                            act={act}
                            busy={busy}
                          />
                        )}
                        {composer(true)}
                      </>
                    ) : (
                      <>
                        {[...contacts, "group" as const].map((n) => {
                          const messages = play.events.filter(
                            (e) =>
                              e.channel === (n === "group" ? "group" : "dm") &&
                              (n === "group" || e.npc === n),
                          );
                          const unread =
                            play.contacts?.[n]?.unread ??
                            messages.length >
                              (positions[n === "group" ? "group" : `dm_${n}`] ??
                                0);
                          return (
                            <Button
                              type="button"
                              variant="secondary"
                              className={s.contact}
                              key={n}
                              onClick={() => {
                                setContact(n);
                                void mark(
                                  n === "group" ? "group" : `dm_${n}`,
                                  play.contacts?.[n]?.count ?? messages.length,
                                );
                              }}
                            >
                              <strong>
                                {n === "group" ? "项目工作群" : names[n]}
                                {unread ? " · 未读" : ""}
                              </strong>
                              <small>
                                {play.contacts?.[n]?.preview ||
                                  messages.at(-1)?.text ||
                                  "打开会话"}
                              </small>
                            </Button>
                          );
                        })}
                      </>
                    )}
                  </>
                )}
                {panel === "work" && (
                  <Work
                    state={state}
                    options={play.available_actions ?? []}
                    act={act}
                    busy={busy}
                  />
                )}
                {panel === "relations" && (
                  <Relations
                    save={save}
                    userId={userId}
                    options={play.available_actions ?? []}
                    act={act}
                    busy={busy}
                  />
                )}
                {panel === "discussion" && (
                  <Discussion
                    save={save}
                    userId={userId}
                    fill={(text, job, card) => {
                      writeDraft(
                        userId,
                        save.id,
                        "sun",
                        {
                          text,
                          act: state.act,
                          discussion_id: job,
                          perspective_id: card,
                        },
                        "scene:sun",
                      );
                      refresh((n) => n + 1);
                      setPanel(null);
                    }}
                  />
                )}
                {panel === "history" && (
                  <>
                    <EventHistory
                      userId={userId}
                      saveId={save.id}
                      version={save.version}
                    />
                    <ProductPanel
                      save={save}
                      userId={userId}
                      events={play.events}
                      disabled={busy}
                      initiallyOpen
                      fillDraft={(text, job, card) => {
                        writeDraft(
                          userId,
                          save.id,
                          "sun",
                          {
                            text,
                            act: state.act,
                            discussion_id: job,
                            perspective_id: card,
                          },
                          "scene:sun",
                        );
                        refresh((n) => n + 1);
                        setPanel(null);
                      }}
                    />
                  </>
                )}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </main>
  );
}
