# 接口错误与回合恢复契约

接口路径与原有成功字段保留，前后端同步发布。错误目录由 `backend/app/error_catalog.py` 定义，OpenAPI 导出错误码枚举；页面通过生成类型引用 HTTP 错误码。未知新增响应字段可忽略，未知错误码显示安全提示，不据此推断回合未受理。

## HTTP 错误

除 `/api/ready` 使用独立探针响应外，错误统一为：

```json
{
  "error": {
    "code": "validation_failed",
    "message": "请求格式不正确。",
    "request_id": "服务端请求追踪编号",
    "recovery": "edit",
    "details": [{"field": "body.text", "code": "string_too_long", "message": "文字长度超出限制。"}]
  }
}
```

`code` 是稳定标识，`message` 可调整。`request_id` 与 `X-Request-Id` 一致，和回合提交体中的幂等 `request_id` 是两个概念。校验详情最多 20 项，只返回公开字段路径、校验规则码与固定提示；未知字段名替换为 `unknown`，不回显字段值、异常原文或校验上下文。校验日志使用路由模板及排序后的字段名。

| HTTP | 错误码 | 页面处理 |
|---|---|---|
| 400 | `request_body_invalid` | 检查 JSON 格式和编码，不自动重试 |
| 400 | `oauth_failed` | 重新登录 |
| 401 | `not_authenticated` | 暂停回合查询，保留原用户 pending，重新登录 |
| 403 / 415 | `forbidden_origin` / `json_required` | 提示刷新页面 |
| 404 | `not_found` / `save_not_found` | 返回入口检查资源 |
| 404 | `turn_not_found` | 查询确认缺失；仅完整原请求允许同 ID 自动重放一次 |
| 409 | `request_id_reused` / `version_conflict` | 刷新进度，保留输入，由玩家主动操作 |
| 409 | `turn_still_running` / `save_busy` | 查询原回合或存档当前回合 |
| 409 | `unsupported_save_version` | 联系管理员升级服务 |
| 422 | `validation_failed` / `empty_message` / `rule_violation` | 检查输入或选择其他行动 |
| 429 | `daily_limit_reached` / `concurrency_budget_exhausted` | 等待后再主动提交 |
| 500 | `internal_error` | 结果可能未知，提交路径先查询原回合 |
| 503 | `oauth_not_configured` / `model_unconfigured` | 联系管理员配置 |
| 503 | `monthly_cost_cap_reached` | 显示等待时间，联系管理员 |
| 404 / 405 | `http_404` / `http_405` | 框架路由错误；不能作为回合不存在的证据 |

限额响应携带 `Retry-After` 与 `retry_after_seconds`，服务端输出整数秒。前端也兼容代理的 HTTP 日期格式；两处都有效时使用较长等待时间，不提前请求。错误响应和正常 API 响应均禁止缓存，包含请求追踪信息。

入参使用 UUID 路径参数，版本必须是非负 JSON 整数（拒绝布尔值、浮点数及数字字符串）；请求体拒绝未知字段。登录名去除首尾空白且不能全空白，对白原文及现有动作默认值保留。

## 回合终态与 SSE

`TurnResult.failure` 为可空结构，包含 `code/message/request_id/recovery`。失败种类：

- `turn_timeout`：执行或上游调用超时。
- `execution_budget_exhausted`：模型、工具调用次数或图执行预算耗尽。
- `model_unavailable`：上游连接或 HTTP 调用失败。
- `empty_reply`：未返回有效对白或回顾文字。
- `turn_interrupted`：执行取消、重启或遗留回合恢复。
- `turn_failed`：未分类异常，或旧失败结果没有结构化信息。

分类依据异常类型；不匹配供应商异常文案。失败消息说明已保存的行动仍然有效。`retryable` 保留兼容用途，不授权自动重放已经执行的行动；失败后玩家刷新进度并以新 ID 主动继续。

旧结果在读取时补齐 failure，不改写数据库 JSON、原请求 payload、存档版本或检查点。成功终态不能携带 failure。HTTP 查询和 SSE 使用同一终态模型。

SSE 事件：`status`（状态文字）、`dialogue`（已提交的完整对白）、`done`（已提交终态），以及 `error`（订阅失败，结果未知）。`error` 的 code 固定为 `subscription_failed`，携带回合 ID 和请求追踪编号，恢复方式为 `recover`。落库失败不得伪造 `done`；保留 running，待数据库恢复后由现有清理服务或重启恢复提交终态。

## 客户端恢复预算

- 普通 JSON 请求每次超时 15 秒。GET 网络错误、超时及 502/503/504 最多重试两次，默认等待 1、2 秒；累计自动等待上限 15 秒，超过上限返回页面处理。写请求不自动重试。
- SSE 空闲 90 秒取消订阅。收到数据重置空闲计时，主动取消不显示错误，也不取消后台回合。
- 回合恢复独立采用 1、2、4、5 秒间隔，不嵌套 GET 重试。订阅结束后开始新的 90 秒恢复窗口；有效 Retry-After 延后查询，超过窗口则保留手动恢复入口。
- 网络故障、代理错误、非法响应、SSE 截断及订阅错误均保留 pending。只有明确业务未受理错误才清除；旧记录也必须收到 `turn_not_found` 才能按不存在清除。
- pending 按用户和存档隔离。合法 UUID 配合损坏的 payload 时退化为仅查询；不合法的请求编号直接丢弃，避免无法恢复的记录锁住页面。不会用损坏 payload 重放请求。仅有旧 ID 的记录不自动重放。
- 终态已确认后先清 pending，再刷新缓存；刷新失败独立提示，不重新提交。跨用户/存档切换与卸载后的迟到结果不会更新新页面。

错误提示含本地操作入口及可展开复制的错误码、请求编号。退出失败保留页面和身份；取消操作不显示故障。现有无外部传输的 reporting 设置保留。

## 验证与发布

新增前后端故障注入、运行时响应校验及恢复测试，覆盖真实数据库下的持久化失败。浏览器测试的全局准备阶段先读取 `/api/config`，只有确认 `agent_mode=mock` 才执行写操作，避免误用占用默认端口的真实服务。

无需数据库结构迁移；同步部署后端、前端及生成契约。可用 `make contract-generate` 更新生成产物，再用 `make contract` 检查漂移。测试结果及本轮验证边界见 [验证记录](verification.md)。
