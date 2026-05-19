from __future__ import annotations

import httpx


class SDKError(Exception):
    pass


class SSEParseError(SDKError):
    def __init__(self, message: str, *, line: str) -> None:
        super().__init__(message)
        self.line = line

    def __repr__(self) -> str:
        return f"SSEParseError(message={str(self)!r}, line={self.line!r})"


class APIError(SDKError):
    def __init__(
        self,
        message: str,
        *,
        request: httpx.Request | None = None,
        response: httpx.Response | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.request = request
        self.response = response


class APIConnectionError(APIError):
    pass


class APITimeoutError(APIConnectionError):
    pass


class APIStatusError(APIError):
    def __init__(
        self,
        message: str,
        *,
        response: httpx.Response,
        status_code: int,
        request: httpx.Request | None = None,
    ) -> None:
        super().__init__(message, request=request, response=response)
        self.status_code = status_code

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(status_code={self.status_code}, message={self.message!r})"


class BadRequestError(APIStatusError):
    def __init__(self, message: str, *, response: httpx.Response, request: httpx.Request | None = None) -> None:
        super().__init__(message, response=response, status_code=400, request=request)


class AuthenticationError(APIStatusError):
    def __init__(self, message: str, *, response: httpx.Response, request: httpx.Request | None = None) -> None:
        super().__init__(message, response=response, status_code=401, request=request)


class PermissionDeniedError(APIStatusError):
    def __init__(self, message: str, *, response: httpx.Response, request: httpx.Request | None = None) -> None:
        super().__init__(message, response=response, status_code=403, request=request)


class NotFoundError(APIStatusError):
    def __init__(self, message: str, *, response: httpx.Response, request: httpx.Request | None = None) -> None:
        super().__init__(message, response=response, status_code=404, request=request)


class RequestTimeoutError(APIStatusError):
    def __init__(self, message: str, *, response: httpx.Response, request: httpx.Request | None = None) -> None:
        super().__init__(message, response=response, status_code=408, request=request)


class ConflictError(APIStatusError):
    def __init__(self, message: str, *, response: httpx.Response, request: httpx.Request | None = None) -> None:
        super().__init__(message, response=response, status_code=409, request=request)


class UnprocessableEntityError(APIStatusError):
    def __init__(self, message: str, *, response: httpx.Response, request: httpx.Request | None = None) -> None:
        super().__init__(message, response=response, status_code=422, request=request)


class RateLimitError(APIStatusError):
    def __init__(self, message: str, *, response: httpx.Response, request: httpx.Request | None = None) -> None:
        super().__init__(message, response=response, status_code=429, request=request)


class InternalServerError(APIStatusError):
    def __init__(self, message: str, *, response: httpx.Response, request: httpx.Request | None = None) -> None:
        super().__init__(message, response=response, status_code=response.status_code, request=request)
