"""Translate adapter exceptions by type, never by provider exception text."""

import asyncio

import httpx
from openai import APIConnectionError, APIStatusError, APITimeoutError

from .error_catalog import FailureCode


class EmptyReplyError(RuntimeError):
    pass


def classify_failure(exc: BaseException) -> FailureCode:
    if isinstance(exc, (TimeoutError, APITimeoutError, httpx.TimeoutException)):
        return FailureCode.TIMEOUT
    if isinstance(
        exc, (APIConnectionError, APIStatusError, httpx.TransportError, httpx.HTTPStatusError)
    ):
        return FailureCode.MODEL
    if isinstance(exc, EmptyReplyError):
        return FailureCode.EMPTY
    if isinstance(exc, asyncio.CancelledError):
        return FailureCode.INTERRUPTED
    return FailureCode.UNKNOWN
