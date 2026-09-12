# 持续集成

项目使用 `.github/workflows/ci.yml`（功能检查）和 `.github/workflows/audit.yml`（安全与依赖审计）。`main` 分支推送、Pull Request 和手动触发均执行全部检查；推送限定在 `main`，避免 Pull Request 分支上同一次改动跑两遍。同一分支的新运行会取消旧运行。GitHub Actions 仅有读取代码权限，不发布镜像、不部署，也不需要 DeepSeek 或知乎密钥。

## 检查范围

| Job | 检查内容 |
|---|---|
| Backend and API contract | uv 锁文件一致性、哈希安装、Ruff lint 与 format --check、mypy strict、空数据库 Alembic 迁移和模型差异、pytest（含 77.0% 覆盖率下限，未达标即失败）、进程崩溃恢复、OpenAPI / TypeScript 生成结果差异 |
| Frontend checks and build | pnpm 冻结锁安装、ESLint（类型感知 + jsx-a11y）、Prettier --check、tsc 类型检查、Vitest、Vite 生产构建 |
| Docker and browser integration | 实际构建 API / Nginx 镜像、独立 PostgreSQL 容器、健康检查、Nginx 配置、桌面与手机通关和场景测试、10/20/30 并发压测（失败率必须为 0，p95 不得超过预算）、数据库备份恢复 |
| CI required | 汇总前三项；失败、取消或跳过都不能通过 |
| Secrets and dependencies（audit.yml） | gitleaks 全历史密钥扫描、`doc-fetch-resources/` 从未入库断言、uv audit、pnpm audit、trivy 文件系统扫描 |
| Images（audit.yml） | 仅在定时、手动触发或 `main` 推送时构建两个镜像并执行 trivy 镜像扫描 |

CI 是 `make check` 的严格子集：本地能跑通的门禁，CI 必须也跑，反之不要求 CI 跑本地跑不了的项。后端 job 缓存 uv 与 pnpm store，集成 job 另外缓存 Playwright 浏览器；缓存键包含锁文件哈希，锁变更即失效。

仓库接入 GitHub 后，可在分支保护中要求 `CI required` 通过。当前状态：目录已在本地初始化 Git（分支 `main`），`.gitignore` 在首次提交前已加固，`doc-fetch-resources/`、各 `.env`、`artifacts/`、`*.pem` 均经 `git check-ignore` 确认被排除，暂存内容经密钥模式扫描无命中。**仍未提供远端**，因此 Actions 从未在 GitHub runner 上真实执行，分支保护也尚未生效；下文「本次本地验证」记录的仍是本机结果。

## 环境与隔离

本机 Python 继续使用已有 Miniconda；CI 使用 runner 上的 Python 3.13，直接安装锁定依赖，不创建虚拟环境。Node 22.23.2、pnpm 11.19.0 和 uv 0.12.13 固定版本；GitHub Actions 固定到对应发布版本的提交 SHA。

后端单测使用临时 PostgreSQL service 的 `btl_test` 数据库。端到端使用独立 `compose.ci.yaml`，不加载项目 `.env`，密钥为空、Agent 为 mock，浏览器通过 `http://localhost:18080` 访问 Nginx。`CI=true` 时使用 Playwright 安装的 Chromium，禁止 `test.only`，保留失败截图、trace 与 HTML/JUnit 报告。没有自动重试掩盖偶发失败。

`backend/tests/conftest.py` 有一个 autouse fixture，在每个非 unit 测试前 TRUNCATE 除 `alembic_version` 与 `checkpoint_migrations` 之外的所有表。这是必要的，不是洁癖：此前测试在随机顺序下也能通过，只是因为 `dev_login` 每次调用都生成随机身份，两个测试永远不会看到彼此的行——隔离是某个接口实现细节的副产品，一旦它改变就会无声消失。TRUNCATE 把隔离变成结构性的。`unit` 标记的测试豁免，因此 `pytest -m unit` 在 PostgreSQL 停止时依然通过，这正是标记拆分的意义。

