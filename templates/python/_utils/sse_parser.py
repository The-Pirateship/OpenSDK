import json
from collections.abc import AsyncIterator, Iterator
from typing import Any

from .exceptions import SSEParseError

_DATA_PREFIX = "data:"


def parse_sse_line_stream(lines: Iterator[str]) -> Iterator[dict[str, Any]]:
    for line in lines:
        line = line.strip()

        if not line or line.startswith(":"):
            continue

        if line.startswith("data:"):
            data_str = line[len(_DATA_PREFIX) :].strip()

            try:
                event_data = json.loads(data_str)
                yield event_data
            except json.JSONDecodeError as e:
                raise SSEParseError(f"Malformed JSON in SSE event: {e}", line=line) from e


async def async_parse_sse_line_stream(lines: AsyncIterator[str]) -> AsyncIterator[dict[str, Any]]:
    async for line in lines:
        line = line.strip()

        if not line or line.startswith(":"):
            continue

        if line.startswith("data:"):
            data_str = line[len(_DATA_PREFIX) :].strip()

            try:
                event_data = json.loads(data_str)
                yield event_data
            except json.JSONDecodeError as e:
                raise SSEParseError(f"Malformed JSON in SSE event: {e}", line=line) from e
