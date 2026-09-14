import { Button } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";
import { record } from "../../contracts";
import type { Save } from "../../types";
import type { components } from "../../generated/api";
import s from "./V3.module.css";
type Job = components["schemas"]["JobOut"];
const topics: Record<number, string> = {
  0: "如何在职场关系中保持自己的边界？",
  1: "职场中，最可怕的关系是什么？",
  2: "采购申请被含糊退回，该如何沟通和推进？",
  3: "被同事传言准备跳槽，应该如何回应？",
  4: "经历冲突后，如何处理同事关系与工作边界？",
};
const prose = (v: unknown) => (typeof v === "string" ? v : "");
const objects = (v: unknown) => (Array.isArray(v) ? v.filter(record) : []);
export function Discussion({
  save,
  userId,
  fill,
}: {
  save: Save;
  userId: string;
  fill: (text: string, job: string, card: string) => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const query = useQuery({
    queryKey: ["v3-discussion", userId, save.id, save.state.act],
    queryFn: ({ signal }) =>
      api<Job>(
        `/saves/${save.id}/jobs`,
        { request_id: requestId, version: save.version, kind: "discussion" },
        signal,
        false,
      ),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1500 : false),
    retry: false,
  });
  const result = query.data?.result;
  return (
    <>
      <h3 className={s.discussionTopic}>
        热议：{topics[save.state.act] ?? topics[0]}
      </h3>
      {result?.mock === true && prose(result.highlight) && (
        <div className={s.discussionHighlight}>
          <p>“{prose(result.highlight)}”</p>
          <small>
            这句话被赞了{" "}
            {typeof result.highlight_votes === "number"
              ? result.highlight_votes.toLocaleString("en-US")
              : "—"}{" "}
            次 · Mock 示例
          </small>
        </div>
      )}
      <p className={s.discussionIntro}>
        AI 搜索知乎相关问题，归纳不同观点供你参考与选择。
      </p>
      {query.isPending && <p role="status">正在读取本幕观点…</p>}
      {query.error && (
        <p role="alert">
          暂时无法读取。
          <Button variant="secondary" onClick={() => void query.refetch()}>
            重试
          </Button>
        </p>
      )}
      <p className={s.discussionSourceStatus}>{prose(result?.label)}</p>
      {query.data?.status === "running" && <p role="status">正在整理来源…</p>}
      {["failed", "unknown"].includes(query.data?.status ?? "") && (
        <p role="status">本次观点整理未完成，可以继续故事，稍后再查看。</p>
      )}
      {query.data?.status === "completed" && !objects(result?.cards).length && (
        <p>本幕暂无可用观点，可以先用自己的话回应。</p>
      )}
      <details className={s.discussionChoices} open={result?.mock !== true}>
        <summary>查看 {objects(result?.cards).length} 类观点，选择回应</summary>
        <ol className={s.discussionViews}>
          {objects(result?.cards).map((card, i) => (
            <li className={s.discussionView} key={prose(card.id) || i}>
              <small>观点 {i + 1}</small>
              <h3>{prose(card.view)}</h3>
              <details>
                <summary>查看依据与回应建议</summary>
                <p>适用情境：{prose(card.situation)}</p>
                <blockquote>{prose(card.expression)}</blockquote>
                <p>可能代价：{prose(card.possible_cost)}</p>
                {objects(card.sources).map((source, j) => {
                  let valid = false;
                  try {
                    const u = new URL(prose(source.url));
                    valid =
                      u.protocol === "https:" &&
                      (u.hostname === "zhihu.com" ||
                        u.hostname.endsWith(".zhihu.com"));
                  } catch {
                    /* malformed sources are never links */
                  }
                  return valid ? (
                    <p key={j}>
                      <a
                        href={prose(source.url)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {prose(source.title)}
                      </a>{" "}
                      · {prose(source.author)}
                    </p>
                  ) : null;
                })}
              </details>
              <Button
                variant="secondary"
                onClick={() =>
                  fill(prose(card.expression), query.data!.id, prose(card.id))
                }
              >
                带入输入框，再由我修改
              </Button>
            </li>
          ))}
        </ol>
      </details>
      <small className={s.discussionPrivacy}>
        只搜索本幕公共话题，不使用私人对话；选择后可修改表达，由你决定是否发送。
      </small>
    </>
  );
}
