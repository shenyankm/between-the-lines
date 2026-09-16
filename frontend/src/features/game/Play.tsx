import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { ErrorNotice } from "../../ErrorNotice";
import { gameApi } from "../../api";
import s from "../../App.module.css";
import { LoginRequired } from "../LoginRequired";
import { PlayV3 } from "../v3/PlayV3";
import { EventHistory } from "./EventHistory";
import { playKey } from "./useTurnController";

// Only playable v3 saves mount a recovery controller, after story loading.
function PlaySession({ userId }: { userId: string }) {
  const { id = "" } = useParams();
  const play = useQuery({
    queryKey: playKey(userId, id),
    queryFn: ({ signal }) => gameApi.playState(id, signal),
  });
  const save = play.data?.save;
  const current = save?.story_version === 3 && !save.read_only;
  const story = useQuery({
    queryKey: ["story", 3, false],
    queryFn: ({ signal }) => gameApi.story(signal, 3),
    enabled: current,
  });
  useEffect(() => {
    if (save?.story_version === 3 || save?.read_only)
      void gameApi.visit(id).catch(() => {});
  }, [id, save?.story_version, save?.read_only]);
  if (!play.data)
    return (
      <main className={s.page}>
        <Link to="/">返回首页</Link>
        {play.error ? (
          <ErrorNotice error={play.error} onRetry={() => void play.refetch()} />
        ) : (
          "正在读取故事…"
        )}
      </main>
    );
  if (save?.read_only)
    return (
      <main className={s.page}>
        <Link to="/">返回首页 · 开始新故事</Link>
        <h1>旧版故事 · 只读历史</h1>
        <p>{save.ending_summary ?? save.scene_intro}</p>
        <EventHistory userId={userId} saveId={id} version={save.version} />
      </main>
    );
  if (current)
    return story.data ? (
      <PlayV3 userId={userId} play={play.data} story={story.data} />
    ) : (
      <main className={s.page}>
        {story.error ? (
          <ErrorNotice
            error={story.error}
            onRetry={() => void story.refetch()}
          />
        ) : (
          "正在翻开你的故事…"
        )}
      </main>
    );
  return (
    <main className={s.page}>
      <Link to="/">返回首页</Link>
      <p role="alert">故事版本不受支持，请刷新重试。</p>
    </main>
  );
}

export function Play() {
  const { id = "" } = useParams();
  const user = useQuery({
    queryKey: ["user"],
    queryFn: ({ signal }) => gameApi.user(signal),
  });
  if (!user.data || user.error || !user.data.can_play)
    return (
      <main className={s.page}>
        <Link to="/">返回首页</Link>
        {user.error ? (
          <ErrorNotice error={user.error} onRetry={() => void user.refetch()} />
        ) : user.data ? (
          <LoginRequired user={user.data} />
        ) : (
          <p>正在读取身份…</p>
        )}
      </main>
    );
  return <PlaySession key={`${user.data.id}:${id}`} userId={user.data.id} />;
}
