# 本地切换 DeepSeek（2026-09-14）

本地 `.env` 已改为以下配置，并重启后端：

```dotenv
AGENT_MODE=openai
OPENAI_BASE_URL=https://api.openai-next.com/v1
OPENAI_MODEL=deepseek-v4-flash
OPENAI_REASONING_EFFORT=none
```

继续使用原有 `OPENAI_API_KEY`，密钥只保存在忽略的 `.env` 中。
`AGENT_MODE=openai` 表示兼容接口适配器，不代表实际模型是 GPT；实际调用及用量记录中的模型为 `deepseek-v4-flash`。

适配器对 `deepseek-` 模型使用 Chat Completions，并发送 `thinking.type=disabled`；GPT6 的 Responses 配置保留。此切换同时影响 NPC 对白生成、结局及其他后台生成，不改变规则、角色权限、存档及已保存的历史。

使用的是原有第三方网关，不是 DeepSeek 官方直连；不套用官方单价，价格未知仍记录为 `null`。本地开发允许无美元额度上限，生产价格与额度校验不变。

可以复用真实浏览器测试配置：设置 `BTL_LIVE_AI=1`、`BTL_LIVE_MODEL=deepseek-v4-flash` 后运行 `playwright test --config playwright.gpt6.config.ts`。未显式启用时，该测试仍跳过；默认模型断言仍为 GPT6，以兼容原有命令。

首次本地 NPC 实测约 4.74 秒完整回复、1 次模型调用。此前同网关三次对比为 3.6 / 4.3 / 21.1 秒，存在长尾与重试，不能保证每轮都在几秒内完成。

切换验证：配置、网关与回复相关测试 40 项通过；真实浏览器对话及结局生成通过（整段流程 38.7 秒，包含页面操作和结局生成）；TypeScript、ESLint、Ruff 检查通过。此前延迟优化后的完整后端测试为 369 项通过。代码与文档提交到 Codex 分支，实际密钥与本机 `.env` 不上传。

若需要恢复 GPT6，将 `OPENAI_MODEL` 改回 `gpt-6-astra`、`OPENAI_REASONING_EFFORT` 改回 `low` 并重启后端即可。
