import { ApiError } from "../api";

/**
 * A well-formed error envelope, as `backend/app/errors.py` renders one.
 *
 * Tests that exercise *malformed* envelopes build their own literal on purpose:
 * the point of those cases is the exact wrong shape, which a helper would hide.
 */
export function apiError(
  message: string,
  over: { code?: string; requestId?: string } = {},
): { error: { code: string; message: string; request_id: string } } {
  return {
    error: {
      code: over.code ?? "internal_error",
      message,
      request_id: over.requestId ?? "req-fixture",
    },
  };
}

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
