# 安全策略

## 报告漏洞

请**不要**通过公开 Issue 报告安全漏洞。

- 优先：使用 GitHub 的私密漏洞报告（仓库 Security → Report a vulnerability）
- 备选：向仓库维护者发送邮件，主题以 `[SECURITY]` 开头

请在报告中包含：复现步骤、受影响的版本或提交、影响范围评估、以及任何可能的缓解措施。我们会在收到后 5 个工作日内给出首次响应。

## 受支持的版本

只有最新的 tag 受支持。本项目是单机部署的单维护者项目，不提供旧版本的安全维护；升级路径始终是「部署最新 tag」，回滚路径见 `docs/operations.md`。

## 已实施的防护

以下是代码层面已经强制执行的约束，而非仅仅是文档建议：

- **生产环境拒绝不安全启动。** `backend/app/config.py` 的 `production_guards` 校验器在 `ENVIRONMENT=production` 时拒绝启动，条件包括：启用了开发登录、使用 mock agent、`SESSION_SECRET` 短于 32 字符或以 `development` 开头、`PUBLIC_ORIGIN` 非 HTTPS、缺少 `DEEPSEEK_API_KEY`、模型地址非 HTTPS 或未配置正数月度费用上限。
- **会话令牌不明文存储。** `backend/app/auth.py` 存储 `secrets.token_urlsafe(32)` 的 SHA-256 摘要，7 天过期，Cookie 为 `httponly` + `samesite=lax`，生产环境附加 `secure`。
- **同源部署 + Origin 校验代替 CORS。** `backend/app/factory.py` 的中间件校验 Origin，并要求所有变更类请求为 JSON，以此作为 CSRF 防线。单进程、事务和接口边界见 [架构说明](docs/architecture.md)。
- **日志脱敏。** 认证失败只记录异常类型，不记录凭据或个人信息；`backend/tests/test_logging.py` 对此有回归断言。
- **Agent 能力受限。** `backend/app/agents.py` 禁用 deepagents 的通用子代理，排除 `task` 与 `execute` 工具，文件工具仅作用于 `StateBackend`——不接触宿主文件系统或 shell。模型与工具调用次数受 `MAX_MODEL_CALLS` / `MAX_TOOL_CALLS` 限制。
- **检查点线程 ID 由服务端派生**（`{user}:{save}:{npc}`），客户端无法自选，避免跨用户读取对话检查点。
- **供应链锁定。** 后端依赖经 `backend/requirements.lock` 以 `--require-hashes` 安装；GitHub Actions 全部锁定到提交 SHA；gitleaks 与 trivy 二进制以下载校验和验证。

## 存储的个人数据

| 数据 | 位置 | 说明 |
|---|---|---|
| 知乎用户标识与昵称 | `public.users` | 仅在真实知乎 OAuth 接入后产生；当前该集成的端点未配置，见 `docs/verification.md` |
| 会话令牌摘要 | `public.login_sessions` | SHA-256 摘要，非明文 |
| 游戏存档与回合内容 | `public.saves`、`public.turns` | 玩家在游戏内输入的文本，以及模型生成的回复 |
| Agent 对话检查点 | `agent_checkpoints` schema | LangGraph 检查点，含完整对话历史 |

开发登录（`DEV_LOGIN_ENABLED`）在生产环境被 `config.py` 拒绝，因此生产环境不存在匿名或弱凭据入口。

## 密钥管理

密钥通过宿主机的 `.env` 文件注入，权限要求 `600`（`make doctor` 会校验）。`.env`、`*.pem`、`*.key` 与 `doc-fetch-resources/` 均被 `.gitignore` 排除，并由 pre-commit hook 二次拦截。本项目当前未使用密钥管理服务。
