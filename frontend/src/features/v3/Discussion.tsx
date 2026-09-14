import { Button } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";
import { record } from "../../contracts";
import type { Save } from "../../types";
import type { components } from "../../generated/api";
import s from "./V3.module.css";
type Job = components["schemas"]["JobOut"];
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
      <p>围绕本幕公共话题，整理不同回应方式。你的私人对话不会用于搜索。</p>
      {query.isPending && <p role="status">正在读取本幕观点…</p>}
      {query.error && (
        <p role="alert">
          暂时无法读取。
          <Button variant="secondary" onClick={() => void query.refetch()}>
            重试
          </Button>
        </p>
      )}
      <p>{prose(result?.label)}</p>
      {query.data?.status === "running" && <p>正在整理来源…</p>}
      {objects(result?.cards).map((card, i) => (
        <article className={s.notice} key={i}>
          <h3>{prose(card.view)}</h3>
          <p>适用情境：{prose(card.situation)}</p>
          <p>{prose(card.expression)}</p>
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
                <a href={prose(source.url)} target="_blank" rel="noreferrer">
                  {prose(source.title)}
                </a>{" "}
                · {prose(source.author)}
              </p>
            ) : null;
          })}
          <Button
            variant="secondary"
            onClick={() =>
              fill(prose(card.expression), query.data!.id, prose(card.id))
            }
          >
            带入输入框，再由我修改
          </Button>
        </article>
      ))}
    </>
  );
}
