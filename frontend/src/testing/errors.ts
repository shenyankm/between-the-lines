import { ApiError } from "../api";

/** Await a call that must reject and hand back whatever it threw. */
export async function thrown(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject, but it resolved");
}

/** Narrow an unknown thrown value to `ApiError`, failing loudly otherwise. */
export function asApiError(error: unknown): ApiError {
  if (!(error instanceof ApiError)) {
    throw new Error(`expected an ApiError, got: ${String(error)}`);
  }
  return error;
}