压测栈把 `MAX_CONCURRENT_TURNS` 提到 64。默认的 30 与压测最高并发档位完全相等，余量为零，一次调度抖动就会把吞吐门禁变成 429。生产仍使用 `app/config.py` 里的 30；准入分支本身由 `tests/test_concurrency.py::test_exhausted_admission_budget_rejects_without_reserving` 确定性地断言（把预算压到 0，验证返回 429 且不残留占位），不依赖压测碰运气。

压测脚本在 api 容器内以 `docker compose exec -T api python - < scripts/load-test.py` 运行：集成 job 不安装 Python 工具链，而容器里已有锁定版本的 httpx。容器内默认的 `127.0.0.1:8000` 直连 uvicorn，因此测的是应用本身，Nginx 路径由端到端测试覆盖。四个环境变量（`BTL_LOAD_TEST_BASE_URL` / `LEVELS` / `MAX_P95_SECONDS` / `REPORT`）让同一份脚本既能跑在本机也能跑在容器里；stdin 方式没有 `__file__`，报告路径的默认值因此做了保护。脚本启动即校验目标必须是 mock 且开启开发登录，否则拒绝运行——它对真实模型服务器永远不会发出回合。

工作流始终清理测试容器与卷。测试结果、容器日志保留 7 天；前端构建产物同样保留 7 天。

## 尚未启用的检查

CodeQL 数据流分析尚未接入，原因是明确的而非遗漏：CodeQL 仅对公开仓库免费，私有仓库需要 GitHub Advanced Security 许可；而本仓库**尚未配置远端**，即使写入工作流也无法验证它真的跑起来。启用前需要两个前置条件——仓库推送到 GitHub，且确认许可覆盖（公开仓库或已购买 GHAS）。届时使用 `github/codeql-action` v3，已解析的提交 SHA 为 `faaca9a8f6edddba5725ffe5adefdab6669a2eca`，与本仓库其余 Actions 一样按 SHA 固定而非按标签引用。

在 CodeQL 接入之前，注入类与污点传播类问题依赖 mypy strict、类型感知 ESLint 和端到端测试覆盖，这三项都不依赖远端即可验证。

## 本地复现容器集成测试

在项目根目录执行；仅创建 `btl-ci` 测试栈，不影响本机 8000 / 5173 试玩服务：

```sh
export COMPOSE_FILE=compose.ci.yaml
export COMPOSE_PROJECT_NAME=btl-ci
export COMPOSE_DISABLE_ENV_FILE=true
docker compose up --build -d --wait --wait-timeout 180
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend exec playwright install chromium
CI=true PLAYWRIGHT_BASE_URL=http://localhost:18080 pnpm --dir frontend test:e2e
mkdir -p artifacts
docker compose exec -T -e BTL_LOAD_TEST_REPORT=/tmp/load-test.json api python - < scripts/load-test.py
docker compose cp api:/tmp/load-test.json artifacts/load-test.json
sh scripts/verify-restore.sh
docker compose down --volumes --remove-orphans
```

