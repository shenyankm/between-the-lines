# 持续集成

`.github/workflows/ci.yml` 定义后端、前端、Docker 集成及汇总门禁。日常验证全部使用 mock，无需真实模型密钥，不发布或部署。审计工作流在 `.github/workflows/audit.yml`；本轮结果见 [验证记录](verification.md)。

## 代码门禁

- 后端：uv 锁与哈希导出一致性、Ruff lint/format、mypy strict、Alembic 迁移与漂移检查、pytest。覆盖率下限为 82%，包含迁移后的模块。
- 前端：固定 pnpm 锁安装、类型感知 ESLint、Prettier、TypeScript、Vitest 覆盖率及 Vite 构建。总体阈值保留在 `vitest.config.ts`，HTTP 边界 `src/api.ts` 四项均要求 100%。
- 契约：OpenAPI、生成的 TypeScript、公开故事测试数据在临时目录重新生成后比较。`make contract` 不写工作区，显式更新使用 `make contract-generate`。
- 依赖：`make lock-check` 不写工作区，仅忽略 uv 导出注释中的临时输出路径；显式更新使用 `make deps-update`。

`make check` 执行代码门禁；浏览器、断线、重启、压测和备份恢复是独立集成门禁。`make migrate-check` 只读，执行前必须显式迁移目标数据库。

## 隔离

本机使用已有 Miniconda Python 3.13，不创建虚拟环境；前端命令从 frontend 目录执行，由 Corepack 读取 pnpm 11.19.0。CI 使用独立 Python 3.13 和锁定依赖。

后端非 unit 测试使用专用 `btl_test`，每项测试前清空业务与检查点表，保留迁移元数据。迁移测试先降级到 0002，写入各幕旧格式记录，再升级并验证读取、终态重放与原 JSON 未变。不要把测试连接指向演示库。

`scripts/test-disconnect.py` 使用真实 TCP 关闭订阅，验证后台完成且无重复工具或对白。`scripts/test-restart.py` 在工具提交后强制终止独立进程，验证重启恢复保留事实与会话。两者顺序执行，不与共享 btl_test 的测试并行。

## 容器和浏览器

`compose.ci.yaml` 不加载本地 .env，以独立 btl-ci 项目启动 PostgreSQL、API、Nginx。浏览器通过 localhost:18080 访问，覆盖桌面与手机通关、场景资源、幕间取消、抽屉键盘操作以及刷新对账。CI 保留失败截图、trace 和报告。

```sh
make ci-stack
(cd frontend && corepack pnpm exec playwright install chromium)
(cd frontend && CI=true PLAYWRIGHT_BASE_URL=http://localhost:18080 corepack pnpm test:e2e)
export COMPOSE_FILE=compose.ci.yaml
export COMPOSE_PROJECT_NAME=btl-ci
export COMPOSE_DISABLE_ENV_FILE=true
docker compose exec -T web nginx -t
docker compose exec -T -e BTL_LOAD_TEST_REPORT=/tmp/load-test.json api python - < scripts/load-test.py
docker compose cp api:/tmp/load-test.json artifacts/load-test.json
sh scripts/verify-restore.sh
make ci-stack-down
```

压测调用真实 Agent 图与 mock 模型 transport，先核实目标为 mock，再执行 10/20/30 并发；失败率须为零，p95 须低于配置预算。容器内测试直连 Uvicorn，Nginx 路径由 Playwright 验证。隔离栈并发预算为 64，默认应用预算仍为 30；额度拒绝另有确定性测试。

恢复脚本只在临时数据库执行 restore，不覆盖源数据库。`make ci-stack-down` 仅清理隔离测试栈和卷。CI 无论成功失败均执行清理，并保留报告 7 天。远端 Actions 执行结果需在实际仓库运行中确认，不能以本机结果代替。

## Audit 修复与运行时镜像

历史密钥扫描仅在 `.gitleaksignore` 排除一个已核实的指纹：空 API key 跨行误匹配额度配置。默认规则及全历史扫描保留；新增凭据不会因文件名而被放行。示例空值使用行内注释阻止跨行误匹配。

API 保持 Python 3.13 与原依赖锁，运行镜像改用固定摘要的 Python 3.13.15 / Alpine 3.24，并安装发行版安全更新。两个 Debian slim 候选仍有未修复系统包命中，因此不采用忽略未修复漏洞的办法。锁定依赖安装完成后删除 pip 和 ensurepip（含其 vendored 依赖），运行中的 API 不支持安装包；修改依赖需重新构建镜像。本机继续使用原 Miniconda。

Web 使用固定摘要的 Nginx 1.30.4 / Alpine，安装安全更新，以 UID/GID 101 运行。PID 和临时数据写入 /tmp，内部端口改为 8080/8443，Compose 对外端口保持原值。生产 TLS 私钥读取权限见 README；`scripts/test-web-runtime.sh` 使用隔离的临时证书和卷验证非 root、HTTP 跳转、HTTPS 静态页面和 API 代理。

Audit 仍阻断 HIGH/CRITICAL，不使用漏洞忽略列表。两个镜像都扫描并保留报告，即使第一个失败也继续检查第二个。汇总等待全部适用 job，只有未安排镜像扫描的事件才接受 skipped。`scripts/test-audit.py` 检查失败传播与跳过逻辑。基础摘要固定，但 apk 安全更新随仓库变化，未来出现新漏洞仍会使审计失败，需要再次更新和验证。

2026-09-13 本地修复验证：Gitleaks 全历史通过，示例文件负例和合成凭据正例符合预期；Trivy 0.74.0 文件系统及两份最终镜像的 HIGH/CRITICAL 命中均为 0。Alpine API 镜像安装原哈希锁成功，隔离运行 62 项后端单元测试通过，10/20/30 并发 mock 压测失败率均为 0。审计门禁测试覆盖 162 种汇总状态及首／末镜像失败传播。生产 TLS 检查以 UID 101 完成。

复测同时定位并修复游戏页的草稿竞态：上一回合刷新结束后只清空未被修改的提交草稿，避免覆盖玩家新输入。新增回归测试在原实现失败、修复后通过；前端 148 项测试及覆盖率、类型和 lint 检查通过。云端执行结果以本次推送后的 Actions 为准。
