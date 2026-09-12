import { http, HttpResponse, type HttpHandler } from "msw";
import type { GameEvent, Save, Story } from "../types";
import { story as storyFixture } from "./fixtures";

/** A save, or a getter for tests where the server-side copy changes. */
export type SaveSource = Save | (() => Save);

/**
 * The three reads `Play` performs on mount: story data, the save itself and
 * its event log. Register them with `server.use(...playHandlers({...}))`.
 */
export function playHandlers(options: {
  save: SaveSource;
  events?: GameEvent[];
  story?: Story;
}): HttpHandler[] {
  const current = (): Save =>
    typeof options.save === "function" ? options.save() : options.save;
  return [
    http.get("/api/story", () =>
      HttpResponse.json(options.story ?? storyFixture),
    ),
    http.get("/api/saves/:id/events", () =>
      HttpResponse.json(options.events ?? []),
    ),
    http.get("/api/saves/:id", () => HttpResponse.json(current())),
  ];
}

/** A promise plus the function that settles it, for holding a stream open. */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, resolve: () => release() };
}

/**
 * A `text/event-stream` response. `frames` are flushed immediately; when
 * `hold` is given the stream then stays open until it resolves and only
 * afterwards flushes `trailing`, so a test can observe incremental delivery
 * rather than only the final state.
 */
export function sse(
  frames: string[],
  hold?: Promise<void>,
  trailing: string[] = [],
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      if (hold) {
        await hold;
      }
      for (const frame of trailing) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
  return new HttpResponse(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** One SSE frame, terminated by the blank line the reader splits on. */
export function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
