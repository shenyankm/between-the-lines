# 单机部署

```sh
cp .env.example .env
# 编辑配置；正式环境务必按下述项目配置
docker compose up -d --build
```

本地容器预览为 `http://localhost:8080`。生产设置 `ENVIRONMENT=production`、`DEV_LOGIN_ENABLED=false`、`AGENT_MODE=openai` 或 `AGENT_MODE=deepseek`、随机 `SESSION_SECRET`、HTTPS `PUBLIC_ORIGIN`、数据库密码、对应供应商的模型密钥和知乎配置。正式环境启动时拒绝开发身份和模拟模式。

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

日志记录回合 ID、NPC、用量、耗时和失败类型，不记录密钥、完整私人对话或内部推理。默认不启用外部 LangSmith 追踪。真实费用是按可配置单价计算的估算，最终以所用供应商账单为准。

### 依赖升级

`backend/uv.lock` 为版本锁；`requirements.lock` 为带哈希的安装导出，兼容直接安装至 Miniconda。升级时仅使用 `uv lock` 和 `uv export`，不要使用会创建环境的 `uv sync`/`uv run`：

```sh
uv lock --project backend
uv export --project backend --frozen --no-emit-project --format requirements-txt --output-file backend/requirements.lock --quiet
uv pip install --python "$(command -v python)" --require-hashes -r backend/requirements.lock
```

生产上线前仍须配置真实域名、证书、知乎合作方 OAuth、对应供应商的模型密钥和机外备份目标。单机不提供高可用保障。
