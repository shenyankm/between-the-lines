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
- 新增 `SECURITY.md`、`CHANGELOG.md`、`docs/adr/`、`docs/operations.md`、`docs/tls.md`
