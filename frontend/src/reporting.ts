/**
 * The seam between "the player hit a failure" and "somebody hears about it".
 *
 * Nothing is sent anywhere by default: the installed reporter is a no-op. That is a
 * decision, not an omission. The two obvious transports are both worse than the seam
 * alone --
 *
 *   - a third-party SDK is a new runtime dependency with a supply chain of its own,
 *     added to a bundle that is currently entirely first-party;
 *   - an `/api/client-errors` endpoint is an unauthenticated write path, which is a
 *     free denial-of-service target and a log-injection surface, and it would need
 *     rate limiting and size caps before it could be turned on.
 *
 * What is worth having now is the shape a transport would receive, and the four call
 * sites that already funnel into it: the render boundary, `window.onerror`,
 * unhandled promise rejections, and every failed query and mutation. Wiring a real
 * transport later is then one `setReporter` call rather than a search for the places
 * errors escape.
 *
 * Privacy is the constraint that shapes the payload. The backend goes to some length
 * to keep a player's message out of its logs -- validation failures record field
 * names and never submitted values, and an OAuth failure records only the exception
 * type. A client reporter that forwarded whatever it was handed would undo all of it
 * from the other end, since a throw site is free to interpolate the text a player
 * typed. So `reporting.test.ts` walks every throw in src/ and fails if one builds its
 * message from a value: messages are developer-authored constants, which is what
 * makes forwarding them safe.
 */

import { ApiError } from "./api";

/** Where the failure was caught, which is most of what makes a report actionable. */
export type ReportKind = "render" | "uncaught" | "rejection" | "query";

/** One normalised failure. Every field is a developer-authored or server-side string. */
export interface Report {
  kind: ReportKind;
  message: string;
  /** The API's stable snake_case code, when the failure came from the envelope. */
  code?: string;
  /** The id the API logged for the request; joins a report to a server log line. */
  requestId?: string;
  stack?: string;
  componentStack?: string;
}

export type Reporter = (report: Report) => void;

// A stack from a minified bundle is long and mostly framework frames. Clipped rather
// than dropped: the first frames are the ones that name our own code.
const MAX_LENGTH = 2000;

let reporter: Reporter = () => {};

/** Install a transport, and get back the function that restores the previous one. */
export function setReporter(next: Reporter): () => void {
  const previous = reporter;
  reporter = next;
  return () => {
    reporter = previous;
  };
}

function clip(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length > MAX_LENGTH ? `${value.slice(0, MAX_LENGTH)}…` : value;
}

/** Reduce an unknown thrown value to the fields a transport is allowed to see. */
export function normalise(kind: ReportKind, error: unknown): Report {
  if (error instanceof ApiError) {
    return {
      kind,
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.requestId ? { requestId: error.requestId } : {}),
      ...(clip(error.stack) ? { stack: clip(error.stack) } : {}),
    };
  }
  if (error instanceof Error) {
    return {
      kind,
      message: error.message,
      ...(clip(error.stack) ? { stack: clip(error.stack) } : {}),
    };
  }
  // Anything can be thrown in JavaScript, including a string or null. `String()` on
  // null and undefined is the one case where this could carry a value a caller
  // interpolated, which is what the throw-site walk in the tests forbids.
  return { kind, message: String(error) };
}

/** Hand one failure to the transport. Never throws, whatever the transport does. */
export function report(
  kind: ReportKind,
  error: unknown,
  componentStack?: string,
): void {
  const payload: Report = {
    ...normalise(kind, error),
    ...(clip(componentStack) ? { componentStack: clip(componentStack) } : {}),
  };
  try {
    reporter(payload);
  } catch {
    // Every caller is already handling a failure. Throwing here would turn a
    // rendered error into an uncaught one, which is a strictly worse outcome than
    // losing the report.
  }
}

/**
 * Catch what escapes React entirely: an event handler, a stray promise, a timer.
 * Returns the function that removes both listeners.
 */
export function installGlobalErrorHandlers(): () => void {
  const onError = (event: ErrorEvent) =>
    report("uncaught", event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) =>
    report("rejection", event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
