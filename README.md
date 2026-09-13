# 言外之意 · Between the Lines

React + FastAPI 的职场互动小说。孙淼、李姐、张工由独立 Deep Agents 驱动；剧情规则与采购流程由后端裁决，PostgreSQL 保存游戏事实和独立的 Agent 检查点。

## 本机运行

**Python 使用已有 Miniconda，不创建 `.venv` 或新的 Conda 环境。数据库使用 Docker PostgreSQL。**

以下命令在项目根目录执行，`python` 应指向已激活的 Miniconda Python 3.12 或 3.13（本机为 `/Users/sheny/miniconda3/bin/python`）。

```sh
conda activate base
python -m pip install uv
uv pip install --python "$(command -v python)" --require-hashes -r backend/requirements.lock
docker compose -f compose.yaml -f compose.dev.yaml up -d db
cd backend
python -m alembic upgrade head
AGENT_MODE=mock python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

另一个终端：

```sh
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

打开 [http://localhost:5173](http://localhost:5173)，点击“开发环境试玩”。开发登录每次创建独立身份；刷新保留登录，退出后再登录不会找回之前的开发身份。正式用户由知乎身份稳定映射。

模拟模式不是跳过 Agent：`ChatDeepSeek → HTTPX 模拟 DeepSeek SSE → Deep Agents 工具循环 → 领域服务 → PostgreSQL`，包括流式工具参数拼接、工具执行和检查点。模拟 Token 数是测试估算，费用为零，不代表真实模型的延迟、语义能力或费用。

## 开发配置

本机后端从 `backend/.env` 读取配置；不设置时，数据库默认为 `localhost:54329`，生产容器使用根目录 `.env`。请勿将容器地址 `db:5432` 直接用于本机 Python。

```dotenv
# backend/.env 本机示例
AGENT_MODE=mock
DATABASE_URL=postgresql+asyncpg://btl:btl@localhost:54329/btl
CHECKPOINT_URL=postgresql://btl:btl@localhost:54329/btl
PUBLIC_ORIGIN=http://localhost:5173
```

未来真实联调改为 `AGENT_MODE=deepseek` 并配置 `DEEPSEEK_API_KEY`，重启后端。模型固定为 DeepSeek 官方 `deepseek-flash`，显式 `thinking.type=disabled`，不自动切换供应商。当前依照用户要求仅使用模拟返回。

## 已实现流程

- 序幕、欢送会、采购审核、谣言澄清与结局；独立存档和跨设备云端进度。
- 角色对话、手机联系人、朋友圈文本、采购材料和项目汇报、编辑锦囊、行动回顾。
- 固定幕次前置条件、角色权限、重复请求幂等、乐观版本检查、单存档并发限制、每日用户额度。
- 角色可见事件过滤和独立检查点；失败回合保留已提交事实、不保存未完成对白。
- 模型超时、调用与工具预算；仅展示最终对白，不暴露内部推理、工具参数或提示词。

剧情与角色设定集中在 `backend/app/story.json`，规则位于 `backend/app/domain.py`。手机中的人物关系卡随进度更新；第三幕完成澄清与交付后，由玩家选择结束私人来往或保持距离继续观察。具体叙事、隐私与旧存档规则见 [人物关系与结局](docs/story-relationships.md)。编辑锦囊明确标为编辑建议，不伪装成实时知乎搜索结果。

## 验证

```sh
# 单独测试数据库，只需创建一次
docker compose exec -T db createdb -U btl btl_test
cd backend
DATABASE_URL=postgresql+asyncpg://btl:btl@localhost:54329/btl_test python -m alembic upgrade head
python -m pytest -q
python -m ruff check app tests migrations
cd ../frontend
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

浏览器测试使用本机 Google Chrome，需要已启动模拟后端和 Vite。覆盖桌面与手机完整通关、采购工具、刷新恢复和横向溢出检查。

```sh
# 根目录，已启动 mock 后端
python scripts/load-test.py
python scripts/test-restart.py
sh scripts/verify-restore.sh
```

压测覆盖 10/20/30 并发玩家回合，报告输出到 `artifacts/load-test.json`；脚本拒绝对真实模型执行压力测试。

接口契约更新：

```sh
python scripts/export-openapi.py
cd frontend
pnpm generate:api
```

## 单机部署

```sh
cp .env.example .env
# 编辑配置；正式环境务必按下述项目配置
docker compose up -d --build
```

本地容器预览为 `http://localhost:8080`。生产设置 `ENVIRONMENT=production`、`DEV_LOGIN_ENABLED=false`、`AGENT_MODE=deepseek`、随机 `SESSION_SECRET`、HTTPS `PUBLIC_ORIGIN`、数据库密码、DeepSeek 密钥和知乎配置。正式环境启动时拒绝开发身份和模拟模式。

知乎 OAuth 的授权、Token、用户信息端点和身份字段必须按合作方官方文档填写；当前没有猜测任何知乎端点，也尚未进行真实登录联调。OAuth 凭据不存入浏览器，本站使用可撤销的 HttpOnly Cookie 会话。

Web 容器以 UID/GID `101:101` 运行，容器内 HTTP/HTTPS 使用 8080/8443；Compose 对外地址保持不变。

TLS 文件目录包含 `fullchain.pem` 和 `privkey.pem`。在 Linux 部署机将私钥设为 `root:101`、权限 `0640`，目录允许 GID 101 遍历（例如 `root:101`、`0750`），证书可设 `0644`。不要把私钥设为全员可读；证书续期后也须保留这些权限。配置示例：

```sh
sudo chown root:101 "$TLS_DIRECTORY" "$TLS_DIRECTORY/privkey.pem"
sudo chmod 0750 "$TLS_DIRECTORY"
sudo chmod 0640 "$TLS_DIRECTORY/privkey.pem"
```

设置 `TLS_DIRECTORY` 后，运行：

```sh
docker compose -f compose.yaml -f compose.production.yaml up -d --build
```

生产数据库不暴露宿主机端口；仅本地开发覆盖文件绑定 `127.0.0.1:54329`。API 当前明确使用一个 Uvicorn worker，容量限制按单进程设计；需要多进程或多机时必须先改造全局并发预算与恢复协调。

### 备份、恢复与维护

`scripts/backup.sh` 使用 `pg_dump -Fc`，通过 SCP 传到 `BACKUP_REMOTE` 指定的另一台主机，传输失败会返回非零退出码。部署主机配置 SSH 后，可安装每日任务，例如：

```cron
15 3 * * * BACKUP_REMOTE=backup@archive.example:/srv/btl-backups/ /bin/sh /srv/between-the-lines/scripts/backup.sh >> /var/log/btl-backup.log 2>&1
```

该示例不会自动安装。必须替换真实目标并确认备份成功；远端保留策略由备份主机管理。`verify-restore.sh` 在临时数据库恢复并检查业务表与检查点，随后删除临时数据库，不覆盖运行中数据。

日志记录回合 ID、NPC、用量、耗时和失败类型，不记录密钥、完整私人对话或内部推理。默认不启用外部 LangSmith 追踪。真实费用是按可配置单价计算的估算，最终以 DeepSeek 账单为准。

### 依赖升级

`backend/uv.lock` 为版本锁；`requirements.lock` 为带哈希的安装导出，兼容直接安装至 Miniconda。升级时仅使用 `uv lock` 和 `uv export`，不要使用会创建环境的 `uv sync`/`uv run`：

```sh
uv lock --project backend
uv export --project backend --frozen --no-emit-project --format requirements-txt --output-file backend/requirements.lock --quiet
uv pip install --python "$(command -v python)" --require-hashes -r backend/requirements.lock
```

生产上线前仍须配置真实域名、证书、知乎合作方 OAuth、DeepSeek 密钥和机外备份目标。单机不提供高可用保障。

## CI

GitHub Actions 自动执行后端测试、接口契约同步、前端检查和构建、Docker 集成、桌面/手机端到端测试及备份恢复。测试使用模拟 LLM，不需要真实密钥。工作流与本地复现方法见 [CI 说明](docs/ci.md)。分支保护可使用汇总检查 `CI required`。

单故事重构的模块边界、事务、SSE 契约和恢复状态机见 [架构说明](docs/architecture.md)。`make contract-generate` 用于显式生成，`make contract` 与 `make lock-check` 只检查、不修改文件。
