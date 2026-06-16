# BrandDNA — three-layer intelligence (Doc §4)

## Layer 1 — Private Brand
RLS: `brand_id = auth.uid()`. Zero cross-brand access.

## Layer 2 — Sector Intelligence
Readable by all agents. Writable by Memory Controller only. Updated monthly by CIO in Phase 2.

## Layer 3 — Global Intelligence
Readable by all authenticated users. Writable by service_role only. Zero foreign keys to brand_profiles.

See `packages/db/src/schema/` for table definitions.

