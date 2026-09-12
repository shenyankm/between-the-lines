import { useEffect, useRef, useState } from "react";
import { actBackground, interludes } from "./scenes";
import { SceneInterlude } from "./SceneInterlude";
import { Link, Route, Routes, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  Clock3,
  Feather,
  History,
  LogOut,
  MessageSquare,
  RefreshCw,
  Send,
  Smartphone,
  Sparkles,
  X,
} from "lucide-react";
import { api, ApiError, sendTurn } from "./api";
import { useUI } from "./store";
import type { Action, GameEvent, Npc, Result, Save, Story } from "./types";
import s from "./App.module.css";

function Home() {
  const navigate = useNavigate(),
    client = useQueryClient();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () =>
      api<{
        dev_login: boolean;
        zhihu_login: boolean;
        agent_mode: string;
        model_ready: boolean;
      }>("/config"),
  });
  const user = useQuery({
    queryKey: ["user"],
    queryFn: () => api<{ name: string }>("/auth/me"),
  });
  const saves = useQuery({
    queryKey: ["saves"],
    queryFn: () => api<Save[]>("/saves"),
    enabled: !!user.data,
  });
  async function start() {
    setBusy(true);
    setError("");
    try {
      const save = await api<Save>("/saves", {});
      await client.invalidateQueries({ queryKey: ["saves"] });
      void navigate(`/play/${save.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function login() {
    setBusy(true);
    setError("");
    try {
      await api("/auth/dev", { name: "试玩者" });
      await client.invalidateQueries({ queryKey: ["user"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={s.home}>
      <nav className={s.topbar}>
        <span className={s.brand}>
          <Feather size={22} /> BETWEEN THE LINES
        </span>
        <span className={s.muted}>互动职场小说 · 第一季</span>
      </nav>
      <div className={s.homeContent}>
        <div className={s.overline}>一段关于关系与边界的故事</div>
        <h1>
          言外<span>之意</span>
        </h1>
        <div className={s.titleRule} />
        <p className={s.tagline}>
          有些话没有说出口，
          <br />
          却悄悄改变了你的位置。
        </p>
        <p className={s.description}>
          成为研发专员周凌，在对话、流言与工作之间，
          <br className={s.desktop} />
          找到属于自己的回应。
        </p>
        {user.data ? (
          <div className={s.homeActions}>
            <button
              className={s.primary}
              disabled={busy}
              onClick={() => void start()}
            >
              开始新的故事 <ArrowRight size={18} />
            </button>
            {saves.data?.[0] && (
              <Link className={s.secondary} to={`/play/${saves.data[0].id}`}>
                继续上次的故事 <Bookmark size={17} />
              </Link>
            )}
            <Link className={s.textButton} to="/saves">
              查看全部存档
            </Link>
          </div>
        ) : (
          <div className={s.homeActions}>
            <a
              className={`${s.primary} ${!config.data?.zhihu_login ? s.disabled : ""}`}
              href={config.data?.zhihu_login ? "/api/auth/zhihu" : undefined}
              aria-disabled={!config.data?.zhihu_login}
            >
              知乎账号登录 <ArrowRight size={18} />
            </a>
            {config.data?.dev_login && (
              <button
                className={s.secondary}
                disabled={busy}
                onClick={() => void login()}
              >
                开发环境试玩 <ChevronRight size={17} />
              </button>
            )}
          </div>
        )}
        {config.data?.agent_mode === "mock" && (
          <p className={s.notice}>当前为开发演示，角色使用预设回复。</p>
        )}
        {config.data && !config.data.model_ready && (
          <p className={s.notice}>
            AI 对话尚未配置。可查看故事，角色对话暂不可用。
          </p>
        )}
        {config.data && !config.data.zhihu_login && (
          <p className={s.muted}>知乎登录待接入</p>
        )}
        {(error || config.error) && (
          <p role="alert" className={s.error}>
            {error || "无法连接服务，请确认后端已启动。"}
          </p>
        )}
      </div>
      <footer className={s.homeFooter}>
        <span>每一个选择，都值得被认真对待。</span>
        <span>01 / 职场篇</span>
      </footer>
    </main>
  );
}

function Saves() {
  const saves = useQuery({
    queryKey: ["saves"],
    queryFn: () => api<Save[]>("/saves"),
  });
  return (
    <main className={s.page}>
      <Link to="/" className={s.back}>
        <ArrowLeft size={16} />
        返回
      </Link>
      <h1>我的故事</h1>
      <p className={s.muted}>每个存档都是独立的一段经历。</p>
      {saves.isLoading && <p>正在读取…</p>}
      {saves.error && <p role="alert">请先登录后查看存档。</p>}
      {saves.data?.length === 0 && <p>还没有故事，从第一句话开始。</p>}
      <div className={s.saveGrid}>
        {saves.data?.map((item, i) => (
          <Link to={`/play/${item.id}`} key={item.id} className={s.saveCard}>
            <Bookmark />
            <h2>故事 {saves.data.length - i}</h2>
            <p>{item.state.ending || `第 ${item.state.act} 幕`}</p>
            <span>
              专业信用 {item.state.credit} · 心绪消耗 {item.state.stress}
            </span>
            <ChevronRight />
          </Link>
        ))}
      </div>
    </main>
  );
}

function Play() {
  const { id = "" } = useParams(),
    navigate = useNavigate(),
    client = useQueryClient();
  const { npc, panel, selectNpc, setPanel } = useUI();
  const saveQuery = useQuery({
    queryKey: ["save", id],
    queryFn: () => api<Save>(`/saves/${id}`),
  });
  const storyQuery = useQuery({
    queryKey: ["story"],
    queryFn: () => api<Story>("/story"),
  });
  const eventsQuery = useQuery({
    queryKey: ["events", id],
    queryFn: () => api<GameEvent[]>(`/saves/${id}/events`),
  });
  const [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const [pending, setPending] = useState<string | null>(() =>
    sessionStorage.getItem(`pending:${id}`),
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [interludeAct, setInterludeAct] = useState<number | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (panel) dialog?.showModal();
    else dialog?.close();
  }, [panel]);
  useEffect(() => {
    setPending(sessionStorage.getItem(`pending:${id}`));
    setError("");
    setPanel(null);
  }, [id, setPanel]);
  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["save", id] }),
      client.invalidateQueries({ queryKey: ["events", id] }),
      client.invalidateQueries({ queryKey: ["saves"] }),
    ]);
  }
  function resolved(result: Result) {
    if (result.save) client.setQueryData(["save", id], result.save);
    if (result.status === "failed")
      setError(result.text || "回合未完成，请刷新后继续。");
    sessionStorage.removeItem(`pending:${id}`);
    setPending(null);
  }
  async function recover() {
    if (!pending) return;
    setBusy(true);
    setError("");
    try {
      const turn = await api<{ status: string; result: Result | null }>(
        `/saves/${id}/turns/${pending}`,
      );
      if (turn.status === "running") setError("这一回合仍在处理，请稍后恢复。");
      else if (turn.result) resolved(turn.result);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 404) {
        sessionStorage.removeItem(`pending:${id}`);
        setPending(null);
      }
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    await api("/auth/logout", {});
    client.clear();
    void navigate("/");
  }
  async function act(action: Action, text = "", target: Npc = npc) {
    if (!saveQuery.data || busy || pending) return;
    setBusy(true);
    setError("");
    setStatus("正在提交…");
    const requestId = crypto.randomUUID();
    sessionStorage.setItem(`pending:${id}`, requestId);
    setPending(requestId);
    try {
      const result = await sendTurn(
        id,
        saveQuery.data.version,
        target,
        action,
        text,
        requestId,
        setStatus,
      );
      resolved(result);
      setInput("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      if ("status" in (e as object)) {
        sessionStorage.removeItem(`pending:${id}`);
        setPending(null);
      }
      await refresh();
    } finally {
      setBusy(false);
      setStatus("");
    }
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
  const options: { label: string; action: Action; target?: Npc }[] =
    state.act === 0
      ? [{ label: "进入故事", action: "begin" }]
      : state.act === 1
        ? [
            { label: "私信祝福王会计", action: "contact_wang" },
            { label: "明确表达我的边界", action: "boundary" },
            { label: "当众质问孙淼", action: "public_confront" },
          ]
        : state.act === 2
          ? [
              { label: "补齐采购材料", action: "supplement" },
              { label: "向张工同步进度", action: "report", target: "zhang" },
            ]
          : [
              { label: "在例会上澄清传言", action: "clarify" },
              { label: "提交实验结果", action: "deliver" },
            ];
  return (
    <main className={s.game}>
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
              <span>{a.title.split(" · ")[1]}</span>
            </span>
          ))}
        </div>
        <Link to="/saves" className={s.iconText}>
          <Bookmark size={17} />
          <span>存档</span>
        </Link>
      </header>
      <section
        className={s.stage}
        style={
          {
            "--character-color":
              npc === "sun" ? "#688999" : npc === "li" ? "#998363" : "#768c89",
            "--scene-background": `url("${actBackground(state.act)}")`,
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
            src={`/assets/${npc}.png`}
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
      <section className={s.conversation}>
        <div className={s.speakerRow}>
          <div className={s.speaker}>
            <span className={s.speakerDot} />
            {state.ending ? "故事结局" : character.name}
            <small>{state.ending ? "你留下的边界" : character.role}</small>
          </div>
          <span className={s.saved}>
            <Check size={13} />
            已存档 · {save.version}
          </span>
        </div>
        {state.ending ? (
          <div className={s.ending}>
            <h1>{state.ending}</h1>
            <p>
              {[...events].reverse().find((e) => e.kind === "epilogue")?.text ||
                "故事结局已保存，回顾文字还未生成。"}
            </p>
            {!events.some((e) => e.kind === "epilogue") && (
              <button
                className={s.secondary}
                disabled={disabled}
                onClick={() => void act("epilogue")}
              >
                生成故事回顾
              </button>
            )}
            <Link className={s.primary} to="/saves">
              回看我的故事 <ArrowRight size={18} />
            </Link>
            <a
              className={s.textButton}
              href="https://www.zhihu.com/question/668921709"
              target="_blank"
              rel="noreferrer"
            >
              阅读相关职场讨论 ↗
            </a>
          </div>
        ) : (
          <>
            <p className={s.dialogue}>
              {state.act === 0
                ? scene.intro
                : lastReply?.text ||
                  (npc === "sun"
                    ? "“菱菱，你不会又生气了吧？我只是随口一说。”"
                    : npc === "li"
                      ? "“有什么事情，我们一项一项说。”"
                      : "“坐吧，项目最近怎么样？”")}
            </p>
            <div className={s.choices}>
              {options.map(({ label, action, target }) => (
                <button
                  key={action}
                  disabled={disabled}
                  onClick={() => void act(action, "", target)}
                >
                  <span>{label}</span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
            {state.act > 0 && (
              <form
                className={s.composer}
                onSubmit={(e) => {
                  e.preventDefault();
                  void act("speak", input);
                }}
              >
                <MessageSquare size={18} />
                <input
                  aria-label="对角色说的话"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  maxLength={1500}
                  placeholder="也可以用自己的话回应…"
                  disabled={disabled}
                />
                <button
                  type="submit"
                  aria-label="发送"
                  disabled={disabled || !input.trim()}
                >
                  <Send size={18} />
                </button>
              </form>
            )}
            <div className={s.conversationFooter}>
              <span>{busy ? status : "你的表达，会成为故事的一部分。"}</span>
              {state.act > 0 && (
                <button
                  disabled={disabled}
                  onClick={() =>
                    interludes[state.act]
                      ? setInterludeAct(state.act)
                      : void act("next")
                  }
                >
                  继续故事 <ArrowRight size={16} />
                </button>
              )}
            </div>
          </>
        )}
        {error && (
          <div role="alert" className={s.error}>
            {error}
          </div>
        )}
        {pending && !busy && (
          <button className={s.textButton} onClick={() => void recover()}>
            <RefreshCw size={16} />
            恢复回合结果
          </button>
        )}
      </section>
      {interludeAct !== null && (
        <SceneInterlude
          key={`${id}:${interludeAct}`}
          act={interludeAct}
          onClose={() => setInterludeAct(null)}
          onContinue={() => {
            setInterludeAct(null);
            void act("next");
          }}
        />
      )}
      {/* Backdrop click is a pointer-only convenience: the native <dialog>
          already gives keyboard users the same dismissal path, because
          Escape fires onCancel above. Both a11y rules model the element as
          a non-interactive static node and miss that native behaviour. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- native <dialog> keyboard parity via Esc/onCancel */}
      <dialog
        ref={dialogRef}
        className={s.drawer}
        onCancel={() => setPanel(null)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setPanel(null);
        }}
      >
        <div className={s.drawerInside}>
          <div className={s.drawerHeader}>
            <h2>
              {
                {
                  phone: "手机",
                  work: "工作系统",
                  tips: "锦囊",
                  history: "故事回顾",
                }[panel || "phone"]
              }
            </h2>
            <button aria-label="关闭面板" onClick={() => setPanel(null)}>
              <X />
            </button>
          </div>
          {panel === "phone" && (
            <>
              <p className={s.muted}>联系人</p>
              {(Object.keys(story.npcs) as Npc[]).map((key) => (
                <button
                  className={`${s.contact} ${key === npc ? s.selectedContact : ""}`}
                  key={key}
                  onClick={() => {
                    selectNpc(key);
                    setPanel(null);
                  }}
                >
                  <img className={s.avatar} src={`/assets/${key}.png`} alt="" />
                  <span>
                    <strong>{story.npcs[key].name}</strong>
                    <small>{story.npcs[key].role}</small>
                  </span>
                  <ChevronRight size={18} />
                </button>
              ))}
              <article className={s.note}>
                <span className={s.overline}>朋友圈 · 王会计</span>
                <p>感谢大家的祝福，正式开启退休生活！</p>
                <small>
                  {state.flags.includes("wang_contacted")
                    ? "已发送私人祝福"
                    : "你还没有联系王会计"}
                </small>
              </article>
            </>
          )}
          {panel === "work" && (
            <>
              <span className={s.overline}>RD-2026-017</span>
              <h3>催化剂优化 · 加急采购</h3>
              <p className={s.muted}>
                {state.procurement === "approved"
                  ? "审核已通过，材料可以进入采购。"
                  : "当前状态：等待财务审核"}
              </p>
              {[
                { key: "requirements", label: "确认材料要求" },
                { key: "materials", label: "提交报价与用途说明" },
                { key: "reported", label: "同步项目进度风险" },
                { key: "supported", label: "获得研发支持" },
              ].map((item) => (
                <div className={s.checkRow} key={item.key}>
                  <span
                    className={
                      state.flags.includes(item.key) ? s.checked : s.unchecked
                    }
                  >
                    {state.flags.includes(item.key) ? (
                      <Check size={14} />
                    ) : null}
                  </span>
                  {item.label}
                </div>
              ))}
              <div className={s.note}>
                先与孙淼或李姐对话确认材料要求；补齐后，请李姐审核。张工可以提供项目支持，但不能代替财务审批。
              </div>
              {state.act > 0 && !state.ending && (
                <button
                  className={s.textButton}
                  disabled={disabled}
                  onClick={() => {
                    if (window.confirm("确定让这段故事以主动离开结束吗？")) {
                      void act("leave");
                      setPanel(null);
                    }
                  }}
                >
                  选择离开当前环境
                </button>
              )}
            </>
          )}
          {panel === "tips" &&
            story.tips.map((tip) => (
              <article className={s.note} key={tip.title}>
                <Sparkles size={20} />
                <h3>{tip.title}</h3>
                <p>{tip.text}</p>
                <small>{tip.source}</small>
              </article>
            ))}
          {panel === "history" && (
            <>
              {events.length === 0 && <p>还没有记录。</p>}
              {events.map((event) => (
                <article className={s.historyItem} key={event.id}>
                  <small>
                    {event.kind === "player"
                      ? "周凌"
                      : event.kind === "work"
                        ? "工作记录"
                        : event.kind === "epilogue"
                          ? "结局回顾"
                          : story.npcs[event.npc]?.name}
                  </small>
                  <p>{event.text}</p>
                </article>
              ))}
            </>
          )}
        </div>
      </dialog>
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

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/saves" element={<Saves />} />
      <Route path="/play/:id" element={<Play />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
