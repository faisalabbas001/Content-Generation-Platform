# API Layer Conventions (apps/web)

This folder is the single client-facing API layer for the web app.

## Structure

- `types.ts` — shared request/response types.
- `http.ts` — generic `apiFetch` helper + normalized `ApiError`.
- `auth.ts` — Supabase auth functions used by UI hooks.
- `index.ts` — barrel export for clean imports.

## Rules

1. UI components must not call `fetch` directly for app APIs.
2. UI components should use hooks from `src/hooks`, not call API modules inline.
3. Keep API module functions side-effect free except for the network/auth call itself.
4. Normalize thrown errors so the UI can render a clean message consistently.

## Example

```ts
import { useLogin } from '@/hooks/use-auth'

const login = useLogin()
await login.mutateAsync({ email, password })
```
