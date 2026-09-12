# 持续集成

项目使用 `.github/workflows/ci.yml`。推送、Pull Request 和手动触发均执行全部检查；同一分支的新运行会取消旧运行。GitHub Actions 仅有读取代码权限，不发布镜像、不部署，也不需要 DeepSeek 或知乎密钥。

## 检查范围

| Job | 检查内容 |
|---|---|
| Backend and API contract | uv 锁文件一致性、哈希安装、Ruff、空数据库 Alembic 迁移和模型差异、pytest、进程崩溃恢复、OpenAPI / TypeScript 生成结果差异 |
| Frontend checks and build | pnpm 冻结锁安装、ESLint、Vitest、TypeScript 与 Vite 生产构建 |
| Docker and browser integration | 实际构建 API / Nginx 镜像、独立 PostgreSQL 容器、健康检查、Nginx 配置、桌面与手机通关和场景测试、数据库备份恢复 |
| CI required | 汇总前三项；失败、取消或跳过都不能通过 |

仓库接入 GitHub 后，可在分支保护中要求 `CI required` 通过。当前状态：目录已在本地初始化 Git（分支 `main`），`.gitignore` 在首次提交前已加固，`doc-fetch-resources/`、各 `.env`、`artifacts/`、`*.pem` 均经 `git check-ignore` 确认被排除，暂存内容经密钥模式扫描无命中。**仍未提供远端**，因此 Actions 从未在 GitHub runner 上真实执行，分支保护也尚未生效；下文「本次本地验证」记录的仍是本机结果。

## 环境与隔离

本机 Python 继续使用已有 Miniconda；CI 使用 runner 上的 Python 3.13，直接安装锁定依赖，不创建虚拟环境。Node 22.23.2、pnpm 11.19.0 和 uv 0.12.13 固定版本；GitHub Actions 固定到对应发布版本的提交 SHA。

后端单测使用临时 PostgreSQL service 的 `btl_test` 数据库。端到端使用独立 `compose.ci.yaml`，不加载项目 `.env`，密钥为空、Agent 为 mock，浏览器通过 `http://localhost:18080` 访问 Nginx。`CI=true` 时使用 Playwright 安装的 Chromium，禁止 `test.only`，保留失败截图、trace 与 HTML/JUnit 报告。没有自动重试掩盖偶发失败。

工作流始终清理测试容器与卷。测试结果、容器日志保留 7 天；前端构建产物同样保留 7 天。

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

## 本次本地验证

- actionlint 1.7.7 校验工作流通过。
- uv 锁校验、哈希导出一致性、OpenAPI / TypeScript 重生成无差异。
- Ruff、ESLint、Vitest（2 项）、pytest（21 项）、TypeScript / Vite 构建通过。
- Alembic 迁移和 schema drift 检查、独立进程崩溃恢复通过。
- Docker 镜像构建、三服务健康检查、Nginx 配置验证通过。
- `CI=true`、Playwright Chromium、Docker API/Nginx 下的 4 项桌面/手机测试通过，HTML/JUnit 报告正常生成。
- 备份恢复验证通过，恢复了 2 个存档和 48 条检查点。临时 CI 容器和数据卷已清理，原有开发服务保留。

上述为本机 Miniconda/macOS 加 Docker 的验证，GitHub Ubuntu runner 的远端执行仍需将项目推送到 GitHub。
