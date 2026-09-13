import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  ChevronRight,
  Feather,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ErrorNotice } from "../ErrorNotice";
import { ApiError, gameApi } from "../api";
import s from "../App.module.css";

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
  });
  const saves = useQuery({
    queryKey: ["saves", user.data?.id],
    queryFn: ({ signal }) => gameApi.saves(signal),
    enabled:
      !!user.data &&
      !(user.error instanceof ApiError && user.error.status === 401),
  });
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
        {user.data &&
        !(user.error instanceof ApiError && user.error.status === 401) ? (
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
  const user = useQuery({
    queryKey: ["user"],
    queryFn: ({ signal }) => gameApi.user(signal),
  });
  const saves = useQuery({
    queryKey: ["saves", user.data?.id],
    queryFn: ({ signal }) => gameApi.saves(signal),
    enabled:
      !!user.data &&
      !(user.error instanceof ApiError && user.error.status === 401),
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
      <ErrorNotice
        error={user.error || saves.error}
        onRetry={() => void (user.error ? user.refetch() : saves.refetch())}
      />
      {saves.data?.length === 0 && <p>还没有故事，从第一句话开始。</p>}
      <div className={s.saveGrid}>
        {!(user.error instanceof ApiError && user.error.status === 401) &&
          saves.data?.map((item, i) => (
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