Linux 首次安装浏览器使用 `playwright install --with-deps chromium`，参见 [Playwright 官方 CI 文档](https://playwright.dev/docs/ci)。无论测试成功失败，都应执行最后的测试栈清理命令。

如果接口或依赖检查发现差异，在本机重新生成并连同业务修改一起提交；不要在 CI 内自动提交生成文件。

## 本地验证

### 本轮（测试深度、覆盖率与压测门禁）重新执行并通过

- `make test-py`：**24 项通过**，覆盖率 **77.22%**，达到 `fail_under = 77.0`。覆盖率此前只写在配置里，`make test-py` 和 CI 都不执行它，因此那个下限形同虚设；本轮两处都接上了，并实际验证过"未达标即失败"。
- 下限取的是**当前配置实际测得的数字**（77.0），不是真实行覆盖率（84.9）。原因是已证实的测量工具缺陷：`branch = true` 在 Python 3.13 上强制使用 settrace 核心（sys.monitoring 无法测量分支），而 CTracer 与 PyTracer 都会丢掉"在单个 `async with` 内反复挂起的协程"的同步行，只留下 `await` 行。全仓只有 `services.py::begin_turn` 是这种形状，所以它报 53.6%，而三项独立检查证明每一行都执行了：回合确实提交并返回 200；裸 `sys.settrace` 探针记录到 36–102 行；coverage 自己的 sysmon 核心在关闭分支测量后报 86.1%。误差方向单一（只会少报），因此这个下限是保守而非危险的。完整分析写在 `backend/pyproject.toml` 的注释里，避免后来者去"修"本来就通过的测试。
- `pytest -m unit`：在 **PostgreSQL 完全停止**（`make dev-down`）的情况下 10 项通过、14 项 deselected；重启数据库后 24 项全通过。隔离 fixture 对 unit 测试豁免，这一点是被实测的而不是被假设的。
- 随机顺序：连续 5 轮全量 `pytest`（pytest-randomly 5.0.0，每轮种子不同，例如 2462528306 / 4160248180）均 24 项通过。
- `make migrate-check`：`No new upgrade operations detected.`——这一条同时验证了 `MIGRATE_DATABASE_URL` 改名为 `HOST_DATABASE_URL` 后仍然生效。
- 容器压测：`make ci-stack` 三服务全部 healthy；在 api 容器内执行与 CI 完全相同的那条命令，10 / 20 / 30 并发**失败率均为 0**，p95 分别 0.431 / 0.780 / 1.098 秒，报告用 `docker compose cp` 成功取出；随后 `make ci-stack-down` 清理容器与数据卷。
- 门禁的**反向**验证（确认它真的会红，而不是恒绿）：把 `BTL_LOAD_TEST_MAX_P95_SECONDS` 设为 0.5 → 退出码 1，消息点名超标档位；把 `BTL_LOAD_TEST_BASE_URL` 指向一个 `agent_mode=deepseek` 的服务 → 拒绝运行、退出码 1、不写任何报告文件。
- `make api` 的主机 DSN 修复：`make migrate` 的同类缺陷上一轮已修，本轮发现 `make api` 一样会继承 `.env` 里指向 compose 内部主机名的 `DATABASE_URL` **和** `CHECKPOINT_URL`，已把两个变量统一为可覆盖的 `HOST_DATABASE_URL` / `HOST_CHECKPOINT_URL`。用与 Makefile 完全相同的环境变量在 8001 端口启动（8000 被本机试玩服务占用），`/api/config` 与 `/api/story` 均 200；随后走完 begin / boundary / next / speak 四个回合：speak 返回 `completed`，按 `request_id` 重放拿到 `model_calls=2`、`cost_estimate_usd=0.0`，日志 0 条错误。重放能命中说明 LangGraph 检查点确实写进了 `CHECKPOINT_URL` 指向的库，而不只是应用进程起来了。
- `ruff check` 与 `ruff format --check`：`backend/app`、`backend/tests`、`backend/migrations`、`scripts` 共 28 个文件全部通过。
- 工作流文件：`yaml.safe_load` 结构化解析通过，并确认集成 job 的步骤顺序为 …端到端 → 压测 → 备份恢复…；`compose.ci.yaml` 解析通过。actionlint 本机**仍未安装**。

### 上一轮（静态分析与类型安全）重新执行并通过

- `mypy --strict`：`app/` 11 个源文件 0 错误，全仓仅 6 处带书面理由的抑制。
- 前端 `tsc -b --force`、`eslint .`（类型感知 + jsx-a11y）、`prettier --check`、`vitest`、`vite build` 全部通过。
- `uv lock --check`、哈希导出一致性、版本同步检查通过。
- OpenAPI → TypeScript 契约重新生成；该轮产生的差异已随业务修改一并提交，`make contract` 恢复为无差异。

### 较早验证、本轮**未**重新执行

以下几项此前验证通过，本轮改动未触及或只触及了相邻部分，故未重跑；不要把它们当作本轮结果：

- Playwright 桌面/手机端到端测试（4 项）。本轮**构建并启动了** CI 栈、三服务健康检查通过，但没有安装浏览器、没有跑 e2e，所以浏览器层未被本轮覆盖。
- 备份恢复演练（曾恢复 2 个存档和 48 条检查点）。
- 独立进程崩溃恢复（`scripts/test-restart.py`）。
- Nginx 配置验证（`docker compose exec -T web nginx -t`）。

上述均为本机 Miniconda/macOS 加 Docker 的验证。GitHub Ubuntu runner 的远端执行仍需将项目推送到 GitHub。

