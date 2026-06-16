# Docs

- `adr/` — Architecture Decision Records (one per non-obvious decision — Doc §11.3)
- `runbooks/` — incident playbooks
- `architecture/` — request flow, BrandDNA layers, phase roadmap
- `db/` — schema diagram + migration log
  - [`db/database-guide.md`](db/database-guide.md) — **start here** to understand the database. Every table + every field explained in plain words, plus when to use each, RLS rules, common queries, and "things you should never do."
- `onboarding/` — dev setup, first-day guide
- `api/` — endpoint contracts between n8n and Next.js
  - [`api/agents-and-memory.md`](api/agents-and-memory.md) — **start here** when wiring n8n flows. Full reference for `/api/agents/*`, `/api/memory/*`, and `/api/webhooks/n8n` with request/response examples and per-flow walkthroughs.
  - [`api/webhook_contracts.md`](api/webhook_contracts.md) — high-level n8n status callback contracts.
- [`n8n-integration.md`](n8n-integration.md) — HMAC signing recipe, security model, n8n Function-node code, Phase 3 migration path.
- [`auth-foundation.md`](auth-foundation.md) — auth, RLS, route protection.
- [`PHASE1_TEAM_GUIDE.md`](PHASE1_TEAM_GUIDE.md) — three API patterns (server actions, route handlers, direct DB) for Dev1/Dev2/Dev3.
- [`deployment.md`](deployment.md) — Vercel + Supabase + n8n deployment.

