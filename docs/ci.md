# 持续集成

项目使用 `.github/workflows/ci.yml`（功能检查）和 `.github/workflows/audit.yml`（安全与依赖审计）。`main` 分支推送、Pull Request 和手动触发均执行全部检查；推送限定在 `main`，避免 Pull Request 分支上同一次改动跑两遍。同一分支的新运行会取消旧运行。GitHub Actions 仅有读取代码权限，不发布镜像、不部署，也不需要 DeepSeek 或知乎密钥。

## 检查范围

| Job | 检查内容 |
|---|---|
| Backend and API contract | uv 锁文件一致性、哈希安装、Ruff lint 与 format --check、mypy strict、空数据库 Alembic 迁移和模型差异、pytest、进程崩溃恢复、OpenAPI / TypeScript 生成结果差异 |
| Frontend checks and build | pnpm 冻结锁安装、ESLint（类型感知 + jsx-a11y）、Prettier --check、tsc 类型检查、Vitest、Vite 生产构建 |
| Docker and browser integration | 实际构建 API / Nginx 镜像、独立 PostgreSQL 容器、健康检查、Nginx 配置、桌面与手机通关和场景测试、数据库备份恢复 |
| CI required | 汇总前三项；失败、取消或跳过都不能通过 |
| Secrets and dependencies（audit.yml） | gitleaks 全历史密钥扫描、`doc-fetch-resources/` 从未入库断言、uv audit、pnpm audit、trivy 文件系统扫描 |
| Images（audit.yml） | 仅在定时、手动触发或 `main` 推送时构建两个镜像并执行 trivy 镜像扫描 |

CI 是 `make check` 的严格子集：本地能跑通的门禁，CI 必须也跑，反之不要求 CI 跑本地跑不了的项。后端 job 缓存 uv 与 pnpm store，集成 job 另外缓存 Playwright 浏览器；缓存键包含锁文件哈希，锁变更即失效。

仓库接入 GitHub 后，可在分支保护中要求 `CI required` 通过。当前状态：目录已在本地初始化 Git（分支 `main`），`.gitignore` 在首次提交前已加固，`doc-fetch-resources/`、各 `.env`、`artifacts/`、`*.pem` 均经 `git check-ignore` 确认被排除，暂存内容经密钥模式扫描无命中。**仍未提供远端**，因此 Actions 从未在 GitHub runner 上真实执行，分支保护也尚未生效；下文「本次本地验证」记录的仍是本机结果。

## 环境与隔离

本机 Python 继续使用已有 Miniconda；CI 使用 runner 上的 Python 3.13，直接安装锁定依赖，不创建虚拟环境。Node 22.23.2、pnpm 11.19.0 和 uv 0.12.13 固定版本；GitHub Actions 固定到对应发布版本的提交 SHA。

后端单测使用临时 PostgreSQL service 的 `btl_test` 数据库。端到端使用独立 `compose.ci.yaml`，不加载项目 `.env`，密钥为空、Agent 为 mock，浏览器通过 `http://localhost:18080` 访问 Nginx。`CI=true` 时使用 Playwright 安装的 Chromium，禁止 `test.only`，保留失败截图、trace 与 HTML/JUnit 报告。没有自动重试掩盖偶发失败。

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
sh scripts/verify-restore.sh
docker compose down --volumes --remove-orphans
```

Linux 首次安装浏览器使用 `playwright install --with-deps chromium`，参见 [Playwright 官方 CI 文档](https://playwright.dev/docs/ci)。无论测试成功失败，都应执行最后的测试栈清理命令。

如果接口或依赖检查发现差异，在本机重新生成并连同业务修改一起提交；不要在 CI 内自动提交生成文件。

## 本地验证

### 本轮（静态分析与类型安全）重新执行并通过

- `ruff check` 与 `ruff format --check`：`backend/app`、`backend/tests`、`backend/migrations`、`scripts` 全部通过。
- `mypy --strict`：`app/` 11 个源文件 0 错误，全仓仅 6 处带书面理由的抑制。
- `pytest`：23 项通过。
- 前端 `tsc -b --force`、`eslint .`（类型感知 + jsx-a11y）、`prettier --check`、`vitest`（2 项）、`vite build` 全部通过。
- `uv lock --check`、哈希导出一致性、版本同步检查通过。
- OpenAPI → TypeScript 契约重新生成；本轮产生的差异已随业务修改一并提交，`make contract` 恢复为无差异。

### 较早验证、本轮**未**重新执行

以下几项在容器与端到端层面此前验证通过，但本轮改动未触及，故未重跑；不要把它们当作本轮结果：

- Docker 镜像构建、三服务健康检查、Nginx 配置验证。
- `CI=true`、Playwright Chromium、Docker API/Nginx 下的 4 项桌面/手机测试，HTML/JUnit 报告生成。
- 备份恢复演练（曾恢复 2 个存档和 48 条检查点）；临时 CI 容器和数据卷已清理。
- Alembic 迁移与 schema drift 检查、独立进程崩溃恢复。
- 工作流文件校验：此前用 actionlint 1.7.7，**本机现已不再安装该工具**，本轮改用结构化解析（`yaml.safe_load` 遍历全部 job 与 step）代替，强度弱于 actionlint。

上述均为本机 Miniconda/macOS 加 Docker 的验证。GitHub Ubuntu runner 的远端执行仍需将项目推送到 GitHub。
