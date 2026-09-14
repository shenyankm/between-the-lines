import { Smartphone, BriefcaseBusiness, Sparkles } from "lucide-react";
import { Form, TextArea, Button } from "@heroui/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { isEvent } from "../../contracts";
import type { GameEvent } from "../../types";
import { Link, useNavigate } from "react-router";
import { api, gameApi } from "../../api";
import type { Action, Npc, PlayState, Story, TurnInput } from "../../types";
import { playKey, useTurnController } from "../game/useTurnController";
import {
  clearIdentityDrafts,
  readDraft,
  writeDraft,
  readFormDraft,
  writeFormDraft,
} from "../game/drafts";
import { ProductPanel } from "../game/ProductPanel";
import { EventHistory } from "../game/EventHistory";
import { SceneInterlude } from "../../SceneInterlude";
import { imageSource } from "../../images";
import { MetricDelta } from "./MetricDelta";
import { PhoneMessages } from "./PhoneMessages";
import { Portraits, Script, speakerSide } from "./Stage";
import { Actions, Work, type StateV3 } from "./Work";
import { followUpChoices } from "./followUp";
import { Relations } from "./Relations";
import { Discussion } from "./Discussion";
import { useFormDraft } from "./useFormDraft";
import { ClosingPreview } from "./ClosingPreview";
import { ActionReceipt } from "./ActionReceipt";
import { Ending } from "./Ending";
import s from "./V3.module.css";

import { ErrorNotice } from "../../ErrorNotice";

