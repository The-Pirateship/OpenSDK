from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any, Self, TypeVar

import httpx
from pydantic import BaseModel
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from ..exceptions import (
    APIConnectionError,
    APITimeoutError,
    InternalServerError,
    RateLimitError,
    RequestTimeoutError,
)
from ._base import _DEFAULT_MAX_RETRIES, _DEFAULT_TIMEOUT, _RETRY_MAX_WAIT, _RETRY_MULTIPLIER, _BaseClient

ResponseT = TypeVar("ResponseT", bound=BaseModel)


class BaseAsyncAPIClient(_BaseClient):
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        timeout: float = _DEFAULT_TIMEOUT,
        max_retries: int = _DEFAULT_MAX_RETRIES,
    ) -> None:
        super().__init__(api_key=api_key, base_url=base_url, max_retries=max_retries)

        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=timeout,
            headers=self._build_default_headers(),
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> httpx.Response:
        max_attempts = self._max_retries + 1

        @retry(
            stop=stop_after_attempt(max_attempts),
            wait=wait_exponential(multiplier=_RETRY_MULTIPLIER, max=_RETRY_MAX_WAIT),
            retry=retry_if_exception_type(
                (
                    RequestTimeoutError,
                    RateLimitError,
                    InternalServerError,
                    httpx.RequestError,
                )
            ),
            reraise=True,
        )
        async def _execute() -> httpx.Response:
            response = await self._client.request(
                method=method,
                url=path,
                json=json,
                params=params,
            )
            if response.is_error:
                raise self._make_status_error(response)
            return response

        try:
            return await _execute()
        except httpx.TimeoutException as e:
            raise APITimeoutError(str(e), request=e.request) from e
        except httpx.RequestError as e:
            raise APIConnectionError(str(e), request=e.request) from e

    async def _get(
        self,
        path: str,
        *,
        cast_to: type[ResponseT],
        params: dict[str, Any] | None = None,
    ) -> ResponseT:
        response = await self._request("GET", path, params=params)
        return self._parse_response(response, cast_to)

    async def _post(
        self,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        cast_to: type[ResponseT],
    ) -> ResponseT:
        response = await self._request("POST", path, json=json)
        return self._parse_response(response, cast_to)

    async def _put(
        self,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        cast_to: type[ResponseT],
    ) -> ResponseT:
        response = await self._request("PUT", path, json=json)
        return self._parse_response(response, cast_to)

    async def _patch(
        self,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        cast_to: type[ResponseT],
    ) -> ResponseT:
        response = await self._request("PATCH", path, json=json)
        return self._parse_response(response, cast_to)

    async def _delete(
        self,
        path: str,
        *,
        cast_to: type[ResponseT],
    ) -> ResponseT:
        response = await self._request("DELETE", path)
        return self._parse_response(response, cast_to)

    async def _post_stream(
        self,
        path: str,
        *,
        json: dict[str, Any] | None = None,
    ) -> AsyncIterator[str]:
        max_attempts = self._max_retries + 1

        @retry(
            stop=stop_after_attempt(max_attempts),
            wait=wait_exponential(multiplier=_RETRY_MULTIPLIER, max=_RETRY_MAX_WAIT),
            retry=retry_if_exception_type(
                (
                    RequestTimeoutError,
                    RateLimitError,
                    InternalServerError,
                    httpx.RequestError,
                )
            ),
            reraise=True,
        )
        async def _connect() -> httpx.Response:
            response = await self._client.send(
                self._client.build_request("POST", path, json=json),
                stream=True,
            )
            if response.is_error:
                await response.aread()
                await response.aclose()
                raise self._make_status_error(response)
            return response

        try:
            response = await _connect()
        except httpx.TimeoutException as e:
            raise APITimeoutError(str(e), request=e.request) from e
        except httpx.RequestError as e:
            raise APIConnectionError(str(e), request=e.request) from e

        try:
            async for line in response.aiter_lines():
                yield line
        finally:
            await response.aclose()

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()
