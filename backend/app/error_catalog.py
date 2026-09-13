"""Public error vocabulary; HTTP rejection is distinct from turn execution failure."""

from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

Recovery = Literal["retry", "login", "refresh", "edit", "wait", "contact", "recover"]


class ErrorCode(StrEnum):
    OAUTH_FAILED = "oauth_failed"
    REQUEST_BODY_INVALID = "request_body_invalid"
    NOT_AUTHENTICATED = "not_authenticated"
    FORBIDDEN_ORIGIN = "forbidden_origin"
    NOT_FOUND = "not_found"
    SAVE_NOT_FOUND = "save_not_found"
    TURN_NOT_FOUND = "turn_not_found"
    REQUEST_ID_REUSED = "request_id_reused"
    TURN_STILL_RUNNING = "turn_still_running"
    SAVE_BUSY = "save_busy"
    VERSION_CONFLICT = "version_conflict"
    UNSUPPORTED_SAVE_VERSION = "unsupported_save_version"
    JSON_REQUIRED = "json_required"
    VALIDATION_FAILED = "validation_failed"
    EMPTY_MESSAGE = "empty_message"
    RULE_VIOLATION = "rule_violation"
    DAILY_LIMIT_REACHED = "daily_limit_reached"
    CONCURRENCY_BUDGET_EXHAUSTED = "concurrency_budget_exhausted"
    INTERNAL_ERROR = "internal_error"
    OAUTH_NOT_CONFIGURED = "oauth_not_configured"
    MODEL_UNCONFIGURED = "model_unconfigured"
    MONTHLY_COST_CAP_REACHED = "monthly_cost_cap_reached"
    HTTP_404 = "http_404"
    HTTP_405 = "http_405"


@dataclass(frozen=True)
class ErrorDefinition:
    status: int
    message: str
    recovery: Recovery


CATALOG: dict[ErrorCode, ErrorDefinition] = {
    ErrorCode.REQUEST_BODY_INVALID: ErrorDefinition(
        400, "无法解析请求内容，请检查 JSON 格式和编码。", "edit"
    ),
    ErrorCode.OAUTH_FAILED: ErrorDefinition(400, "知乎授权未完成，请重新登录。", "login"),
    ErrorCode.NOT_AUTHENTICATED: ErrorDefinition(401, "请先登录。", "login"),
    ErrorCode.FORBIDDEN_ORIGIN: ErrorDefinition(403, "不允许的请求来源。", "refresh"),
    ErrorCode.NOT_FOUND: ErrorDefinition(404, "接口不存在。", "refresh"),
    ErrorCode.SAVE_NOT_FOUND: ErrorDefinition(404, "存档不存在。", "refresh"),
    ErrorCode.TURN_NOT_FOUND: ErrorDefinition(404, "回合不存在。", "recover"),
    ErrorCode.REQUEST_ID_REUSED: ErrorDefinition(409, "请求编号已用于不同的操作。", "refresh"),
    ErrorCode.TURN_STILL_RUNNING: ErrorDefinition(
        409, "该回合仍在处理，请稍后查询结果。", "recover"
    ),
    ErrorCode.SAVE_BUSY: ErrorDefinition(409, "当前存档已有回合正在处理。", "recover"),
    ErrorCode.VERSION_CONFLICT: ErrorDefinition(409, "进度已变化，请刷新后重试。", "refresh"),
    ErrorCode.UNSUPPORTED_SAVE_VERSION: ErrorDefinition(
        409, "该存档需要更新版本的程序。", "contact"
    ),
    ErrorCode.JSON_REQUIRED: ErrorDefinition(415, "需要 JSON 请求。", "refresh"),
    ErrorCode.VALIDATION_FAILED: ErrorDefinition(422, "请求格式不正确。", "edit"),
    ErrorCode.EMPTY_MESSAGE: ErrorDefinition(422, "请输入要说的话。", "edit"),
    ErrorCode.RULE_VIOLATION: ErrorDefinition(422, "当前进度不允许此操作。", "edit"),
    ErrorCode.DAILY_LIMIT_REACHED: ErrorDefinition(429, "今日回合额度已用完。", "wait"),
    ErrorCode.CONCURRENCY_BUDGET_EXHAUSTED: ErrorDefinition(429, "当前较忙，请稍后重试。", "wait"),
    ErrorCode.INTERNAL_ERROR: ErrorDefinition(500, "服务器内部错误，请稍后重试。", "retry"),
    ErrorCode.OAUTH_NOT_CONFIGURED: ErrorDefinition(503, "知乎登录尚未完成配置。", "contact"),
    ErrorCode.MODEL_UNCONFIGURED: ErrorDefinition(
        503, "对话服务尚未配置，请联系管理员。", "contact"
    ),
    ErrorCode.MONTHLY_COST_CAP_REACHED: ErrorDefinition(
        503, "本月服务额度已用尽，请联系管理员。", "wait"
    ),
    ErrorCode.HTTP_404: ErrorDefinition(404, "接口不存在。", "refresh"),
    ErrorCode.HTTP_405: ErrorDefinition(405, "请求方法不受支持。", "refresh"),
}


class FailureCode(StrEnum):
    TIMEOUT = "turn_timeout"
    BUDGET = "execution_budget_exhausted"
    MODEL = "model_unavailable"
    EMPTY = "empty_reply"
    INTERRUPTED = "turn_interrupted"
    UNKNOWN = "turn_failed"


FAILURES: dict[FailureCode, str] = {
    FailureCode.TIMEOUT: "回复超时。",
    FailureCode.BUDGET: "本回合处理次数已达上限。",
    FailureCode.MODEL: "对话服务暂不可用。",
    FailureCode.EMPTY: "未收到有效回复。",
    FailureCode.INTERRUPTED: "回合已中断。",
    FailureCode.UNKNOWN: "本次回复未完成。",
}


def failure_message(code: FailureCode) -> str:
    return FAILURES[code] + "已保存的行动仍然有效，请刷新进度后继续。"
