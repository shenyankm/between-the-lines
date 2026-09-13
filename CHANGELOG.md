# 更新日志

本文件记录所有值得注意的变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

`backend/pyproject.toml` 与 `frontend/package.json` 的版本号必须一致，由 `scripts/check-version-sync.py` 在 CI 中强制。使用 `make release V=<version>` 同时更新两处并预置下一节的桩。

<!-- next -->

## Unreleased · 故事 v2

- v1/v2 并存，免费行动与 AI 任务预算分离；最近游玩、草稿保护和路径日志脱敏。
- 三幕行动目录、明确意图自动处理、重大提议确认、通知核查与联合沟通、伴侣关系分支。
- 访客试玩、服务端 OAuth state 绑定与延迟迁移；独立业务快照、分支重玩、事实引用复盘。
- 审核观点卡、内容哈希缓存、来源回填、可编辑草稿引用和本地成果卡。
- 响应式 WebP、持久化预算账本、回收站/检查点清理、诊断和运营查询、九十例语义评估。
- 迁移 0004–0007、同步接口契约与回归测试；完整发布、维护和回退步骤见 `docs/product-v2-release.md`。
- 新版真实模型评估、合作方 OAuth、机外部署及目标用户研究仍为发布门禁。


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
- **覆盖率下限从装饰变成门禁**：`fail_under = 77.0` 此前只写在配置里，`make test-py` 与 CI 都不带 `--cov` 执行，因此它什么也没拦住。现在两处都执行覆盖率，CI 另外产出 `coverage.xml` 归档。取 77.0 而非真实行覆盖率 84.9，是因为 `branch = true` 在 Python 3.13 上强制 settrace 核心，而该核心会少报「在单个 `async with` 内反复挂起的协程」的同步行——已用裸 `sys.settrace` 探针与 coverage 自己的 sysmon 核心交叉证实为工具缺陷而非测试缺口，完整分析记在 `backend/pyproject.toml` 的设置处
- 新增结构性测试隔离：`backend/tests/conftest.py` 的 autouse fixture 在每个非 unit 测试前 TRUNCATE 除 `alembic_version`、`checkpoint_migrations` 之外的所有表。此前随机顺序能通过只是因为 `dev_login` 每次生成随机身份，隔离是单个接口实现细节的副产品；现在它由 fixture 保证
- 测试按 `unit` / `integration` 标记拆分（10 + 14），`pytest -m unit` 在 PostgreSQL 完全停止时通过，这一点经实测而非假设
- 并发压测成为 CI 门禁：`scripts/load-test.py` 的 base URL、并发档位、p95 预算与报告路径全部改为环境变量，集成 job 在 api 容器内以 stdin 方式执行（该 job 不装 Python 工具链，容器里已有锁定版 httpx），报告经 `docker compose cp` 取出归档。**门禁经过反向验证**：p95 预算收紧到 0.5 秒时退出码 1 并点名超标档位；base URL 指向 `agent_mode=deepseek` 的服务时拒绝运行且不写报告
- `compose.ci.yaml` 将 `MAX_CONCURRENT_TURNS` 提到 64：默认的 30 与压测最高档位完全相等，余量为零，调度抖动会把吞吐门禁变成 429。生产仍是 30，准入分支改由 `test_exhausted_admission_budget_rejects_without_reserving` 确定性断言（预算压到 0 → 429 且不残留占位），该分支此前无任何测试覆盖
- 主机侧 DSN 统一：`make migrate` 之外，`make api` 同样会继承根 `.env` 里指向 compose 内部主机名的 `DATABASE_URL` 与 `CHECKPOINT_URL`，在主机上必然死于无法解析的 SSL 握手。`MIGRATE_DATABASE_URL` 泛化为可覆盖的 `HOST_DATABASE_URL` / `HOST_CHECKPOINT_URL`，两个目标共用；`make api` 已实测能走完 begin/boundary/next/speak 四个回合并按 `request_id` 重放命中检查点
- **修复前端测试的结构性漏跑**：`vitest.config.ts` 的 `include: ["src/**/*.test.ts"]` 不含 `.tsx`，任何 React 组件测试都会被静默跳过而不是报错。改为 `.test.{ts,tsx}` 并接入 jsdom、`@testing-library/react` 与 MSW；测试数由 2 项增至 **54 项**，覆盖 `Play` 的回合恢复与提交流程、`SceneInterlude` 的模态状态机、`store`、`scenes`，以及 `api()` / `sendTurn()` 的每一个错误分支（含跨 chunk 边界被切断的 SSE 帧，真正走 `TextDecoder(stream: true)` 重组）
- 前端覆盖率门禁：`70.85%` statements/lines、`90.9%` branches、`71.79%` functions，全部是**实测基线而非期望值**；`src/api.ts` 单独钉在 100%，使 HTTP 边界新增的未覆盖分支无法躲在全局数字后面。CI 由 `pnpm test` 改为 `pnpm test:coverage`——否则阈值和后端那个下限一样什么也拦不住。`src/main.tsx` 故意留在 0% 里：组合根只由 Playwright 覆盖，把它排除掉只会美化数字
- 两个门禁都做了**反向验证**：改掉 `api()` 的兜底文案 → 5 项测试失败、退出码 1；改掉 `sendTurn()` 的兜底文案 → 恰好 1 项失败。两处兜底相互独立，改文件后已按 sha256 校验逐字节还原
- `.gitignore` 补 `coverage/`（既有的 `.coverage` / `htmlcov/` 都不匹配 vitest v8 的报告目录）；`pnpm-workspace.yaml` 补 `allowBuilds: msw: false`，否则 pnpm 11 的冻结安装以 `ERR_PNPM_IGNORED_BUILDS` 失败
