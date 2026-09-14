import { QueryObserver } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { createGameQueryClient } from "./queryClient";

vi.mock("./reporting", () => ({ report: vi.fn() }));

it.each(["query", "mutation"])(
  "refreshes identity after a %s requires login without looping",
  async (kind) => {
    const client = createGameQueryClient();
    const denied = new ApiError(
      "需要登录",
      403,
      "zhihu_login_required",
      undefined,
      undefined,
      "http",
      undefined,
      "login",
    );
    let restricted = false;
    const identity = vi.fn(() => {
      if (restricted) return Promise.reject(denied);
      return Promise.resolve({ can_play: true });
    });
    const observer = new QueryObserver(client, {
      queryKey: ["user"],
      queryFn: identity,
    });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().isSuccess).toBe(true),
    );
    restricted = true;
    const reject = () => Promise.reject(denied);
    const request =
      kind === "query"
        ? client.fetchQuery({ queryKey: ["jobs"], queryFn: reject })
        : client
            .getMutationCache()
            .build(client, { mutationFn: reject })
            .execute(undefined);
    await expect(request).rejects.toBe(denied);
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().isError).toBe(true),
    );
    expect(identity).toHaveBeenCalledTimes(2);
    unsubscribe();
    client.clear();
  },
);
