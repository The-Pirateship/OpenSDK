# OpenSDK — Generate a typed SDK from an OpenAPI spec

You are generating a production-quality TypeScript and/or Python SDK from an OpenAPI 3.x specification. The OpenSDK repo provides battle-tested template files for the HTTP client, error handling, retries, and SSE streaming. Your job is to read the spec, copy the templates, and generate the per-API code (types, resources, client class, exports).

## Step 1: Gather preferences and locate the spec

Before anything else, establish:

1. **OpenAPI spec location** — Ask the user for a path or URL. If not provided, auto-detect:
   - Look for files named `openapi.json`, `openapi.yaml`, `swagger.json`, `swagger.yaml` in the project root
   - Check common paths: `docs/`, `api/`, `spec/`
   - If the user has a running server, try fetching `/openapi.json` or `/docs/openapi.json`
   - The spec must be OpenAPI 3.0 or 3.1 (JSON or YAML)
2. **Languages** — TypeScript, Python, or both
3. **Output directory** — where to write the SDK (default: `./sdk/` in their project)
4. **Package name** — auto-detect from the spec title, let the user override

## Step 2: Fetch the OpenSDK templates

Now that you know which language(s), sparse-clone only what's needed:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/The-Pirateship/OpenSDK.git /tmp/opensdk
cd /tmp/opensdk
```

Then checkout the relevant templates:

- **TypeScript only:** `git sparse-checkout set templates/typescript`
- **Python only:** `git sparse-checkout set templates/python`
- **Both:** `git sparse-checkout set templates/typescript templates/python`

The template files are:
- `templates/typescript/_utils/` — BaseClient, errors, resource base class, SSE parser
- `templates/typescript/tsconfig.json` and `tsconfig.build.json`
- `templates/python/_utils/` — Same for Python (sync + async, httpx, Pydantic, tenacity)

## Step 3: Parse the spec and extract metadata

Read the spec and extract these values — you'll use them throughout:

| Field | Source | Example |
|-------|--------|---------|
| `SDK_CLASS_NAME` | `info.title` → PascalCase, remove "API" suffix | `Acme` |
| `PACKAGE_NAME` | Lowercase kebab-case of title | `acme-sdk` |
| `DEFAULT_BASE_URL` | `servers[0].url` | `https://api.acme.com` |
| `ENV_VAR_NAME` | Uppercase snake_case + `_API_KEY` | `ACME_API_KEY` |
| `AUTH_HEADER` | From `securitySchemes` (see auth rules below) | `X-API-Key` |
| `AUTH_SCHEME` | `apikey`, `bearer`, or `none` | `apikey` |
| `DESCRIPTION` | `info.description` | `Acme API client` |
| `VERSION` | `info.version` | `1.0.0` |

### Auth handling

Check `components.securitySchemes` in the spec:

| Spec declares | `AUTH_HEADER` | `AUTH_SCHEME` | Behavior |
|---------------|---------------|---------------|----------|
| `type: apiKey, in: header, name: X-API-Key` | `X-API-Key` | `apikey` | Send the raw key as the header value |
| `type: http, scheme: bearer` | `Authorization` | `bearer` | Prefix the key with `Bearer ` in `_buildHeaders` |
| No `securitySchemes` or empty | _(none)_ | `none` | Make `apiKey` fully optional in the constructor. Do not require it, do not throw if missing, do not send an auth header. Remove the auth header line from `_buildHeaders`. |
| `type: oauth2` or `type: openIdConnect` | _(none)_ | `none` | OAuth2/OIDC flows are out of scope for generated SDKs. Treat the same as "no auth" — the user will handle token management externally and pass a Bearer token via a custom header or middleware. Log a warning during generation that OAuth2 auth was skipped. |

## Step 4: Copy and configure template files

**Note:** all template paths below reference the sparse clone at `/tmp/opensdk/`.

### TypeScript

1. Copy `/tmp/opensdk/templates/typescript/_utils/` → `{output}/src/_utils/`
2. Copy `/tmp/opensdk/templates/typescript/tsconfig.json` → `{output}/tsconfig.json`
3. Copy `/tmp/opensdk/templates/typescript/tsconfig.build.json` → `{output}/tsconfig.build.json`
4. In `_utils/client.ts`, replace all placeholders:
   - `{{DEFAULT_BASE_URL}}` → the extracted base URL
   - `{{ENV_VAR_NAME}}` → the env var name
   - `{{AUTH_HEADER}}` → the auth header name
   - `{{PACKAGE_NAME}}` → the package name
