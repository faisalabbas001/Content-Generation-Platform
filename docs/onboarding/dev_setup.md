# Dev setup — first day

1. Install Node 20+, pnpm, Docker, Supabase CLI.
2. `git clone && cd openclaw-platform && pnpm install`.
3. `cp .env.example .env.local` — get values from team 1Password.
4. `pnpm supabase start` — local Postgres + Studio.
5. `pnpm --filter @openclaw/web dev` — open http://localhost:3000.
6. Read `CLAUDE.md` (4 Hard Rules).
7. Read `docs/architecture/request_flow.md`.

