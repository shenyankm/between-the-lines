# 单故事模块化单体

本项目保留 React、FastAPI、PostgreSQL 和 Deep Agents。仅运行一个 API 进程；模型调用使用现有工厂，日常验证使用 mock transport 和真实 Agent 图。

## 模块与资源生命周期

- `app/game_types.py`、`app/domain.py`：类型化状态、动作、权限和纯函数规则。规则不读取数据库或故事文件。
- `app/services.py`：事务边界、回合受理、工具事实、统一终态提交、旧存档验证及一致性页面读取。直接使用具体 SQLAlchemy 会话，不建立通用仓储框架。
- `app/runner.py`：后台执行、限流名额、超时、用量和执行指标。HTTP 连接只订阅任务，断线不取消任务。
- `app/storage.py`、`app/agents.py`：连接池和 Deep Agents 适配。Agent 接收 `AgentTurn` 与 `AgentContext`，只依赖受限 `GameTools`，没有 ORM 对象。
- `app/routes/`、`app/auth.py`：身份、参数、响应 DTO、错误和 SSE。`create_app(settings, dependencies)` 在 lifespan 内建立资源；测试注入 reply/epilogue，不替换业务模块全局变量。导出 OpenAPI 不启动 lifespan、不连接数据库。

启动取得 PostgreSQL advisory lock 后才恢复遗留 running 回合；第二进程拒绝启动。重启把遗留回合提交为 failed，不重新执行工具。关闭时停止受理并等待任务，随后关闭检查点和数据库池。默认模型阶段限时 60 秒，数据库命令有独立超时；容器入口以 exec 把终止信号交给 Uvicorn；Uvicorn 关闭宽限 75 秒、Compose 90 秒。持久化失败会记录错误，遗留回合由清理服务收尾。

## 事务和回合不变量

受理事务锁定用户与存档，先检查 request_id 和原 payload，再检查新回合额度、并发及版本。相同终态请求重放已有结果，不再调用模型或累计执行用量；不同 payload 复用 ID 返回冲突。只允许一个 running 回合，数据库部分唯一索引提供最后一道约束。

模型调用不持有业务事务。工具在独立短事务中复核回合状态、角色权限，并按操作标识去重。成功提交的事实不可因后续模型失败而回滚。成功、失败、超时及重启恢复均调用 `finish_turn`，只有 running 可以变为终态；重复收尾返回已存终态。对白只有完整完成并提交后才发送，失败不保存半段对白。

存储边界验证 `state_schema_version=1` 和 `GameState`。迁移 0003 只增加字段、约束和索引，不重写状态、原始回合 payload、事件或检查点标识。旧结果的 retryable 缺省为 false，旧用量缺省由 `TurnUsage` 明确补齐；这些默认值只影响读取，不改变幂等比较数据。事件按 `(created_at, id)` 稳定排序。

## 公共协议与故事

`GET /api/saves/{id}/play-state` 在同一 REPEATABLE READ、READ ONLY 事务返回 `{save, events, active_turn}`。active_turn 包含内部回合 ID 和 request_id，用于跨设备发现处理中回合。原有存档、事件、结果查询接口保留。

回合状态只有 running、completed、failed。SSE 保留三种事件：status 的数据为 `StatusEvent`，dialogue 为 `DialogueEvent`，done 为 `TurnResult`；全部记录在 OpenAPI components，done 只能是 completed 或 failed。终态 HTTP 查询和 SSE 都补齐旧结果默认字段。

`app/story.json` 是唯一故事展示定义：幕次、场景、角色、默认对白、幕间及行动按钮。Pydantic 校验结构、角色引用和资源路径，测试核实实际资源文件。内部 `StoryDefinition` 含 persona，公开 `StoryOut` 逐字段投影，不直接展开内部对象。前端测试故事文件由公开投影生成，禁止手工维护第二份内容。剧情数值仍由 Python 裁决。

## 前端恢复

首页和存档入口在 `features/Home.tsx`；游戏按 Play、GameStage、Conversation、GameDrawer 拆分。React Query 管理服务端数据，UI 状态随 user/save 挂载隔离，组件通过数据和回调协作。

`useTurnController` 统一提交、订阅与恢复。请求先保存到带版本的 sessionStorage 记录，含用户、存档、原 request_id、完整 payload；存储异常退化为内存。离开页面只取消订阅，异步结果必须通过生命周期 signal 校验后才能更新缓存。

网络中断、5xx、非法或截断 SSE 保留 pending；明确未受理的业务错误清除 pending。恢复先查原 ID，以 1、2、4、5 秒间隔轮询，累计 90 秒后暂停，保留手动及网络恢复入口。只有明确 turn_not_found 且存在完整原请求时，自动重发一次相同 ID 和 payload。旧版仅含 ID 的记录只查询，不自动重发。失败终态需玩家主动继续。

SSE 解码支持 UTF-8 跨块、LF/CRLF、多行 data，并在进入状态机前验证终态结构。业务页面调用具体 `gameApi` 方法，类型来自 OpenAPI 生成文件。

## 工程命令

`make contract-generate` 显式生成 OpenAPI、TypeScript 和公开故事测试数据；`make contract` 在临时目录生成后比较，不修改工作区。`make deps-update` 更新锁；`make lock-check` 只检查。`make migrate` 应用迁移，`make migrate-check` 只读检查模型漂移。

保留已有 Miniconda 和固定 pnpm，不创建虚拟环境。覆盖率阈值继续保留，不能通过排除迁移后的模块降低门槛。验收结果见 [验证记录](verification.md)，运行与恢复见 [运维](operations.md)。

## 错误契约与恢复补强

HTTP 错误目录、结构化回合失败、订阅错误事件和客户端等待预算见 [接口错误与回合恢复契约](error-handling.md)。字段校验与响应校验均在边界执行；未知结果不能触发新的业务行动。存档列表缓存按用户隔离，会话失效暂停恢复；终态后的缓存刷新失败不会重新提交。
