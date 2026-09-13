import { request, type FullConfig } from "@playwright/test";

/** Refuse to mutate a server until its mock-mode contract has been verified. */
export default async function setup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("Browser tests require an explicit base URL.");
  const client = await request.newContext({ baseURL });
  try {
    const response = await client.get("/api/config");
    const value: unknown = await response.json();
    if (
      !response.ok() ||
      typeof value !== "object" ||
      value === null ||
      !("agent_mode" in value) ||
      value.agent_mode !== "mock"
    ) {
      throw new Error(
        "Browser tests require a verified mock API. Check the test server and proxy ports.",
      );
    }
  } finally {
    await client.dispose();
  }
}
