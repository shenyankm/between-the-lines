import { useState } from "react";
import { readFormDraft, writeFormDraft } from "../game/drafts";
export type DraftIdentity = { userId: string; saveId: string };

export function useFormDraft(
  identity: DraftIdentity | undefined,
  form: string,
  initial: Record<string, string>,
) {
  const [local, setLocal] = useState(initial);
  const [, render] = useState(0);
  const [storageIssue, setStorageIssue] = useState(false);
  const value = identity
    ? { ...initial, ...readFormDraft(identity.userId, identity.saveId, form) }
    : local;
  const update = (patch: Record<string, string>) => {
    const fields = { ...value, ...patch };
    if (identity) {
      setStorageIssue(
        !writeFormDraft(identity.userId, identity.saveId, form, fields),
      );
      render((n) => n + 1);
    } else setLocal(fields);
  };
  return { value, update, storageIssue };
}

export function FormDraftNotice({ storageIssue }: { storageIssue: boolean }) {
  return (
    <p role={storageIssue ? "alert" : undefined}>
      {storageIssue
        ? "暂存不可用，刷新前请保留输入。"
        : "输入暂存在本标签页，关闭面板或刷新可恢复；关闭标签页或注销后清空。暂存不等于草稿已保存或申请已提交。"}
    </p>
  );
}
