# OpenSDK — Claude Skill

**Generate production-quality TypeScript and Python SDKs from any OpenAPI 3.x spec. Fully typed, with retries, streaming, and error handling out of the box.**

Point Claude at your OpenAPI spec and say things like:
- *"Generate a TypeScript SDK from my openapi.json"*
- *"Build me a Python client for this API"*
- *"Create SDKs in both TypeScript and Python from this spec"*

Claude reads your spec, pulls battle-tested template code for HTTP clients, error handling, retries, and SSE streaming, then generates all the types, resource classes, and client wiring — ready to publish.

## What you get

### TypeScript
- **Zod schemas** for every request and response — runtime validation, not just types
- **Typed error hierarchy** — `BadRequestError`, `AuthenticationError`, `RateLimitError`, etc.
- **Automatic retries** with exponential backoff on 408, 429, and 5xx
- **Abort signal** support on every method
- **SSE streaming** with async-iterable `EventStream` wrapper and typed event callbacks
- **Tree-shakeable ESM** output

### Python
- **Pydantic v2 models** for all types
- **Sync + async clients** — every resource gets both `UsersResource` and `AsyncUsersResource`
- **httpx** with configurable timeouts
- **tenacity** retries with exponential backoff
- **SSE streaming** with `StreamWrapper` / `AsyncStreamWrapper` context managers

### Generated file structure

```
sdk/
├── package.json / pyproject.toml
├── tsconfig.json
└── src/
    ├── _utils/          # HTTP client, errors, resource base, SSE parser
    ├── {resource}/      # One folder per API resource
    │   ├── index        # Resource class (create, get, list, update, delete)
    │   └── types        # Zod schemas + TS types / Pydantic models
    ├── client           # Main SDK client class
    └── index            # Barrel exports
```

## How it works

1. **You provide an OpenAPI spec** — file path or URL (auto-detects `openapi.json`, `openapi.yaml`, etc.)
2. **Choose your language** — TypeScript, Python, or both
3. **Claude pulls the templates** — sparse-clones only the needed template files from this repo
4. **Parses the spec** — extracts auth scheme, base URL, resources, schemas, and operations
5. **Generates everything** — types, resource classes, client class, barrel exports, and package config
6. **Cleans up** — removes the temp clone, runs a sanity check on imports and types

Auth is wired automatically from `securitySchemes` — API key, Bearer token, or no-auth all handled.

## Install

```bash
npx skills add https://github.com/The-Pirateship/OpenSDK --skill opensdk
```

## Quick example

After installing, just tell Claude what you want:

```
Generate a TypeScript SDK from ./openapi.json
```

You get a working SDK you can use immediately:

```typescript
import { Acme } from "./sdk/src";

const client = new Acme({ apiKey: "sk-..." });

const user = await client.users.get("user_123");
const connections = await client.vault.connections.list();

const stream = await client.jobs.stream(
  { prompt: "Hello" },
  { onProgress: (e) => console.log(e.percent) }
);
for await (const event of stream) {
  console.log(event.type);
}
```

```python
from sdk import Acme

client = Acme(api_key="sk-...")

user = client.users.get("user_123")
connections = client.vault.connections.list()

with client.jobs.stream(prompt="Hello") as stream:
    for event in stream:
        print(event.type, event.data)
```

## License

AGPL-3.0
