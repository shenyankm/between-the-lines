# 更新日志

本文件记录所有值得注意的变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

`backend/pyproject.toml` 与 `frontend/package.json` 的版本号必须一致，由 `scripts/check-version-sync.py` 在 CI 中强制。使用 `make release V=<version>` 同时更新两处并预置下一节的桩。

<!-- next -->

## 0.1.0 - 未发布

首个可用版本：三幕职场改编互动叙事，三个 NPC 各由独立的 Deep Agent 驱动，回合经 SSE 流式返回，PostgreSQL 同时保存游戏事实与 Agent 检查点。

### 新增

- 回合提交、幂等（`(save_id, request_id)` 唯一约束）、乐观版本检查与悲观行锁
- 每回合超时、进程内并发预算、每用户每日配额
- 启动清扫 + 15 秒周期清扫恢复陈旧回合；失败回合标记 `retryable` 并保留已提交的游戏事件
- 知乎公开数据导入 CLI（`python -m app.zhihu_import`）
- 确定性 DeepSeek 兼容 mock（`backend/app/mock_llm.py`），使完整 Agent 图可离线运行
- 单机 Docker Compose 部署，nginx 同源反代与 TLS overlay
- CI：锁定文件与哈希导出漂移门禁、Alembic 迁移与 schema 漂移门禁、OpenAPI→TypeScript 契约门禁、进程崩溃恢复测试、备份恢复演练、桌面与手机 Playwright 端到端

### 工程化

- 初始化 Git 仓库；`.gitignore` 在首次提交前加固，排除 `doc-fetch-resources/`（非公开源文档缓存）、各 `.env`、`artifacts/`、`*.pem`
- 根 `.env` 与 `artifacts/tls/*.pem` 权限由 644 收紧为 600；根 `.env` 与 `.env.example` 变量集对齐
- `Settings.env_file` 改为基于 `__file__` 解析，消除「加载哪份配置取决于启动目录」的分裂
- `.dockerignore` 不再把后端源码树与私有文档缓存送入仅构建前端的 Docker 上下文
- 新增 `Makefile` 作为本地任务的单一事实来源，CI 为其子集；`make doctor` 校验工具链并启用版本化 git hooks
- 新增 `SECURITY.md`、`CHANGELOG.md`
- `scripts/githooks/pre-commit` 拦截 dotenv 文件（前缀与后缀命名）、私钥、`doc-fetch-resources/` 与超过 400 KB 的 blob，并对暂存的 Python 执行 ruff；经 `core.hooksPath` 启用，不使用与「无虚拟环境」约束冲突的 pre-commit 框架
- 新增 `audit.yml`：gitleaks 全历史密钥扫描、`doc-fetch-resources/` 从未入库断言、`uv audit`、`pnpm audit`、trivy 文件系统与镜像扫描；工具以校验和验证的二进制安装，不用第三方 Action
- `scripts/check-version-sync.py` 强制 `backend/pyproject.toml` 与 `frontend/package.json` 版本一致，使标签成为无歧义的回滚目标
- Ruff 规则集由 `["E","F","I"]` 扩展至 `["E","F","I","B","UP","SIM","RUF","S","ASYNC","PTH"]`；`RUF001/002/003` 全局忽略（中文全角标点是正确排版而非同形字攻击），`B008` 经 `extend-immutable-calls` 放行 FastAPI 的 `Depends` 惯用法
- 后端 mypy 配置为 `strict`，`app/` 全量通过；Agent 相关第三方库以带注释的 burn-down override 列表豁免
- 前端补齐 `typecheck` 与 `format:check` 脚本（CI 已调用但此前并不存在）、`.prettierrc`、`.prettierignore`、`.nvmrc`；ESLint 升级为类型感知并加入 jsx-a11y；`tsconfig` 纳入 `e2e/`、`vitest.config.ts`、`playwright.config.ts` 并开启 `noUncheckedIndexedAccess`
- 五个此前 `response schema` 为空（`"schema": {}`）的接口（health / config / story / events / auth logout）因补齐返回类型注解而获得真实的 OpenAPI 契约，前端生成类型同步更新
- **修复依赖声明缺陷**：`authlib` 的 OAuth 客户端优先解析 `httpx2` 并把 `httpx` 回退路径标记为废弃，但 `authlib` 两者都未声明；此前 `httpx2` 仅经 `deepagents → anthropic / langsmith` 传递进入环境，知乎登录因此依赖一条随时可能消失的传递边。现已将 `httpx2>=2.12` 声明为直接依赖