5. Generate `{output}/package.json`:

```json
{
  "name": "{{PACKAGE_NAME}}",
  "version": "{{VERSION}}",
  "description": "{{DESCRIPTION}}",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "p-retry": "^7.1.1",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "typescript": "^5"
  }
}
```

### Python

1. Copy `/tmp/opensdk/templates/python/_utils/` → `{output}/src/{package_underscore}/_utils/`
   (where `package_underscore` is the package name with hyphens replaced by underscores)
2. In `_utils/client/_base.py`, replace all placeholders:
   - `{{ENV_VAR_NAME}}` → the env var name
   - `{{AUTH_HEADER}}` → the auth header name
   - `{{PACKAGE_NAME}}` → the package name
3. Generate `{output}/pyproject.toml`:

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "{{PACKAGE_NAME}}"
version = "{{VERSION}}"
description = "{{DESCRIPTION}}"
requires-python = ">=3.11"
dependencies = [
    "httpx>=0.27.0",
    "pydantic>=2.0.0",
    "tenacity>=8.0.0",
]
```

## Step 5: Generate types

Group the spec's paths by their first tag (or by the first path segment if untagged). Each group becomes a resource folder.

### Organizing operations into resources

For each path in the spec:
- Use the first tag as the resource name (e.g., tag `users` → `users/` folder)
- If no tag, derive from the path — but **skip version prefixes** (`v1`, `v2`, `v3`, `api`) when deriving the name. Example: `/v1/users/{id}` → resource name is `users`, not `v1`. `/api/v2/orders` → `orders`.
- Nested resources: if paths share a prefix with sub-paths (e.g., `/vault/connections` and `/vault/items`), create a parent resource with sub-resource classes

### Converting OpenAPI schemas to Zod (TypeScript)

For each schema in `#/components/schemas` and each inline request/response schema:

| OpenAPI | Zod |
|---------|-----|
| `type: string` | `z.string()` |
| `type: string, format: date-time` | `z.string()` (keep as string, not z.date()) |
| `type: string, format: email` | `z.string().email()` |
| `type: string, format: uuid` | `z.string().uuid()` |
| `type: string, enum: [a, b, c]` | `z.enum(["a", "b", "c"])` |
| `type: integer` | `z.number().int()` |
| `type: number` | `z.number()` |
| `type: boolean` | `z.boolean()` |
| `type: array, items: X` | `z.array(XSchema)` |
| `type: object, properties: {...}` | `z.object({...})` |
| `type: object, additionalProperties: true` | `z.record(z.string(), z.unknown())` |
| `nullable: true` | `.nullable()` |
| `oneOf: [A, B]` | `z.union([ASchema, BSchema])` |
| `allOf: [A, B]` | `ASchema.merge(BSchema)` (for objects) |
| `$ref: '#/components/schemas/Foo'` | Reference `fooSchema` |

For each schema, export both the Zod schema and the inferred type:
```typescript
export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email().optional(),
});
export type User = z.infer<typeof userSchema>;
```

For request params schemas, use `z.strictObject()` to catch typos.
For response schemas, use `z.object()` (lenient, forwards-compatible).

Mark fields as `.optional()` if they are NOT in the schema's `required` array.

### Converting OpenAPI schemas to Pydantic (Python)

| OpenAPI | Pydantic |
|---------|----------|
| `type: string` | `str` |
| `type: string, enum: [a, b, c]` | `Literal["a", "b", "c"]` |
| `type: integer` | `int` |
| `type: number` | `float` |
| `type: boolean` | `bool` |
| `type: array, items: X` | `list[X]` |
| `type: object, properties: {...}` | Nested `BaseModel` |
| `type: object, additionalProperties: true` | `dict[str, Any]` |
| `nullable: true` | `X \| None` |
| `oneOf: [A, B]` | `A \| B` |
| `allOf: [A, B]` | Inherit from both or merge fields |
| `$ref` | Reference the model class |

Optional fields get `= None` default. Required fields have no default.

```python
class User(BaseModel):
    id: str
    name: str
    email: str | None = None
```

### Naming conventions

