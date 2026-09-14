import hashlib
import logging
import secrets
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from . import zhihu_oauth
from .db import LoginSession, OAuthBinding, ProductEvent, User, new_id, utcnow
from .errors import (
    AUTH_RESPONSES,
    BODY_RESPONSES,
    ERROR_RESPONSES,
    MUTATION_RESPONSES,
    ApiError,
    codes,
    envelope_response,
)
from .product import process_bindings, rate_limit
from .runtime import Runtime, runtime_for
from .schemas import DevLogin, LogoutOut, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger("btl.auth")


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
    if (
        not user
        or user.merged_into
        or (
            user.identity_type == "guest"
            and (not user.guest_expires_at or user.guest_expires_at <= utcnow())
        )
    ):
        raise ApiError(401, "not_authenticated")
    return user


async def issue_session(
    subject: str, name: str, response: Response, runtime: Runtime
) -> dict[str, Any]:
    token = secrets.token_urlsafe(32)
    async with runtime.sessions.begin() as db:
        await db.execute(
            insert(User)
            .values(id=new_id(), subject=subject, name=name[:100])
            .on_conflict_do_nothing(index_elements=["subject"])
        )
        user = await db.scalar(select(User).where(User.subject == subject))
        if user is None:
            raise ApiError(401, "not_authenticated")
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
    return {"id": user.id, "name": user.name, "can_play": can_play(user, runtime)}


def can_play(user: User, runtime: Runtime) -> bool:
    return runtime.settings.environment != "production" or (
        user.identity_type == "member" and user.subject.startswith("zhihu:")
    )


async def current_player(request: Request, user: User = Depends(current_user)) -> User:
    # Identity lookup stays available to OAuth so a restricted guest can still bind saves.
    if not can_play(user, runtime_for(request)):
        raise ApiError(403, "zhihu_login_required")
    return user


@router.post(
    "/dev",
    response_model=UserOut,
    # FastAPI documents this route's 422 on its own, in its HTTPValidationError
    # shape; it is restated here so the contract shows the envelope the server
    # actually sends. The 404 is also a real response: in production this path is
    # routed and answered, not absent.
    responses={
        **MUTATION_RESPONSES,
        **BODY_RESPONSES,
        422: envelope_response(codes(422, "validation_failed")),
        404: envelope_response(codes(404, "not_found")),
    },
)
async def dev_login(body: DevLogin, request: Request, response: Response) -> dict[str, Any]:
    runtime = runtime_for(request)
    if runtime.settings.environment == "production" or not runtime.settings.dev_login_enabled:
        raise ApiError(404, "not_found")
    # A fresh random identity per browser login, never a guessable name-as-password.
    return await issue_session(f"dev:{new_id()}", body.name, response, runtime)


@router.get("/me", response_model=UserOut, responses=AUTH_RESPONSES)
async def me(request: Request, user: User = Depends(current_user)) -> dict[str, Any]:
    runtime = runtime_for(request)
    await process_bindings(runtime.sessions)
    async with runtime.sessions() as db:
        pending = await db.scalar(
            select(OAuthBinding.state_hash)
            .where(OAuthBinding.member_id == user.id, OAuthBinding.status == "waiting")
            .limit(1)
        )
    return {
        "id": user.id,
        "name": user.name,
        "identity_type": user.identity_type,
        "can_play": can_play(user, runtime),
        "guest_expires_at": user.guest_expires_at,
        "binding_pending": bool(pending),
    }


@router.post("/logout", response_model=LogoutOut, responses=MUTATION_RESPONSES)
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
        raise ApiError(503, "oauth_not_configured")
    state = secrets.token_urlsafe(32)
    try:
        user = await current_user(request)
    except ApiError:
        user = None
    if user and user.identity_type == "guest":
        async with runtime.sessions.begin() as db:
            db.add(
                OAuthBinding(
                    state_hash=digest(state),
                    guest_id=user.id,
                    expires_at=utcnow() + timedelta(minutes=10),
                )
            )
    # authlib ships no stubs, so this await is Any; it resolves to a RedirectResponse.
    if runtime.settings.zhihu_protocol == "hackathon":
        return zhihu_oauth.authorize(request, runtime.settings, state)
    redirect: RedirectResponse = await runtime.oauth.zhihu.authorize_redirect(
        request,
        runtime.settings.public_origin.rstrip("/") + "/api/auth/zhihu/callback",
        state=state,
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
        raise ApiError(503, "oauth_not_configured")
    try:
        if runtime.settings.zhihu_protocol == "hackathon":
            code = zhihu_oauth.consume_code(request)
            profile = await zhihu_oauth.exchange(runtime.settings, code)
        else:
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
        raise ApiError(400, "oauth_failed") from None
    response = RedirectResponse("/", status_code=303)
    member = await issue_session(
        f"zhihu:{subject}",
        str(profile.get(runtime.settings.zhihu_name_field, "玩家")),
        response,
        runtime,
    )
    async with runtime.sessions.begin() as db:
        binding = await db.scalar(
            select(OAuthBinding)
            .where(OAuthBinding.state_hash == digest(request.query_params.get("state", "")))
            .with_for_update()
        )
        if binding and binding.status == "pending" and binding.expires_at > utcnow():
            binding.member_id = member["id"]
            binding.status = "waiting"
    await process_bindings(runtime.sessions)
    request.session.clear()
    return response


@router.post(
    "/guest",
    response_model=UserOut,
    responses={**MUTATION_RESPONSES, 404: envelope_response(codes(404, "not_found"))},
)
async def guest_login(request: Request, response: Response) -> dict[str, Any]:
    runtime = runtime_for(request)
    if not runtime.settings.guest_login_enabled:
        raise ApiError(404, "not_found")
    try:
        user = await current_user(request)
        return {
            "id": user.id,
            "name": user.name,
            "identity_type": user.identity_type,
            "can_play": can_play(user, runtime),
            "guest_expires_at": user.guest_expires_at,
        }
    except ApiError:
        pass
    subject = "guest:" + new_id()
    async with runtime.sessions.begin() as db:
        # Only the direct peer is trusted. A proxy must also apply its own IP limiter.
        address = request.client.host if request.client else "unknown"
        await rate_limit(db, "guest:" + digest(runtime.settings.session_secret + address), 5, 3600)
        user = User(
            subject=subject,
            name="试玩者",
            identity_type="guest",
            guest_expires_at=utcnow() + timedelta(days=runtime.settings.guest_days),
        )
        db.add(user)
        await db.flush()
        db.add(ProductEvent(user_id=user.id, name="trial_started", data={}))
    result = await issue_session(subject, "试玩者", response, runtime)
    return {
        **result,
        "identity_type": "guest",
        "guest_expires_at": user.guest_expires_at,
    }
