import { setupServer } from "msw/node";

/**
 * No default handlers on purpose: every test declares the endpoints it
 * expects, and `setupTests.ts` starts the server with
 * `onUnhandledRequest: "error"`, so a request the test did not anticipate
 * fails instead of silently passing.
 */
export const server = setupServer();
