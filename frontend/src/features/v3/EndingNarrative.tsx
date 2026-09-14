import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { record } from "../../contracts";
import type { Save } from "../../types";
import type { components } from "../../generated/api";
type Job = components["schemas"]["JobOut"];
function requestKey(key: string): string {
  try {
    const existing = localStorage.getItem(key);
    if (existing && /^[0-9a-f-]{36}$/.test(existing)) return existing;
    const value = crypto.randomUUID();
    localStorage.setItem(key, value);
    return value;
  } catch {
    return crypto.randomUUID();
  }
}
export function EndingNarrative({
  save,
  userId,
}: {
  save: Save;
  userId: string;
}) {
  const key = `ending-request:${userId}:${save.id}:${save.version}`;
  const [requestId] = useState(() => requestKey(key));
  const job = useQuery({
    queryKey: ["ending-narrative", userId, save.id, save.version],
    queryFn: ({ signal }) =>
      api<Job>(
        `/saves/${save.id}/jobs`,
        { request_id: requestId, version: save.version, kind: "ending" },
        signal,
        false,
        (v): v is Job =>
          record(v) &&
          v.kind === "ending" &&
          typeof v.id === "string" &&
          ["running", "completed", "failed", "unknown"].includes(
            String(v.status),
          ) &&
          (v.result == null || record(v.result)),
      ),
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1500 : false),
  });
  const result = job.data?.result;
  const interactions = Array.isArray(result?.interactions)
    ? result.interactions.filter(record)
    : [];
  return (
    <section aria-label="结局正文">
      {(job.isPending || job.data?.status === "running") && (
        <p role="status">
          正在根据本局经历整理结局，已确认的成果和问题仍可在下方阅读。
        </p>
      )}
      {job.error && (
        <p role="alert">
          结局正文暂时无法生成，以下事实总结仍然有效。
          <button onClick={() => void job.refetch()}>重试读取</button>
        </p>
      )}
      {(job.data?.status === "failed" || job.data?.status === "unknown") && (
        <p>本次生成未完成，展示已保存事实，不补写新的经历。</p>
      )}
      {typeof result?.text === "string" && (
        <>
          <small>
            {typeof result.label === "string" ? result.label : "结局正文"}
          </small>
          <p style={{ whiteSpace: "pre-wrap" }}>{result.text}</p>
        </>
      )}
      {!!interactions.length && (
        <>
          <h3>回看关键互动</h3>
          {interactions.map((event, i) => (
            <blockquote key={i}>
              <p>
                {typeof event.actual_expression === "string" &&
                event.actual_expression
                  ? event.actual_expression
                  : typeof event.event_summary === "string"
                    ? event.event_summary
                    : ""}
              </p>
              {Array.isArray(event.feedback) &&
                event.feedback
                  .filter((text): text is string => typeof text === "string")
                  .map((text, index) => <p key={index}>{text}</p>)}
            </blockquote>
          ))}
        </>
      )}
    </section>
  );
}
