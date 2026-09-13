import hashlib
import logging
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from .db import LoginSession, User, new_id, utcnow
from .errors import (
    AUTH_MESSAGE,
    AUTH_RESPONSES,
    ERROR_RESPONSES,
    MUTATION_RESPONSES,
    ApiError,
    codes,
    envelope_response,
)
from .runtime import Runtime, runtime_for
from .schemas import DevLogin, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger("btl.auth")
OAUTH_NOT_READY_MESSAGE = "知乎登录尚未完成配置。"


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


async def current_user(request: Request) -> User:
    runtime = runtime_for(request)
    token = request.cookies.get("btl_session", "")
    async with runtime.sessions() as db:
        user = await db.scalar(
            select(User)
            .join(LoginSession)
            .where(LoginSession.token_hash == digest(token), LoginSession.expires_at > utcnow())
        )
    if not user:
        raise ApiError(401, "not_authenticated", AUTH_MESSAGE)
    return user


async def issue_session(
    subject: str, name: str, response: Response, runtime: Runtime
) -> dict[str, str]:
    token = secrets.token_urlsafe(32)
    async with runtime.sessions.begin() as db:
        await db.execute(
            insert(User)
            .values(id=new_id(), subject=subject, name=name[:100])
            .on_conflict_do_nothing(index_elements=["subject"])
        )
        user = await db.scalar(select(User).where(User.subject == subject))
        if user is None:
            raise ApiError(401, "not_authenticated", AUTH_MESSAGE)
        db.add(
            LoginSession(
                token_hash=digest(token), user_id=user.id, expires_at=utcnow() + timedelta(days=7)
            )
        )
    response.set_cookie(
        "btl_session",
        token,
        httponly=True,
        samesite="lax",
        secure=runtime.settings.environment == "production",
        max_age=604800,
        path="/",
    )
    return {"id": user.id, "name": user.name}


@router.post(
    "/dev",
    response_model=UserOut,
    # FastAPI documents this route's 422 on its own, in its HTTPValidationError
    # shape; it is restated here so the contract shows the envelope the server
    # actually sends. The 404 is also a real response: in production this path is
    # routed and answered, not absent.
    responses={
        **MUTATION_RESPONSES,
        422: envelope_response(codes(422, "validation_failed")),
        404: envelope_response(codes(404, "not_found")),
    },
)
async def dev_login(body: DevLogin, request: Request, response: Response) -> dict[str, str]:
    runtime = runtime_for(request)
    if runtime.settings.environment == "production" or not runtime.settings.dev_login_enabled:
        raise ApiError(404, "not_found", "接口不存在。")
    # A fresh random identity per browser login, never a guessable name-as-password.
    return await issue_session(f"dev:{new_id()}", body.name, response, runtime)


@router.get("/me", response_model=UserOut, responses=AUTH_RESPONSES)
async def me(user: User = Depends(current_user)) -> dict[str, str]:
    return {"id": user.id, "name": user.name}


@router.post("/logout", responses=MUTATION_RESPONSES)
async def logout(request: Request, response: Response) -> dict[str, bool]:
    runtime = runtime_for(request)
    async with runtime.sessions.begin() as db:
        await db.execute(
            delete(LoginSession).where(
                LoginSession.token_hash == digest(request.cookies.get("btl_session", ""))
            )
        )
    response.delete_cookie("btl_session", path="/")
    return {"ok": True}


@router.get(
    "/zhihu",
    # Both OAuth routes are followed by a browser rather than called by code, but
    # the envelope is still what the server answers with, so it is still what the
    # contract has to say.
    responses={503: envelope_response(codes(503, "oauth_not_configured")), **ERROR_RESPONSES},
)
async def zhihu_login(request: Request) -> RedirectResponse:
    runtime = runtime_for(request)
    if not runtime.settings.oauth_ready:
        raise ApiError(503, "oauth_not_configured", OAUTH_NOT_READY_MESSAGE)
    # authlib ships no stubs, so this await is Any; it resolves to a RedirectResponse.
    redirect: RedirectResponse = await runtime.oauth.zhihu.authorize_redirect(
        request, runtime.settings.public_origin.rstrip("/") + "/api/auth/zhihu/callback"
    )
    return redirect


@router.get(
    "/zhihu/callback",
    responses={
        400: envelope_response(codes(400, "oauth_failed")),
        503: envelope_response(codes(503, "oauth_not_configured")),
        **ERROR_RESPONSES,
    },
)
async def zhihu_callback(request: Request) -> RedirectResponse:
    runtime = runtime_for(request)
    if not runtime.settings.oauth_ready:
        raise ApiError(503, "oauth_not_configured", OAUTH_NOT_READY_MESSAGE)
    try:
        token = await runtime.oauth.zhihu.authorize_access_token(request)
        reply = await runtime.oauth.zhihu.get(runtime.settings.zhihu_userinfo_url, token=token)
        reply.raise_for_status()
        profile = reply.json()
        subject = profile[runtime.settings.zhihu_subject_field]
        if not isinstance(subject, (str, int)) or not str(subject):
            raise ValueError("Missing identity")
    except Exception as exc:
        # The type name and nothing else. An authlib or upstream OAuth error can
        # carry the authorization code or token it was processing, and both the log
        # and the response body are places a credential must not appear.
        logger.warning("oauth_failed", extra={"fields": {"kind": type(exc).__name__}})
        raise ApiError(400, "oauth_failed", "知乎授权未完成，请重新登录。") from None
    response = RedirectResponse("/", status_code=303)
    await issue_session(
        f"zhihu:{subject}",
        str(profile.get(runtime.settings.zhihu_name_field, "玩家")),
        response,
        runtime,
    )
    request.session.clear()
    return response
