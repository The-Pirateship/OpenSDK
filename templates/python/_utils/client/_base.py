from __future__ import annotations

import os
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel

from ..exceptions import (
    APIStatusError,
    AuthenticationError,
    BadRequestError,
    ConflictError,
    InternalServerError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
    RequestTimeoutError,
    UnprocessableEntityError,
)

ResponseT = TypeVar("ResponseT", bound=BaseModel)

_DEFAULT_TIMEOUT: float = 600.0
_DEFAULT_MAX_RETRIES: int = 2
_RETRY_MULTIPLIER: float = 0.5
_RETRY_MAX_WAIT: float = 8.0


class _BaseClient:
    def __init__(
        self,
        *,
        api_key: str | None,
        base_url: str,
        max_retries: int = _DEFAULT_MAX_RETRIES,
    ) -> None:
        resolved_key = api_key or os.environ.get("{{ENV_VAR_NAME}}")
        if not resolved_key:
            raise ValueError(
                "No API key provided. Pass api_key= to the client or set the {{ENV_VAR_NAME}} environment variable."
            )

        self._api_key = resolved_key
        self._base_url = base_url
        self._max_retries = max_retries

    def __repr__(self) -> str:
        masked = f"{self._api_key[:8]}****" if len(self._api_key) > 8 else "****"
        return f"{self.__class__.__name__}(base_url={self._base_url!r}, api_key={masked!r})"

    def _build_default_headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "{{AUTH_HEADER}}": self._api_key,
            "User-Agent": "{{PACKAGE_NAME}}/1.0.0",
        }

    def _make_status_error(self, response: httpx.Response) -> APIStatusError:
        error_map: dict[int, type[APIStatusError]] = {
            400: BadRequestError,
            401: AuthenticationError,
            403: PermissionDeniedError,
            404: NotFoundError,
            408: RequestTimeoutError,
            409: ConflictError,
            422: UnprocessableEntityError,
            429: RateLimitError,
        }

        if response.is_server_error:
            error_class = InternalServerError
        else:
            error_class = error_map.get(response.status_code, APIStatusError)

        try:
            error_data = response.json()
            message = error_data.get("error", {}).get("message", response.text)
        except Exception:
            message = response.text or f"HTTP {response.status_code}"

        if error_class is APIStatusError:
            return error_class(message=message, response=response, status_code=response.status_code)
        return error_class(message=message, response=response)

    def _parse_response(
        self,
        response: httpx.Response,
        cast_to: type[ResponseT],
    ) -> ResponseT:
        return cast_to.model_validate(response.json())
