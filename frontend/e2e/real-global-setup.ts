import { request } from "@playwright/test";

export default async function setup() {
  if (process.env.BTL_REAL_AI_AUDIT !== "1")
    throw new Error(
      "Real-provider audit requires explicit BTL_REAL_AI_AUDIT=1",
    );
  const client = await request.newContext({
    baseURL: "http://localhost:18081",
  });
  try {
    const response = await client.get("/api/config");
    const config: unknown = await response.json();
    if (
      !response.ok() ||
      typeof config !== "object" ||
      config === null ||
      !("agent_mode" in config) ||
      !("model_ready" in config) ||
      config.agent_mode !== "deepseek" ||
      !config.model_ready
    )
      throw new Error("The dedicated local API must use real DeepSeek");
  } finally {
    await client.dispose();
  }
}