type Panel = "phone" | "work" | "relations" | "discussion" | "history" | null;
function outsidePanel(event: PointerEvent<HTMLDialogElement>) {
  const r = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < r.left ||
    event.clientX > r.right ||
    event.clientY < r.top ||
    event.clientY > r.bottom
  );
}
const contacts: Npc[] = ["sun", "wang", "li", "zhang"];
export function PlayV3({
  userId,
  play,
  story,
}: {
  userId: string;
  play: PlayState;
  story: Story;
}) {
  const backdropPressed = useRef(false);
  const client = useQueryClient();
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState<unknown>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  async function logout() {
    if (loggingOut) return false;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await gameApi.logout();
      clearIdentityDrafts(userId);
      await client.cancelQueries();
      client.clear();
      void navigate("/");
      return true;
    } catch (error) {
      setLogoutError(error);
      return false;
    } finally {
      setLoggingOut(false);
    }
  }
  const save = play.save,
    state = save.state as StateV3;
  const reading = useFormDraft(
    { userId, saveId: save.id },
    "reading-preferences",
    { size: "18", speed: "35" },
  );
  const textSize = ["18", "20", "23"].includes(reading.value.size ?? "")
    ? Number(reading.value.size)
    : 18;
  const textSpeed = ["0", "35", "70"].includes(reading.value.speed ?? "")
    ? Number(reading.value.speed)
    : 35;
  const [composingNode, setComposingNode] = useState<string | null>(null);
  const [requireMentions, setRequireMentions] = useState(false);
  const [panel, setPanel] = useState<Panel>(null),
    [contact, setContact] = useState<Npc | "group" | null>(null);
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(preference.matches);
    update();
    preference.addEventListener?.("change", update);
    return () => preference.removeEventListener?.("change", update);
  }, []);
  useEffect(() => {
    try {
      localStorage.removeItem(`reduced-motion:${userId}`);
    } catch {
      /* System preferences still work when storage is unavailable. */
    }
  }, [userId]);
  const [positions, setPositions] = useState<Record<string, number>>(
    play.reading ?? {},
  );
  const [interlude, setInterlude] = useState(false);
  const [readError, setReadError] = useState("");
  const [savingReading, setSavingReading] = useState(false);
  const panelDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const dialog = panelDialog.current;
    if (panel !== "phone" || !viewport || !dialog) return;
    const resize = () => {
      dialog.style.setProperty("--phone-height", `${viewport.height}px`);
      dialog.style.setProperty("--phone-top", `${viewport.offsetTop}px`);
    };
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
      dialog.style.removeProperty("--phone-height");
      dialog.style.removeProperty("--phone-top");
    };
  }, [panel]);

  useEffect(() => {
    const element = panelDialog.current;
    if (panel && element && !element.open) {
      element.showModal();
      element.querySelector<HTMLElement>("#story-panel-title")?.focus();
    }
    if (!panel && element?.open) element.close();
  }, [panel]);
  const confirmation = useRef<HTMLDialogElement>(null);
  const confirmationOrigin = useRef<HTMLElement | null>(null);
  const proposalId = play.proposal?.id;
  useEffect(() => {
    const dialog = confirmation.current;
    if (!proposalId || !dialog) return;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>("#decision-title")?.focus();
    return () => {
      if (confirmationOrigin.current?.isConnected)
        confirmationOrigin.current.focus();
    };
  }, [proposalId]);
  const [leaving, setLeaving] = useState<"home" | "logout" | null>(null);
  const leaveDialog = useRef<HTMLDialogElement>(null);
  const leaveOrigin = useRef<HTMLElement | null>(null);
  // One native dialog backs both account actions: the title takes focus and the
  // footer buttons carry the decision.
  useEffect(() => {
    const dialog = leaveDialog.current;
    if (!dialog || !leaving) return;
    leaveOrigin.current = document.activeElement as HTMLElement | null;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>("#leave-title")?.focus();
    return () => {
      if (leaveOrigin.current?.isConnected) leaveOrigin.current.focus();
    };
  }, [leaving]);
  async function confirmLeave() {
    if (leaving === "home") {
      setLeaving(null);
      void navigate("/");
    } else if (leaving === "logout" && (await logout())) setLeaving(null);
  }
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
      if (input.action === "supplement") {
        const old = readFormDraft(userId, save.id, "supplement") ?? {};
        const params = input.params;
        if (
          (old.note ?? "").trim() === (params?.supplement_note ?? "") &&
          (old.mentions ?? "").split(",").filter(Boolean).sort().join(",") ===
            [...(params?.mentions ?? [])].sort().join(",") &&
          (old.evidence ?? "").split(",").filter(Boolean).sort().join(",") ===
            [...(params?.evidence ?? [])].sort().join(",")
        ) {
          writeFormDraft(userId, save.id, "supplement", {
            note: "",
            mentions: "",
            evidence: "",
            kind: old.kind ?? "standard",
          });
          refresh((n) => n + 1);
        }
      }
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
      "request_materials",
      "dispute_return",
      "support_project",
      "joint_review",
      "request_extension",
      "correct_loss",
      "confirm_responsibility",
      "change_rules",
      "apply_rules",
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
      confirmationOrigin.current = panel
        ? document.querySelector<HTMLElement>(`[data-panel="${panel}"]`)
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setPanel(null);
      void controller.submit(save, "propose", "", npc, {
        ...metadata,
        proposed_action: action,
      });
    } else void controller.submit(save, action, "", npc, metadata);
  };
  async function mark(key: string, position: number) {
    setSavingReading(true);
    try {
      await api(`/saves/${save.id}/reading`, { key, position });
      setPositions((p) => ({ ...p, [key]: position }));
      client.setQueryData<PlayState>(playKey(userId, save.id), (cached) =>
        cached
          ? { ...cached, reading: { ...cached.reading, [key]: position } }
          : cached,
      );
      setReadError("");
    } catch {
      setReadError("阅读位置尚未保存，请重试。");
    } finally {
      setSavingReading(false);
    }
  }
  const performanceReady =
    (play.performance_version ?? play.save.version) === save.version;
  const lines =
    play.performance ?? story.scenes?.[state.node ?? "prologue"] ?? [];
  const readPosition = positions[state.node ?? "prologue"] ?? 0;
  // Older saves may already have read the final prologue line. Keep the entry
  // action on that line until the server commits the transition to act one.
  const position =
    state.act === 0 && lines.length
      ? Math.min(readPosition, lines.length - 1)
      : readPosition;
  const enterStory = state.act === 0 && position === lines.length - 1;
  const scripted = performanceReady && position < lines.length;
  const currentLine = scripted ? lines[position] : lines.at(-1);
  const identity =
    state.act === 0 && scripted && currentLine?.id === "identity";
  const monologue = state.act === 0 && scripted && currentLine?.id === "inner";
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
  const workRecordCount =
    (state.work?.submissions?.length ?? 0) + (state.work?.reviews?.length ?? 0);
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
      className={`${s.composer} ${dm ? s.phoneComposer : ""}`}
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
      <div className={s.recipient}>
        <p id={dm ? "dm-recipient" : "scene-recipient"}>
          {dm
            ? contact === "group"
              ? "工作群 · 研发部工作群"
              : `私聊 · ${names[target]}`
            : "现场 · 对孙淼说"}
        </p>
        {!dm && (
          <Button
            variant="secondary"
            onClick={() => {
              setPanel("phone");
              setContact(null);
            }}
          >
            切换对话对象
          </Button>
        )}
      </div>
      <label className={s.sr} htmlFor={dm ? "dm-input" : "scene-input"}>
        自由表达
      </label>
      <TextArea
        id={dm ? "dm-input" : "scene-input"}
        onFocus={() => {
          if (!dm) setComposingNode(state.node ?? "prologue");
        }}
        aria-describedby={dm ? "dm-recipient" : "scene-recipient"}
        maxLength={1500}
        value={draft.text}
        rows={dm ? 2 : undefined}
        onChange={(e) => {
          setInput(e.target.value);
          if (dm) {
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
          }
        }}
        placeholder={
          dm
            ? contact === "group"
              ? "在工作群发言…"
              : `给${names[target]}发消息…`
            : "写下你真正想说的话…"
        }
      />
      <Button
        variant="primary"
        type="submit"
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
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === save.id &&
      previousQuery.queryKey[3] === contact
        ? previous
        : undefined,
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
          : state.act === 1 &&
              state.flags.some((flag) =>
                [
                  "appeased:act_1",
                  "boundary:act_1",
                  "farewell_requested",
                ].includes(flag),
              )
            ? []
            : authoredChoices.length
              ? authoredChoices
              : sceneOptions.filter((a) => a.enabled).slice(0, 3);
  const feedback = (
    <div className={s.status} aria-label="操作反馈">
      {controller.savedStatus && !controller.saved && (
        <p role="status">{controller.savedStatus}</p>
      )}
      {controller.status && <p role="status">{controller.status}</p>}
      <ErrorNotice error={controller.issue} message={controller.error} />
      {!leaving && (
        <ErrorNotice
          error={logoutError}
          onRetry={() => void logout()}
          retryLabel="重试退出"
          disabled={loggingOut}
        />
      )}
      {controller.pending && (
        <Button
          variant="secondary"
          isDisabled={controller.busy}
          onClick={() => void controller.recover()}
        >
          恢复回合结果
        </Button>
      )}
      {readError && (
        <p role="alert">
          {readError}
          <Button
            variant="secondary"
            onClick={() => void mark(state.node ?? "prologue", position + 1)}
          >
            重试保存阅读位置
          </Button>
        </p>
      )}
      {!play.ai?.available && <p>AI 暂不可用，工作和剧情行动仍可继续。</p>}
    </div>
  );
  return (
    <main
      className={s.root}
      data-identity={identity}
      data-monologue={monologue}
      data-prologue={state.act === 0 && scripted}
      data-composing={composingNode === (state.node ?? "prologue")}
      style={
        {
          "--story-text-size": `${textSize}px`,
          backgroundImage:
            state.act === 0
              ? `url(${imageSource("/assets/company-exterior.png", 1672)})`
              : `linear-gradient(180deg,rgba(9,20,32,.12),rgba(9,20,32,.4)),url(${imageSource(scene.background, 1280)})`,
        } as CSSProperties
      }
    >
      <header className={s.header}>
        <div>
          <Link to="/">章外回声</Link>
          <h2>{scene.title}</h2>
          <small>
            {scene.time} · {scene.location}
          </small>
        </div>
        <div className={s.metricPanel}>
          {controller.saved && !controller.pending && !controller.error && (
            <small className={s.savedHint} role="status">
              已保存
            </small>
          )}
          <div className={s.metrics}>
            {[
              ["舆论温度", state.heat],
              ["专业信用", state.credit],
              ["内耗", state.rumination],
              ["工作压力", state.pressure],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>
                  {value}
                  <MetricDelta
                    key={save.id}
                    version={save.version}
                    value={Number(value)}
                  />
                </strong>
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
        </div>
      </header>
      {!state.ending && (
        <Portraits
          story={story}
          speaker={currentLine?.speaker ?? "narrator"}
          portraits={
            identity ? ["player-coat"] : (currentLine?.portraits ?? [])
          }
          width={state.act === 0 ? 1024 : 512}
          player
        />
      )}

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
              speed={textSpeed}
              continueLabel={enterStory ? "进入故事" : undefined}
              disabled={busy || savingReading}
              advance={() => {
                if (enterStory) act("begin");
                else void mark(state.node ?? "prologue", position + 1);
              }}
            />
          ) : (
            <>
              <strong data-side={speakerSide(last?.speaker ?? "system")}>
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
                  } else if (entry === "work") {
                    setRequireMentions(
                      state.act === 2 && action === "supplement",
                    );
                    setPanel("work");
                    void mark("work", workRecordCount);
                  } else act(action, npc);
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
              <div className={s.dialogueControls}>
                {state.act > 0 && composer()}
                <div className={s.progressActions} aria-label="故事进度操作">
                  {sceneOptions.some((a) => a.action === "close_story") && (
                    <Button
                      variant="secondary"
                      isDisabled={busy}
                      onClick={() => act("close_story")}
                    >
                      按当前进度结束本局
                    </Button>
                  )}
                  {sceneOptions.some((a) => a.action === "next") && (
                    <Button
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
          {state.quiet_turns >= 3 && (
            <p>这几轮没有新增进展。可以查看工作事项、表达边界，或继续故事。</p>
          )}
          {!panel && !play.proposal && !interlude && feedback}
        </section>
      )}
      {state.ending && !panel && !play.proposal && !interlude && feedback}
      <nav className={s.toolbar} aria-label="故事工具与账户">
        <div className={s.storyTools}>
          {(
            [
              ["phone", "我的手机"],
              ["work", "工作系统"],
              ["relations", "关系图"],
              ["discussion", "知乎众议"],
            ] as const
          ).map(([id, label]) => (
            <Button
              variant="secondary"
              key={id}
              data-panel={id}
              onClick={() => {
                setRequireMentions(false);
                setPanel(id);
                setContact(null);
                if (id === "work") void mark("work", workRecordCount);
              }}
            >
              <span>
                {label}
                {id === "work" && workRecordCount > (positions.work ?? 0)
                  ? " · 未读"
                  : id === "work" && state.work?.purchase === "returned"
                    ? " · 待处理"
                    : ""}
              </span>
              {id === "phone" ? (
                <Smartphone size={18} aria-hidden="true" />
              ) : id === "work" ? (
                <BriefcaseBusiness size={18} aria-hidden="true" />
              ) : id === "relations" ? (
                <span aria-hidden="true">⌘</span>
              ) : (
                <Sparkles size={18} aria-hidden="true" />
              )}
            </Button>
          ))}
          <Button
            variant="secondary"
            data-panel="history"
            onClick={() => setPanel("history")}
          >
            完整记录
          </Button>
        </div>
        <div className={s.accountTools}>
          <Button
            variant="secondary"
            isDisabled={
              controller.busy ||
              !!controller.pending ||
              savingReading ||
              loggingOut
            }
            onClick={() => setLeaving("home")}
            aria-description={
              controller.busy || controller.pending
                ? "当前回合处理完成后可返回首页"
                : undefined
            }
          >
            返回首页
          </Button>
          <Button
            variant="secondary"
            isDisabled={loggingOut}
            onClick={() => setLeaving("logout")}
          >
            退出登录
          </Button>
        </div>
      </nav>
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
          aria-describedby="decision-title"
        >
          <header className={s.confirmHeader}>
            <h2 id="decision-title" tabIndex={-1}>
              {play.proposal.label}
            </h2>
          </header>
          <div className={s.confirmBody}>
            <p>{play.proposal.effect}</p>
            {play.proposal.action === "close_story" && (
              <ClosingPreview state={state} />
            )}
            {["leave", "submit_exit"].includes(play.proposal.action) &&
              state.exit_draft && (
                <>
                  <p>
                    申请类型：
                    {
                      {
                        resign: "离职",
                        transfer: "调岗",
                        withdraw: "退出合作",
                      }[state.exit_draft.kind]
                    }
                  </p>
                  <p>{state.exit_draft.reason}</p>
                  <p>提交表示开始申请，不代表手续已经完成。</p>
                </>
              )}
          </div>
          {!panel && !interlude && feedback}
          <footer className={s.confirmActions}>
            <Button
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
              variant="secondary"
              isDisabled={busy}
              onClick={() => act("cancel_proposal")}
            >
              暂不执行
            </Button>
          </footer>
        </dialog>
      )}
      {leaving && (
        <dialog
          ref={leaveDialog}
          className={s.confirm}
          role="alertdialog"
          aria-labelledby="leave-title"
          onCancel={(event) => {
            event.preventDefault();
            if (!loggingOut) setLeaving(null);
          }}
        >
          <header className={s.confirmHeader}>
            <h2 id="leave-title" tabIndex={-1}>
              {leaving === "home" ? "返回首页" : "退出登录"}
            </h2>
          </header>
          <div className={s.confirmBody}>
            {leaving === "home" ? (
              <p>
                将回到首页，可以随时继续这段故事；
                <br />
                已填写的输入会保留。
              </p>
            ) : (
              <p>
                退出后需要重新登录才能继续；
                <br />
                未提交的输入草稿会被清除，故事进度仍保留在存档中。
              </p>
            )}
            {leaving === "logout" && (
              <ErrorNotice
                error={logoutError}
                onRetry={() => void logout()}
                retryLabel="重试退出"
                disabled={loggingOut}
              />
            )}
          </div>
          <footer className={s.confirmActions}>
            <Button
              variant="secondary"
              isDisabled={loggingOut}
              onClick={() => void confirmLeave()}
            >
              {leaving === "home"
                ? "确认返回"
                : loggingOut
                  ? "正在退出…"
                  : "确认退出"}
            </Button>
            <Button
              variant="secondary"
              isDisabled={loggingOut}
              onClick={() => setLeaving(null)}
            >
              取消
            </Button>
          </footer>
        </dialog>
      )}
      {interlude && (
        <SceneInterlude
          feedback={feedback}
          scene={story.acts[state.act]?.interlude ?? null}
          onClose={() => setInterlude(false)}
          onContinue={() => {
            act("next");
            setInterlude(false);
          }}
        />
      )}
      <dialog
        ref={panelDialog}
        className={`${s.drawer} ${panel === "phone" ? s.phoneDrawer : panel === "work" ? s.workDrawer : panel === "discussion" ? s.discussionDrawer : ""}`}
        aria-labelledby="story-panel-title"
        onCancel={() => setPanel(null)}
        onPointerDown={(event) => {
          backdropPressed.current = outsidePanel(event);
        }}
        onPointerUp={(event) => {
          if (backdropPressed.current && outsidePanel(event)) setPanel(null);
        }}
      >
        <header className={s.drawerHeader}>
          {panel === "phone" && contact && (
            <Button
              variant="ghost"
              aria-label="返回会话列表"
              onClick={() => setContact(null)}
            >
              ← 会话列表
            </Button>
          )}
          <h2 id="story-panel-title" tabIndex={-1}>
            {
              {
                phone: contact
                  ? contact === "group"
                    ? "研发部工作群"
                    : names[contact]
                  : "通讯",
                work: "工作系统",
                relations: "关系图",
                discussion: "知乎众议",
                history: "本局记录",
              }[panel ?? "phone"]
            }
          </h2>
          {panel === "work" && (
            <>
              <small className={s.workMotto}>专注当下 · 成就更好的自己</small>
              <span className={s.workUser}>周菱菱</span>
            </>
          )}
          <Button
            variant="secondary"
            className={s.panelClose}
            aria-label="关闭面板"
            onClick={() => setPanel(null)}
          >
            关闭 ×
          </Button>
        </header>
        {panel && !play.proposal && !interlude && feedback}
        <div
          className={`${s.drawerBody} ${panel === "phone" ? s.phoneBody : ""}`}
        >
          {panel === "phone" && (
            <>
              {contact ? (
                <>
                  <PhoneMessages
                    key={`${save.id}:${contact}`}
                    story={story}
                    events={npcEvents}
                    loading={conversation.isPending}
                    error={!!conversation.error}
                    retry={() => void conversation.refetch()}
                    hasMore={conversation.hasNextPage}
                    loadingMore={conversation.isFetchingNextPage}
                    loadMore={() => void conversation.fetchNextPage()}
                    scene={story.acts[state.act]!}
                    group={contact === "group"}
                  />
                  <div className={s.phoneFooter}>
                    {contact === "group" && (
                      <Actions
                        options={(play.available_actions ?? []).filter((a) =>
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
                  </div>
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
                        (positions[n === "group" ? "group" : `dm_${n}`] ?? 0);
                    return (
                      <Button
                        variant="secondary"
                        className={s.contact}
                        key={n}
                        aria-label={`${n === "group" ? "研发部工作群" : names[n]}${unread ? " · 未读" : ""}`}
                        data-group={n === "group"}
                        onClick={() => {
                          setContact(n);
                          void mark(
                            n === "group" ? "group" : `dm_${n}`,
                            play.contacts?.[n]?.count ?? messages.length,
                          );
                        }}
                      >
                        {n === "group" ? (
                          <span className={s.avatar} aria-hidden="true">
                            群
                          </span>
                        ) : (
                          <img
                            className={s.avatar}
                            src={imageSource(
                              story.npcs[n]?.portrait ?? "",
                              256,
                            )}
                            alt=""
                          />
                        )}
                        <span className={s.contactText}>
                          <strong>
                            {n === "group" ? "研发部工作群" : names[n]}
                          </strong>
                          <small>
                            {play.contacts?.[n]?.preview ||
                              messages.at(-1)?.text ||
                              (n === "group"
                                ? "群聊"
                                : (story.npcs[n]?.role ?? "联系人"))}
                          </small>
                        </span>
                        {unread && (
                          <span className={s.unread} aria-hidden="true">
                            {Math.max(
                              0,
                              (play.contacts?.[n]?.count ?? messages.length) -
                                (positions[
                                  n === "group" ? "group" : `dm_${n}`
                                ] ?? 0),
                            ) || ""}
                          </span>
                        )}
                      </Button>
                    );
                  })}
                </>
              )}
            </>
          )}
          {panel === "work" && (
            <Work
              requireMentions={requireMentions}
              draftIdentity={{ userId, saveId: save.id }}
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
              <ActionReceipt
                play={play}
                openActions={() => setPanel("work")}
                act={act}
              />
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
        </div>
      </dialog>
    </main>
  );
}
