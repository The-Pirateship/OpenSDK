from .client import BaseAsyncAPIClient, BaseSyncAPIClient


class BaseSyncAPIResource:
    def __init__(self, client: BaseSyncAPIClient) -> None:
        self._client = client
        self._get = client._get
        self._post = client._post
        self._put = client._put
        self._patch = client._patch
        self._delete = client._delete
        self._post_stream = client._post_stream


class BaseAsyncAPIResource:
    def __init__(self, client: BaseAsyncAPIClient) -> None:
        self._client = client
        self._get = client._get
        self._post = client._post
        self._put = client._put
        self._patch = client._patch
        self._delete = client._delete
        self._post_stream = client._post_stream
