import { Button, TextArea } from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../../api";
import { isEvent, isSave, record } from "../../contracts";
import { ErrorNotice } from "../../ErrorNotice";
import type { components } from "../../generated/api";
import type { GameEvent, Save } from "../../types";
import s from "../../App.module.css";
type Job = components["schemas"]["JobOut"];
type Point = components["schemas"]["SnapshotOut"];
const jobsGuard = (v: unknown): v is Job[] =>
  Array.isArray(v) &&
  v.every(
    (j) =>
      record(j) &&
      typeof j.id === "string" &&
      ["reflection", "discussion", "ending"].includes(String(j.kind)) &&
      ["running", "completed", "failed", "unknown"].includes(
        String(j.status),
      ) &&
      (j.result == null || record(j.result)),
  );
const pointsGuard = (v: unknown): v is Point[] =>
  Array.isArray(v) &&
  v.every(
    (p) =>
      record(p) &&
      typeof p.id === "string" &&
      typeof p.node === "string" &&
      typeof p.created_at === "string",
  );
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
const objects = (value: unknown) =>
  Array.isArray(value) ? value.filter(record) : [];
const prose = (v: unknown) => (typeof v === "string" ? v : "");
const nodes: Record<string, string> = {
  act_1: "第一幕开始",
  act_2: "第二幕开始",
  act_3: "第三幕开始",
  before_partner: "伴侣关系决定前",
  before_sun: "孙淼关系决定前",
};
export function ProductPanel({
  save,
  userId,
  events,
  disabled,
  fillDraft,
  initiallyOpen = false,
}: {
  save: Save;
  userId: string;
  events: GameEvent[];
  disabled: boolean;
  initiallyOpen?: boolean;
  fillDraft: (text: string, job: string, card: string) => void;
}) {
  const client = useQueryClient(),
    navigate = useNavigate();
  const [open, setOpen] = useState(initiallyOpen),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<GameEvent[]>([]),
    [allHistory, setAllHistory] = useState(false);
  const [shareEnding, setShareEnding] = useState(true),
    [shareActions, setShareActions] = useState(false),
    [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [requests] = useState(() => new Map<string, string>());
  const jobs = useQuery({
    queryKey: ["jobs", userId, save.id],
    queryFn: ({ signal }) =>
      api(`/saves/${save.id}/jobs`, undefined, signal, true, jobsGuard),
    enabled: open,
    refetchInterval: (q) =>
      q.state.data?.some((j) => j.status === "running") ? 1500 : false,
  });
  const points = useQuery({
    queryKey: ["snapshots", userId, save.id, save.version],
    queryFn: ({ signal }) =>
      api(`/saves/${save.id}/snapshots`, undefined, signal, true, pointsGuard),
    enabled: open && save.story_version === 3,
  });
  async function perform(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const requestId = (key: string) => {
    let id = requests.get(key);
    if (!id) {
      id = crypto.randomUUID();
      requests.set(key, id);
    }
    return id;
  };
  async function generate(kind: "discussion" | "reflection" | "ending") {
    await perform(async () => {
      const key = `${kind}:${save.version}`;
      await api(`/saves/${save.id}/jobs`, {
        kind,
        version: save.version,
        request_id: requestId(key),
      });
      requests.delete(key);
      await jobs.refetch();
    });
  }
  const share = [
    "《章外回声》· 我的故事",
    shareEnding && save.state.ending
      ? `${save.state.ending}\n${save.ending_summary ?? ""}`
      : "",
    shareActions
      ? events
          .filter(
            (e) =>
              e.kind === "player" &&
              e.action !== "speak" &&
              !["propose", "cancel_proposal"].includes(e.action ?? ""),
          )
          .slice(-3)
          .map((e) => e.text)
          .join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return (
    <section className={s.productPanel}>
      <Button
        variant="secondary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        复盘、观点卡与重玩
      </Button>
      {open && (
        <>
          <h2>我的故事记录</h2>
          <div className={s.choices}>
            {save.state.ending && (
              <Button
                variant="secondary"
                isDisabled={busy || disabled}
                onClick={() => void generate("ending")}
              >
                生成独立结局演出
              </Button>
            )}
            {save.state.ending && (
              <Button
                variant="secondary"
                isDisabled={
                  busy ||
                  disabled ||
                  jobs.data?.some(
                    (j) => j.kind === "reflection" && j.status === "running",
                  )
                }
                onClick={() => void generate("reflection")}
              >
                生成个人化复盘
              </Button>
            )}
            <Button
              variant="secondary"
              isDisabled={
                busy ||
                disabled ||
                jobs.data?.some(
                  (j) =>
                    j.kind === "discussion" &&
                    j.status === "running" &&
                    (j.act == null || j.act === save.state.act),
                )
              }
              onClick={() => void generate("discussion")}
            >
              查看本幕观点卡
            </Button>
          </div>
          {(jobs.data ?? []).map((job) => (
            <article key={job.id}>
              <h3>
                {job.kind === "reflection" ? "个人复盘" : "观点卡"}{" "}
                {job.status === "running" ? "· 正在整理…" : ""}
              </h3>
              {job.result && <p>{prose(job.result.label)}</p>}
              {job.kind === "ending" && <p>{prose(job.result?.text)}</p>}
              {objects(job.result?.nodes).map((node, i) => (
                <div key={i}>
                  <p>
                    <strong>实际发生：</strong>
                    {prose(node.actual_expression)}
                  </p>
                  {strings(node.feedback).map((text, j) => (
                    <p key={j}>角色反馈：{text}</p>
                  ))}
                  {objects(node.consequences).map((item, j) => (
                    <p key={j}>实际后果：{prose(item.text)}</p>
                  ))}
                  {typeof node.alternative === "string" && (
                    <p>
                      <strong>另一种可能：</strong>
                      {node.alternative} 可能代价：{prose(node.possible_cost)}
                    </p>
                  )}
                </div>
              ))}
              {objects(job.result?.cards).map((card, i) => (
                <div key={i}>
                  <h4>{prose(card.view)}</h4>
                  <p>适用情境：{prose(card.situation)}</p>
                  <p>表达建议：{prose(card.expression)}</p>
                  <p>可能代价：{prose(card.possible_cost)}</p>
                  {objects(card.sources).map((source, j) =>
                    /^https:\/\//.test(prose(source.url)) ? (
                      <a
                        key={j}
                        href={prose(source.url)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {prose(source.title)} · {prose(source.author)}
                      </a>
                    ) : null,
                  )}
                  <Button
                    variant="secondary"
                    isDisabled={
                      disabled ||
                      !!save.state.ending ||
                      job.status !== "completed" ||
                      (job.act != null && job.act !== save.state.act)
                    }
                    onClick={() =>
                      fillDraft(prose(card.expression), job.id, prose(card.id))
                    }
                  >
                    带入草稿（可编辑）
                  </Button>
                </div>
              ))}
            </article>
          ))}
          <h3>尝试另一种回应</h3>
          <p>重玩会建立独立分支，保留原故事。</p>
          {(points.data ?? []).map((point) => (
            <Button
              variant="secondary"
              key={point.id}
              isDisabled={busy || disabled}
              onClick={() =>
                void perform(async () => {
                  const result = await api(
                    `/saves/${save.id}/branches`,
                    { request_id: requestId(point.id), snapshot_id: point.id },
                    undefined,
                    false,
                    isSave,
                  );
                  await client.invalidateQueries({ queryKey: ["saves"] });
                  void navigate(`/play/${result.id}`);
                })
              }
            >
              {nodes[point.node] ?? point.node}
            </Button>
          ))}
          {save.story_version !== 2 && (
            <p>旧版本不提供无法可靠还原的重玩节点，请新建故事体验新版。</p>
          )}
          <details>
            <summary>完整历史与幕间</summary>
            {[...history, ...events]
              .filter((e, i, a) => a.findIndex((v) => v.id === e.id) === i)
              .map((e) => (
                <p key={e.id}>
                  {e.kind === "personal" || e.kind === "narrative"
                    ? "私人经历 · "
                    : ""}
                  {e.text}
                </p>
              ))}
            {!allHistory && (
              <Button
                variant="secondary"
                isDisabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const cursor = history[0]?.id ?? events[0]?.id;
                    const page = await api(
                      `/saves/${save.id}/events?limit=50${cursor ? `&before=${cursor}` : ""}`,
                      undefined,
                      undefined,
                      true,
                      (v): v is GameEvent[] =>
                        Array.isArray(v) && v.every(isEvent),
                    );
                    setHistory((old) => [...page, ...old]);
                    setAllHistory(page.length < 50);
                  })
                }
              >
                查看更早记录
              </Button>
            )}
          </details>
          <details>
            <summary>制作本地成果卡</summary>
            <label>
              <input
                type="checkbox"
                checked={shareEnding}
                onChange={(e) => setShareEnding(e.target.checked)}
              />
              结局与事实总结
            </label>
            <label>
              <input
                type="checkbox"
                checked={shareActions}
                onChange={(e) => setShareActions(e.target.checked)}
              />
              最近三次点击行动
            </label>
            <pre className={s.sharePreview}>{share}</pre>
            <Button
              variant="secondary"
              onClick={() =>
                void perform(async () => {
                  await navigator.clipboard.writeText(share);
                  setCopied(true);
                })
              }
            >
              {copied ? "已复制" : "复制预览内容"}
            </Button>
          </details>
          <details>
            <summary>提交体验反馈</summary>
            <TextArea
              maxLength={1500}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              aria-label="体验反馈"
            />
            <Button
              variant="secondary"
              isDisabled={!feedback.trim() || busy}
              onClick={() =>
                void perform(async () => {
                  await api("/feedback", { text: feedback });
                  setFeedback("");
                })
              }
            >
              提交反馈
            </Button>
          </details>
          <ErrorNotice error={error || jobs.error || points.error} />
        </>
      )}
    </section>
  );
}
