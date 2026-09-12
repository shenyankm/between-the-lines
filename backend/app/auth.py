import hashlib
import logging
import secrets
from datetime import timedelta

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from .config import get_settings
from .db import LoginSession, Session, User, new_id, utcnow
from .schemas import DevLogin, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()
oauth = OAuth()  # type: ignore[no-untyped-call]  # authlib ships no stubs
if settings.oauth_ready:
    oauth.register(  # type: ignore[no-untyped-call]  # authlib ships no stubs
        "zhihu",
        client_id=settings.zhihu_client_id,
        client_secret=settings.zhihu_client_secret,
        authorize_url=settings.zhihu_authorize_url,
        access_token_url=settings.zhihu_token_url,
        client_kwargs={"scope": settings.zhihu_scope},
    )


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


async def current_user(request: Request) -> User:
    token = request.cookies.get("btl_session", "")
    async with Session() as db:
        user = await db.scalar(
            select(User)
            .join(LoginSession)
            .where(LoginSession.token_hash == digest(token), LoginSession.expires_at > utcnow())
        )
    if not user:
        raise HTTPException(401, "请先登录。")
    return user


async def issue_session(subject: str, name: str, response: Response) -> dict[str, str]:
    token = secrets.token_urlsafe(32)
    async with Session.begin() as db:
        await db.execute(
            insert(User)
            .values(id=new_id(), subject=subject, name=name[:100])
            .on_conflict_do_nothing(index_elements=["subject"])
        )
        user = await db.scalar(select(User).where(User.subject == subject))
        if user is None:
            raise HTTPException(401, "请先登录。")
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
        secure=settings.environment == "production",
        max_age=604800,
        path="/",
    )
    return {"id": user.id, "name": user.name}


@router.post("/dev", response_model=UserOut)
async def dev_login(body: DevLogin, request: Request, response: Response) -> dict[str, str]:
    if settings.environment == "production" or not settings.dev_login_enabled:
        raise HTTPException(404)
    # A fresh random identity per browser login, never a guessable name-as-password.
    return await issue_session(f"dev:{new_id()}", body.name, response)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)) -> dict[str, str]:
    return {"id": user.id, "name": user.name}


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict[str, bool]:
    async with Session.begin() as db:
        await db.execute(
            delete(LoginSession).where(
                LoginSession.token_hash == digest(request.cookies.get("btl_session", ""))
            )
        )
    response.delete_cookie("btl_session", path="/")
    return {"ok": True}


@router.get("/zhihu")
async def zhihu_login(request: Request) -> RedirectResponse:
    if not settings.oauth_ready:
        raise HTTPException(503, "知乎登录尚未完成配置。")
    # authlib ships no stubs, so this await is Any; it resolves to a RedirectResponse.
    redirect: RedirectResponse = await oauth.zhihu.authorize_redirect(
        request, settings.public_origin.rstrip("/") + "/api/auth/zhihu/callback"
    )
    return redirect


@router.get("/zhihu/callback")
async def zhihu_callback(request: Request) -> RedirectResponse:
    if not settings.oauth_ready:
        raise HTTPException(503, "知乎登录尚未完成配置。")
    try:
        token = await oauth.zhihu.authorize_access_token(request)
        reply = await oauth.zhihu.get(settings.zhihu_userinfo_url, token=token)
        reply.raise_for_status()
        profile = reply.json()
        subject = profile[settings.zhihu_subject_field]
        if not isinstance(subject, (str, int)) or not str(subject):
            raise ValueError("Missing identity")
    except Exception as exc:
        logging.getLogger("btl.auth").warning("oauth_failed kind=%s", type(exc).__name__)
        raise HTTPException(400, "知乎授权未完成，请重新登录。") from None
    response = RedirectResponse("/", status_code=303)
    await issue_session(
        f"zhihu:{subject}", str(profile.get(settings.zhihu_name_field, "玩家")), response
    )
    request.session.clear()
    return response
