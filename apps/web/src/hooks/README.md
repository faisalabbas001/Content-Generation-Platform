# Hooks Conventions (apps/web)

## Purpose

Keep async state handling out of page/component files and centralize it in reusable hooks.

## Current Hooks

- `use-api-mutation.ts` — generic mutation state machine (`idle/pending/success/error`).
- `use-auth.ts` — auth hooks built on top of `src/lib/api/auth.ts`.

## Rules

1. Components should consume hooks, not manage raw async/loading/error plumbing.
2. Hooks should depend on `src/lib/api/*` modules for network/auth operations.
3. Keep hook return shape stable (`isPending`, `error`, `mutateAsync`) for consistency.
