import { Button, Card } from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Bookmark, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ErrorNotice } from "../ErrorNotice";
import { ApiError, api, gameApi } from "../api";
import { isSave } from "../contracts";
import { clearIdentityDrafts } from "./game/drafts";
import s from "../App.module.css";
import { saveMetrics, saveTitle } from "./savePresentation";

export function Home() {
  const navigate = useNavigate(),
    client = useQueryClient();
  const [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const config = useQuery({
    queryKey: ["config"],
    queryFn: ({ signal }) => gameApi.config(signal),
  });
  const user = useQuery({
    queryKey: ["user"],
    queryFn: ({ signal }) => gameApi.user(signal),
    refetchInterval: (query) =>
      query.state.data?.binding_pending ? 1500 : false,
  });
  const saves = useQuery({
    queryKey: ["saves", user.data?.id],
    queryFn: ({ signal }) => gameApi.saves(signal),
    enabled:
      !!user.data &&
      !(user.error instanceof ApiError && user.error.status === 401),
  });
  useEffect(() => {
    if (
      !user.data ||
      user.data.identity_type === "guest" ||
      user.data.binding_pending
    )
      return;
    try {
      const previous = sessionStorage.getItem("trial_identity");
      if (previous) {
        clearIdentityDrafts(previous);
        for (const key of Object.keys(sessionStorage)) {
          if (key.startsWith(`pending:v1:${previous}:`))
            sessionStorage.removeItem(key);
        }
        sessionStorage.removeItem("trial_identity");
        void client.invalidateQueries({ queryKey: ["saves"] });
      }
    } catch {
      /* Server identity remains authoritative. */
    }
  }, [user.data, client]);
  const activeSaves =
    saves.data?.filter((s) => !s.deleted_at && !s.archived_at) ?? [];
  const latest = activeSaves.find((s) => !s.state.ending) ?? activeSaves[0];
  async function trial() {
    setBusy(true);
    setError(null);
    try {
      const identity = await gameApi.guest();
      try {
        sessionStorage.setItem("trial_identity", identity.id);
      } catch {
        /* Memory-free guest resumption remains available from the server. */
      }
      await client.invalidateQueries({ queryKey: ["user"] });
      const existing = await gameApi.saves();
      const save =
        existing.find((s) => !s.deleted_at && !s.archived_at) ??
        (await gameApi.createSave());
      void navigate(`/play/${save.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    setBusy(true);
    setError(null);
    try {
      const save = await gameApi.createSave();
      await client.invalidateQueries({ queryKey: ["saves"] });
      void navigate(`/play/${save.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function login() {
    setBusy(true);
    setError(null);
    try {
      await gameApi.login();
      await client.invalidateQueries({ queryKey: ["user"] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={s.home}>
      <nav className={s.topbar}>
        <span className={s.brand}>
          <img
            className={s.brandLogo}
            src="/assets/brand-logo.png"
            width={40}
            height={40}
            alt=""
          />
          BETWEEN THE LINES
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
          成为研发专员周菱菱，在对话、流言与工作之间，
          <br className={s.desktop} />
          找到属于自己的回应。
        </p>
        {user.data &&
        !(user.error instanceof ApiError && user.error.status === 401) ? (
          <div className={s.homeActions}>
            <Button
              variant="primary"
              className={s.primary}
              isDisabled={busy}
              onClick={() => void start()}
            >
              开始新的故事 <ArrowRight size={18} />
            </Button>
            {latest && (
              <Link className={s.secondary} to={`/play/${latest.id}`}>
                {latest.state.ending ? "回看最近的故事" : "继续上次的故事"}{" "}
                <Bookmark size={17} />
              </Link>
            )}
            <Link className={s.textButton} to="/saves">
              查看全部存档
            </Link>
          </div>
        ) : (
          <div className={s.homeActions}>
            {config.data?.guest_login && (
              <Button
                variant="primary"
                className={s.primary}
                isDisabled={busy}
                onClick={() => void trial()}
              >
                立即试玩 · 第一幕
              </Button>
            )}
            <a
              className={`${s.primary} ${!config.data?.zhihu_login ? s.disabled : ""}`}
              href={config.data?.zhihu_login ? "/api/auth/zhihu" : undefined}
              aria-disabled={!config.data?.zhihu_login}
            >
              知乎账号登录 <ArrowRight size={18} />
            </a>
            {config.data?.dev_login && (
              <Button
                variant="secondary"
                className={s.secondary}
                isDisabled={busy}
                onClick={() => void login()}
              >
                开发环境试玩 <ChevronRight size={17} />
              </Button>
            )}
          </div>
        )}
        {user.data?.identity_type === "guest" && (
          <p className={s.notice}>
            访客进度保留七天。
            <a href={config.data?.zhihu_login ? "/api/auth/zhihu" : undefined}>
              绑定知乎，继承进度继续第二幕
            </a>
          </p>
        )}
        {user.data?.binding_pending && (
          <p role="status">
            登录成功，当前回合结束后将继承试玩存档。请稍后刷新存档列表。
          </p>
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
        <ErrorNotice error={error} />
        <ErrorNotice
          error={config.error}
          onRetry={() => void config.refetch()}
        />
        {!(user.error instanceof ApiError && user.error.status === 401) && (
          <ErrorNotice error={user.error} onRetry={() => void user.refetch()} />
        )}
        <ErrorNotice error={saves.error} onRetry={() => void saves.refetch()} />
      </div>
      <footer className={s.homeFooter}>
        <span>每一个选择，都值得被认真对待。</span>
        <span>01 / 职场篇</span>
      </footer>
    </main>
  );
}

export function Saves() {
  const client = useQueryClient();
  const [category, setCategory] = useState("active"),
    [manageErrors, setManageErrors] = useState<Record<string, unknown>>({});
  const activeOperations = useRef(new Set<string>());
  const [pending, setPending] = useState<string[]>([]);
  const [managed, setManaged] = useState("");
  async function manage(id: string, operation: string) {
    if (activeOperations.current.has(id)) return;
    activeOperations.current.add(id);
    setPending([...activeOperations.current]);
    setManageErrors((errors) => ({ ...errors, [id]: null }));
    setManaged("");
    try {
      await api(`/saves/${id}/manage`, { operation }, undefined, false, isSave);
      await client.invalidateQueries({ queryKey: ["saves"] });
      setManaged(
        `存档 ${id.slice(0, 8)} ${operation === "delete" ? "已移入回收站" : operation === "archive" ? "已归档" : "已恢复"}`,
      );
    } catch (e) {
      setManageErrors((errors) => ({ ...errors, [id]: e }));
    } finally {
      activeOperations.current.delete(id);
      setPending([...activeOperations.current]);
    }
  }
  const user = useQuery({
    queryKey: ["user"],
    queryFn: ({ signal }) => gameApi.user(signal),
    refetchInterval: (query) =>
      query.state.data?.binding_pending ? 1500 : false,
  });
  const saves = useQuery({
    queryKey: ["saves", user.data?.id],
    queryFn: ({ signal }) => gameApi.saves(signal),
    enabled:
      !!user.data &&
      !(user.error instanceof ApiError && user.error.status === 401),
  });
  const visibleSaves = (
    user.error instanceof ApiError && user.error.status === 401
      ? []
      : (saves.data ?? [])
  ).filter((item) =>
    category === "trash"
      ? !!item.deleted_at
      : category === "archived"
        ? !!item.archived_at && !item.deleted_at
        : !item.archived_at && !item.deleted_at,
  );
  return (
    <main className={s.page}>
      <Link to="/" className={s.back}>
        <ArrowLeft size={16} />
        返回
      </Link>
      <h1>我的故事</h1>
      <p className={s.muted}>每个存档都是独立的一段经历。</p>
      {saves.isLoading && <p role="status">正在读取…</p>}
      <ErrorNotice
        error={user.error || saves.error}
        onRetry={() => void (user.error ? user.refetch() : saves.refetch())}
      />
      {saves.data?.length === 0 && <p>还没有故事，从第一句话开始。</p>}
      <p role="status">{managed}</p>
      <nav className={s.saveFilters} aria-label="存档分类">
        {[
          ["active", "进行中与已完成"],
          ["archived", "归档"],
          ["trash", "回收站"],
        ].map(([key, label]) => (
          <Button
            variant="secondary"
            key={key}
            onClick={() => setCategory(key!)}
            aria-pressed={category === key}
          >
            {label}
          </Button>
        ))}
      </nav>
      <div className={s.saveGrid} data-count={Math.min(visibleSaves.length, 6)}>
        {visibleSaves.map((item) => (
          <Card key={item.id} className={s.saveCard}>
            <Card.Header>
              <Bookmark size={20} aria-hidden="true" />
              <h2>{item.parent_save_id ? "重玩分支" : "我的故事"}</h2>
              <small className={s.saveIdentifier}>
                存档 {item.id.slice(0, 8)}
              </small>
            </Card.Header>
            <Card.Content className={s.saveDetails}>
              <p>
                {item.last_played_at
                  ? new Date(item.last_played_at).toLocaleString("zh-CN")
                  : "旧版本存档"}{" "}
                · 故事 v{item.story_version ?? 1}
              </p>
              {item.parent_save_id && (
                <p>分支来自存档 {item.parent_save_id.slice(0, 8)}</p>
              )}
              <p>{saveTitle(item)}</p>
              <span>{saveMetrics(item)}</span>
            </Card.Content>
            <Card.Footer className={s.saveActions}>
              {!item.deleted_at && (
                <Link className={s.openSave} to={`/play/${item.id}`}>
                  打开故事 <ArrowRight size={16} />
                </Link>
              )}
              <Button
                variant="secondary"
                isDisabled={pending.includes(item.id)}
                onClick={() =>
                  void manage(
                    item.id,
                    item.deleted_at
                      ? "restore"
                      : item.archived_at
                        ? "unarchive"
                        : "archive",
                  )
                }
              >
                {item.deleted_at
                  ? "从回收站恢复"
                  : item.archived_at
                    ? "恢复归档"
                    : "归档"}
              </Button>
              {!item.deleted_at && (
                <Button
                  variant="secondary"
                  isDisabled={pending.includes(item.id)}
                  onClick={() => void manage(item.id, "delete")}
                >
                  移入回收站（30 天）
                </Button>
              )}
            </Card.Footer>
            {pending.includes(item.id) && <p role="status">正在处理此存档…</p>}
            <ErrorNotice error={manageErrors[item.id]} />
          </Card>
        ))}
      </div>
      {saves.data && visibleSaves.length === 0 && saves.data.length > 0 && (
        <p className={s.muted}>这个分类还没有存档。</p>
      )}
    </main>
  );
}
