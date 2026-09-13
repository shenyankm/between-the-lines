"""Zhihu's app_id/app_key flow. Never accept an uncorrelated callback."""

import logging
import re
import secrets
import time
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import Request
from fastapi.responses import RedirectResponse

from .config import Settings

logger = logging.getLogger("btl.auth")


def response_shape(value: Any, depth: int = 0) -> Any:
    """Diagnostic schema only: never include provider response values."""
    if isinstance(value, dict) and depth < 4:
        return {
            key: response_shape(item, depth + 1)
            for key, item in list(value.items())[:40]
            if isinstance(key, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,40}", key)
        }
    return type(value).__name__


class OAuthStateMissing(ValueError):
    pass


class OAuthStateInvalid(ValueError):
    pass


class OAuthIdentityMissing(ValueError):
    pass


class OAuthProfileRejected(ValueError):
    pass


def callback_url(settings: Settings) -> str:
    return settings.public_origin.rstrip("/") + "/api/auth/zhihu/callback"


def authorize(request: Request, settings: Settings, state: str) -> RedirectResponse:
    request.session["zhihu_hackathon"] = {"state": state, "issued_at": time.time()}
    query = urlencode(
        {
            "app_id": settings.zhihu_client_id,
            "redirect_uri": callback_url(settings),
            "response_type": "code",
            "state": state,
        }
    )
    return RedirectResponse(settings.zhihu_authorize_url + "?" + query)


def consume_code(request: Request) -> str:
    pending = request.session.pop("zhihu_hackathon", None)
    states = request.query_params.getlist("state")
    if not states:
        raise OAuthStateMissing("Provider must return state")
    if (
        len(states) != 1
        or not isinstance(pending, dict)
        or not isinstance(pending.get("state"), str)
        or not secrets.compare_digest(states[0], pending["state"])
        or not isinstance(pending.get("issued_at"), (int, float))
        or not 0 <= time.time() - pending["issued_at"] <= 600
    ):
        raise OAuthStateInvalid("Invalid or expired login request")
    if request.query_params.get("error"):
        raise ValueError("Authorization declined")
    codes = request.query_params.getlist("authorization_code")
    legacy = request.query_params.getlist("code")
    if len(codes) > 1 or len(legacy) > 1 or (codes and legacy and codes != legacy):
        raise ValueError("Ambiguous authorization code")
    code = (codes or legacy or [""])[0]
    if not code or len(code) > 4096:
        raise ValueError("Missing authorization code")
    return code


def unwrap(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Invalid provider response")
    for key in ("data", "Data", "user"):
        if isinstance(payload.get(key), dict):
            return dict(payload[key])
    return dict(payload)


async def exchange(settings: Settings, code: str) -> dict[str, Any]:
    # Redirects are deliberately disabled: neither app_key nor the two user
    # credentials may be forwarded to another endpoint by an upstream redirect.
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
        response = await client.post(
            settings.zhihu_token_url,
            data={
                "app_id": settings.zhihu_client_id,
                "app_key": settings.zhihu_client_secret,
                "grant_type": "authorization_code",
                "redirect_uri": callback_url(settings),
                "code": code,
            },
        )
        response.raise_for_status()
        token = unwrap(response.json()).get("access_token")
        if not isinstance(token, str) or not token or len(token) > 8192:
            raise ValueError("Missing access token")
        response = await client.get(
            settings.zhihu_userinfo_url,
            headers={
                # Native /user uses OAuth Bearer. Access Secret + X-OAuth-Token
                # belongs to the separate developer content APIs.
                "Authorization": "Bearer " + token,
                "X-Request-Timestamp": str(int(time.time())),
            },
        )
        response.raise_for_status()
        payload = response.json()
        provider_code = (
            payload.get("code", payload.get("Code")) if isinstance(payload, dict) else None
        )
        if provider_code is not None and provider_code not in (0, 20000):
            logger.warning(
                "oauth_profile_rejected",
                extra={
                    "fields": {
                        "provider_code": provider_code if isinstance(provider_code, int) else None
                    }
                },
            )
            raise OAuthProfileRejected("Provider rejected the user information request")
        profile = unwrap(payload)
        subject = profile.get(settings.zhihu_subject_field)
        # No nickname, content author, or Access Secret owner fallback. The
        # configured identity field must be returned by the authorized user API.
        if isinstance(subject, bool) or not isinstance(subject, (str, int)) or not str(subject):
            logger.warning(
                "oauth_identity_schema",
                extra={
                    "fields": {
                        "profile_shape": response_shape(payload),
                        "provider_code": provider_code if isinstance(provider_code, int) else None,
                    }
                },
            )
            raise OAuthIdentityMissing("Provider did not return the configured identity field")
        return profile
