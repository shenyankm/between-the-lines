import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";
import { report } from "./reporting";

export function createGameQueryClient() {
  function failure(error: unknown, identityQuery = false) {
    report("query", error);
    // Refresh permissions after rejection on an already-open page. The identity
    // query itself must never invalidate itself on failure (an infinite loop).
    if (
      !identityQuery &&
      error instanceof ApiError &&
      error.recovery === "login"
    ) {
      void client.invalidateQueries({ queryKey: ["user"] });
    }
  }
  const client = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => failure(error, query.queryKey[0] === "user"),
    }),
    mutationCache: new MutationCache({ onError: (error) => failure(error) }),
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return client;
}
