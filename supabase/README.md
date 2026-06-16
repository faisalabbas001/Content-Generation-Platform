# Supabase

Single source of truth for the OGz Studios database schema (Doc §4, §7).

- `migrations/` — ordered SQL files; run via `pnpm supabase migration up`.
- `functions/` — edge functions (Phase 2+).
- `seed.sql` — dev-only fixtures.

## Migration order
1. 0001_init.sql — 15 Layer-1/2/3 tables + RLS + indexes
2. 0002_seed_occasions.sql — Ramadan, Eid, ND, FD × 2028
3. 0003_seed_baselines.sql — F&B / Retail / Beauty_Wellness
4. 0004_perf_indexes.sql
5. 0005_pdpl_cascade.sql — cascade_delete_brand() function