- Schema names: `camelCase` for Zod variables (e.g., `userSchema`), `PascalCase` for types (e.g., `User`)
- Python: `PascalCase` for model classes, `snake_case` for fields
- Convert between naming styles as needed (OpenAPI often uses camelCase, Python prefers snake_case — use Pydantic's `model_config = ConfigDict(alias_generator=to_camel)` or `Field(alias="camelName")` if the wire format differs from Python convention)

### `$ref` resolution and dependency order

OpenAPI schemas reference each other via `$ref`. You must generate them in the right order:

1. **Build a dependency graph** — for each schema, collect which other schemas it references via `$ref`
2. **Topological sort** — generate schemas that have no dependencies first, then schemas that depend on those, etc.
3. **Circular references** — if two schemas reference each other (e.g., `User` has `posts: Post[]` and `Post` has `author: User`):
   - **TypeScript:** use `z.lazy()` for the back-reference:
     ```typescript
     export const userSchema = z.object({
       id: z.string(),
       posts: z.array(z.lazy(() => postSchema)).optional(),
     });
     ```
   - **Python:** define both models, then call `model_rebuild()` at the bottom of the file:
     ```python
     class User(BaseModel):
         id: str
         posts: list["Post"] | None = None

     class Post(BaseModel):
         id: str
         author: User | None = None

     User.model_rebuild()
     Post.model_rebuild()
     ```
4. **Shared schemas** — schemas used by multiple resources should go in a shared `src/types.ts` or `src/types.py` file, and each resource's types file imports from it

## Step 6: Generate resource classes

For each resource group, create:

### TypeScript: `src/{resource}/index.ts`

```typescript
import { SDKError } from "../_utils/errors.js";
import { APIResource } from "../_utils/resource.js";
import {
  type CreateUserParams,
  type User,
  createUserParamsSchema,
  userSchema,
} from "./types.js";

export class UsersResource extends APIResource {
  // POST /v1/users
  async create(params: CreateUserParams, options: { signal?: AbortSignal } = {}): Promise<User> {
    const parsed = createUserParamsSchema.safeParse(params);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new SDKError(issue?.message ?? "Invalid request");
    }
    const response = await this._client.post("/v1/users", {
      json: parsed.data,
      signal: options.signal,
    });
    return userSchema.parse(response);
  }

  // GET /v1/users/:id
  async get(userId: string): Promise<User> {
    if (typeof userId !== "string" || !userId.trim()) {
      throw new SDKError("userId must be a non-empty string");
    }
    const response = await this._client.get(`/v1/users/${encodeURIComponent(userId)}`);
    return userSchema.parse(response);
  }

  // GET /v1/users (with query params)
  async list(params: ListUsersParams = {}): Promise<UserListResponse> {
    const parsed = listUsersParamsSchema.safeParse(params);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new SDKError(issue?.message ?? "Invalid request");
    }
    const queryParams: Record<string, string | number | boolean> = {};
    if (parsed.data.page !== undefined) queryParams["page"] = parsed.data.page;
    if (parsed.data.limit !== undefined) queryParams["limit"] = parsed.data.limit;

    const response = await this._client.get("/v1/users", {
      params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
    });
    return userListResponseSchema.parse(response);
  }

  // PUT /v1/users/:id (full replacement)
  async update(userId: string, params: UpdateUserParams, options: { signal?: AbortSignal } = {}): Promise<User> {
    if (typeof userId !== "string" || !userId.trim()) {
      throw new SDKError("userId must be a non-empty string");
    }
    const parsed = updateUserParamsSchema.safeParse(params);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new SDKError(issue?.message ?? "Invalid request");
    }
    const response = await this._client.put(`/v1/users/${encodeURIComponent(userId)}`, {
      json: parsed.data,
      signal: options.signal,
    });
    return userSchema.parse(response);
  }

  // PATCH /v1/users/:id (partial update)
  async patch(userId: string, params: PatchUserParams, options: { signal?: AbortSignal } = {}): Promise<User> {
    if (typeof userId !== "string" || !userId.trim()) {
      throw new SDKError("userId must be a non-empty string");
    }
    const parsed = patchUserParamsSchema.safeParse(params);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new SDKError(issue?.message ?? "Invalid request");
    }
    const response = await this._client.patch(`/v1/users/${encodeURIComponent(userId)}`, {
      json: parsed.data,
      signal: options.signal,
    });
    return userSchema.parse(response);
  }

  // DELETE /v1/users/:id
  async remove(userId: string): Promise<void> {
    if (typeof userId !== "string" || !userId.trim()) {
      throw new SDKError("userId must be a non-empty string");
    }
    await this._client.delete(`/v1/users/${encodeURIComponent(userId)}`);
  }
}
```

### Python: `src/{package}/{resource}/__init__.py`

**IMPORTANT: Every Python resource MUST have both a sync and async class.** The sync class extends `BaseSyncAPIResource`, the async class extends `BaseAsyncAPIResource` and is prefixed with `Async`. The async class mirrors every method from the sync class with `async def` and `await`. Never generate one without the other.

**Python request validation:** Unlike TypeScript (which uses Zod `safeParse` on a request schema object), Python resource methods use **typed keyword arguments** directly. Pydantic validates the _response_, not the request. The method signature _is_ the request contract — Python's type checker enforces it at call time.

```python
from __future__ import annotations

from typing import Any

from .._utils.resource import BaseSyncAPIResource, BaseAsyncAPIResource
from .types import User, UserListResponse, DeleteResponse


class UsersResource(BaseSyncAPIResource):
    def create(self, *, name: str, email: str | None = None) -> User:
        body: dict[str, Any] = {"name": name}
        if email is not None:
            body["email"] = email
        return self._post("/v1/users", json=body, cast_to=User)

    def get(self, user_id: str) -> User:
        return self._get(f"/v1/users/{user_id}", cast_to=User)

    def list(self, *, page: int | None = None, limit: int | None = None) -> UserListResponse:
        params: dict[str, Any] = {}
        if page is not None:
            params["page"] = page
        if limit is not None:
            params["limit"] = limit
        return self._get("/v1/users", cast_to=UserListResponse, params=params or None)

    def update(self, user_id: str, *, name: str, email: str | None = None) -> User:
        body: dict[str, Any] = {"name": name}
        if email is not None:
            body["email"] = email
        return self._put(f"/v1/users/{user_id}", json=body, cast_to=User)

    def patch(self, user_id: str, *, name: str | None = None, email: str | None = None) -> User:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if email is not None:
            body["email"] = email
        return self._patch(f"/v1/users/{user_id}", json=body, cast_to=User)

    def delete(self, user_id: str) -> DeleteResponse:
        return self._delete(f"/v1/users/{user_id}", cast_to=DeleteResponse)


class AsyncUsersResource(BaseAsyncAPIResource):
    async def create(self, *, name: str, email: str | None = None) -> User:
        body: dict[str, Any] = {"name": name}
        if email is not None:
            body["email"] = email
        return await self._post("/v1/users", json=body, cast_to=User)

    async def get(self, user_id: str) -> User:
        return await self._get(f"/v1/users/{user_id}", cast_to=User)

    async def list(self, *, page: int | None = None, limit: int | None = None) -> UserListResponse:
        params: dict[str, Any] = {}
        if page is not None:
            params["page"] = page
        if limit is not None:
            params["limit"] = limit
        return await self._get("/v1/users", cast_to=UserListResponse, params=params or None)

    async def update(self, user_id: str, *, name: str, email: str | None = None) -> User:
        body: dict[str, Any] = {"name": name}
        if email is not None:
            body["email"] = email
        return await self._put(f"/v1/users/{user_id}", json=body, cast_to=User)

    async def patch(self, user_id: str, *, name: str | None = None, email: str | None = None) -> User:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if email is not None:
            body["email"] = email
        return await self._patch(f"/v1/users/{user_id}", json=body, cast_to=User)

    async def delete(self, user_id: str) -> DeleteResponse:
        return await self._delete(f"/v1/users/{user_id}", cast_to=DeleteResponse)
```

### Method naming conventions

| HTTP Method | OpenAPI `operationId` | Fallback method name |
|-------------|----------------------|---------------------|
| GET (single) | Use operationId | `get` |
| GET (list) | Use operationId | `list` |
| POST | Use operationId | `create` |
| PUT | Use operationId | `update` |
| PATCH | Use operationId | `update` |
| DELETE | Use operationId | `delete` or `remove` |

If the spec has `operationId`, prefer converting it to camelCase (TS) or snake_case (Python). Otherwise derive from the HTTP method and path.

### Path parameters

Path parameters (e.g., `/users/{userId}`) become method arguments. Place them before the body/params argument:
- TS: `async get(userId: string): Promise<User>`
- Python: `def get(self, user_id: str) -> User:`

Always URL-encode path parameters in TypeScript: `encodeURIComponent(userId)`.

### SSE / Streaming endpoints

Detect SSE endpoints by:
1. Response content type `text/event-stream`
2. Custom extension `x-sse: true` on the operation
3. Operation ID containing `stream` or `subscribe`

For SSE endpoints, generate a streaming method:

**TypeScript:**

First, define the `EventStream` wrapper class (put this in the resource's `index.ts`):

```typescript
import { parseSSEStream } from "../_utils/sse.js";

// EventStream — async-iterable wrapper around an SSE stream
export class EventStream {
  private _generator: AsyncGenerator<StreamEvent>;
  private _rawStream: ReadableStream<string>;

  constructor(generator: AsyncGenerator<StreamEvent>, rawStream: ReadableStream<string>) {
    this._generator = generator;
    this._rawStream = rawStream;
  }

  [Symbol.asyncIterator](): AsyncGenerator<StreamEvent> {
    return this._generator;
  }

  async close(): Promise<void> {
    await this._generator.return(undefined);
    await this._rawStream.cancel();
  }
}
```

Define event schemas as a discriminated union in `types.ts`:

```typescript
export const streamEventSchema = z.discriminatedUnion("type", [
  startedEventSchema,
  progressEventSchema,
  completeEventSchema,
]);
export type StreamEvent = z.infer<typeof streamEventSchema>;

// Optional callbacks interface
export interface StreamOptions {
  signal?: AbortSignal;
  onStarted?: (event: StartedEvent) => void;
  onProgress?: (event: ProgressEvent) => void;
  onComplete?: (event: CompleteEvent) => void;
}
```

Then in the resource class, validate each raw SSE event against the discriminated union and dispatch callbacks:

```typescript
function validateEvent(data: Record<string, unknown>): StreamEvent | null {
  const result = streamEventSchema.safeParse(data);
  return result.success ? result.data : null;
}

// In the resource class:
async stream(params: StreamParams, options: StreamOptions = {}): Promise<EventStream> {
  const raw = await this._client.postStream("/v1/jobs/stream", {
    json: params,
    signal: options.signal,
  });

  async function* generate(): AsyncGenerator<StreamEvent> {
    for await (const data of parseSSEStream(raw)) {
      const event = validateEvent(data);
      if (event) {
        // Dispatch to the matching callback
        switch (event.type) {
          case "STARTED": options.onStarted?.(event); break;
          case "PROGRESS": options.onProgress?.(event); break;
          case "COMPLETE": options.onComplete?.(event); break;
        }
        yield event;
      }
    }
  }

  return new EventStream(generate(), raw);
}
```

**Python (sync + async — both required):**
```python
from __future__ import annotations

from collections.abc import Iterator, AsyncIterator
from typing import Any, Callable

from .._utils.sse_parser import parse_sse_line_stream, async_parse_sse_line_stream
from .types import StreamEvent


class StreamWrapper:
    """Sync SSE stream — use as: with resource.stream(...) as stream: for event in stream: ..."""

    def __init__(self, lines: Iterator[str], on_event: Callable[[StreamEvent], None] | None = None) -> None:
        self._lines = lines
        self._on_event = on_event

    def __iter__(self) -> Iterator[StreamEvent]:
        for event_data in parse_sse_line_stream(self._lines):
            event = StreamEvent.model_validate(event_data)
            if self._on_event:
                self._on_event(event)
            yield event

    def __enter__(self) -> StreamWrapper:
        return self

    def __exit__(self, *args: object) -> None:
        pass


class AsyncStreamWrapper:
    """Async SSE stream — use as: async with resource.stream(...) as stream: async for event in stream: ..."""

    def __init__(self, lines: AsyncIterator[str], on_event: Callable[[StreamEvent], None] | None = None) -> None:
        self._lines = lines
        self._on_event = on_event

    async def __aiter__(self) -> AsyncIterator[StreamEvent]:
        async for event_data in async_parse_sse_line_stream(self._lines):
            event = StreamEvent.model_validate(event_data)
            if self._on_event:
                self._on_event(event)
            yield event

    async def __aenter__(self) -> AsyncStreamWrapper:
        return self

    async def __aexit__(self, *args: object) -> None:
        pass
```

Use `StreamWrapper` in the sync resource's `stream()` method, and `AsyncStreamWrapper` in the async resource's `stream()` method.

### Nested resources

If the API has nested paths like `/vault/connections` and `/vault/items`, create sub-resources:

**TypeScript:**
```typescript
export class VaultResource extends APIResource {
  readonly connections: VaultConnectionsResource;
  readonly items: VaultItemsResource;

  constructor(client: APIResource["_client"]) {
    super(client);
    this.connections = new VaultConnectionsResource(client);
    this.items = new VaultItemsResource(client);
  }
}
```

**Python (sync + async):**
```python
class VaultResource(BaseSyncAPIResource):
    connections: VaultConnectionsResource
    items: VaultItemsResource

    def __init__(self, client: BaseSyncAPIClient) -> None:
        super().__init__(client)
        self.connections = VaultConnectionsResource(client)
        self.items = VaultItemsResource(client)


class AsyncVaultResource(BaseAsyncAPIResource):
    connections: AsyncVaultConnectionsResource
    items: AsyncVaultItemsResource

    def __init__(self, client: BaseAsyncAPIClient) -> None:
        super().__init__(client)
        self.connections = AsyncVaultConnectionsResource(client)
        self.items = AsyncVaultItemsResource(client)
```

## Step 7: Generate the main client class

### TypeScript: `src/client.ts`

```typescript
import { BaseClient } from "./_utils/client.js";
import type { ClientOptions } from "./_utils/client.js";
import { UsersResource } from "./users/index.js";
import { PostsResource } from "./posts/index.js";

export class {{SDK_CLASS_NAME}} extends BaseClient {
  readonly users: UsersResource;
  readonly posts: PostsResource;

  constructor(options?: ClientOptions) {
    super(options);
    this.users = new UsersResource(this);
    this.posts = new PostsResource(this);
  }
}
```

### Python: `src/{package}/client.py`

```python
from ._utils.client import BaseSyncAPIClient, BaseAsyncAPIClient
from .users import UsersResource, AsyncUsersResource
from .posts import PostsResource, AsyncPostsResource

class {{SDK_CLASS_NAME}}(BaseSyncAPIClient):
    users: UsersResource
    posts: PostsResource

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str = "{{DEFAULT_BASE_URL}}",
        timeout: float = 600.0,
        max_retries: int = 2,
    ) -> None:
        super().__init__(api_key=api_key, base_url=base_url, timeout=timeout, max_retries=max_retries)
        self.users = UsersResource(self)
        self.posts = PostsResource(self)

class Async{{SDK_CLASS_NAME}}(BaseAsyncAPIClient):
    users: AsyncUsersResource
    posts: AsyncPostsResource

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str = "{{DEFAULT_BASE_URL}}",
        timeout: float = 600.0,
        max_retries: int = 2,
    ) -> None:
        super().__init__(api_key=api_key, base_url=base_url, timeout=timeout, max_retries=max_retries)
        self.users = AsyncUsersResource(self)
        self.posts = AsyncPostsResource(self)
```

## Step 8: Generate barrel exports

### TypeScript: `src/index.ts`

Export the client, all types/schemas, streaming wrappers (if any), and all errors:

```typescript
export type { ClientOptions } from "./_utils/client.js";

// Client
export { Acme } from "./client.js";

// Stream wrappers (only if SSE endpoints exist)
export { EventStream } from "./jobs/index.js";

// Users types
export { userSchema, createUserParamsSchema, updateUserParamsSchema, userListResponseSchema } from "./users/types.js";
export type { User, CreateUserParams, UpdateUserParams, UserListResponse } from "./users/types.js";

// Jobs types (including SSE event types)
export { streamEventSchema, startedEventSchema, progressEventSchema, completeEventSchema } from "./jobs/types.js";
export type { StreamEvent, StartedEvent, ProgressEvent, CompleteEvent, StreamOptions } from "./jobs/types.js";

// Error hierarchy
export {
  SDKError,
  SSEParseError,
  APIError,
  APIConnectionError,
  APITimeoutError,
  APIStatusError,
  BadRequestError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  RequestTimeoutError,
  ConflictError,
  UnprocessableEntityError,
  RateLimitError,
  InternalServerError,
} from "./_utils/errors.js";
```

### Python: `src/{package}/__init__.py`

Export both sync and async clients, all model types, stream wrappers (if any), and all exceptions:

```python
# Clients
from .client import Acme as Acme
from .client import AsyncAcme as AsyncAcme

# Users types
from .users.types import User as User
from .users.types import CreateUserParams as CreateUserParams
from .users.types import UserListResponse as UserListResponse

# Jobs types (including SSE event types, if any)
from .jobs.types import StreamEvent as StreamEvent
from .jobs.types import StartedEvent as StartedEvent
from .jobs.types import ProgressEvent as ProgressEvent
from .jobs.types import CompleteEvent as CompleteEvent

# Stream wrappers (only if SSE endpoints exist)
from .jobs import StreamWrapper as StreamWrapper
from .jobs import AsyncStreamWrapper as AsyncStreamWrapper

# Exceptions
from ._utils.exceptions import SDKError as SDKError
from ._utils.exceptions import SSEParseError as SSEParseError
from ._utils.exceptions import APIError as APIError
from ._utils.exceptions import APIConnectionError as APIConnectionError
from ._utils.exceptions import APITimeoutError as APITimeoutError
from ._utils.exceptions import APIStatusError as APIStatusError
from ._utils.exceptions import BadRequestError as BadRequestError
from ._utils.exceptions import AuthenticationError as AuthenticationError
from ._utils.exceptions import PermissionDeniedError as PermissionDeniedError
from ._utils.exceptions import NotFoundError as NotFoundError
from ._utils.exceptions import RequestTimeoutError as RequestTimeoutError
from ._utils.exceptions import ConflictError as ConflictError
from ._utils.exceptions import UnprocessableEntityError as UnprocessableEntityError
from ._utils.exceptions import RateLimitError as RateLimitError
from ._utils.exceptions import InternalServerError as InternalServerError
```

## Step 9: Clean up

Remove the temporary clone:

```bash
rm -rf /tmp/opensdk
```

## Step 10: Verify the generated SDK

After generating, do a quick sanity check:
1. Ensure all imports resolve (no dangling references)
2. Ensure every path in the spec has a corresponding method
3. Ensure every `$ref` in the spec points to a generated schema
4. For TypeScript: run `tsc --noEmit` if possible
5. For Python: check that the module can be imported
6. For Python: verify every resource has both a sync class and an `Async` class

## Reference: Template placeholders

These placeholders appear in the template files and MUST be replaced:

| Placeholder | Used in | Description |
|-------------|---------|-------------|
| `{{DEFAULT_BASE_URL}}` | `client.ts`, `_base.py` | API base URL |
| `{{ENV_VAR_NAME}}` | `client.ts`, `_base.py` | Environment variable for API key. If `AUTH_SCHEME` is `none`, remove the env var lookup and the "missing key" error. |
| `{{AUTH_HEADER}}` | `client.ts`, `_base.py` | HTTP header name for auth. If `AUTH_SCHEME` is `none`, remove this line from `_buildHeaders`. |
| `{{PACKAGE_NAME}}` | `client.ts`, `_base.py` | Package name (for User-Agent) |

If `AUTH_SCHEME` is `none`: make the `apiKey` constructor param fully optional (no error if missing), and remove the auth header from `_buildHeaders()`. The rest of the template stays the same.

## Reference: File structure of a generated SDK

```
sdk/
├── package.json                    # (TS) or pyproject.toml (Python)
├── tsconfig.json                   # (TS only)
├── tsconfig.build.json             # (TS only)
└── src/
    ├── _utils/
    │   ├── client.ts / client/     # HTTP client with auth, retries, errors
    │   ├── errors.ts / exceptions.py
    │   ├── resource.ts / resource.py
    │   └── sse.ts / sse_parser.py
    ├── {resource1}/
    │   ├── index.ts / __init__.py  # Resource class with methods
    │   └── types.ts / types.py     # Schemas and types
    ├── {resource2}/
    │   ├── index.ts / __init__.py
    │   └── types.ts / types.py
    ├── client.ts / client.py       # Main client class
    └── index.ts / __init__.py      # Barrel exports
```
