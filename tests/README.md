# Tests

- `unit/` — Vitest, pure functions (inside each package)
- `hard_rules/` — CI-gating audits of the 4 Hard Rules (inside packages/core)
- `integration/` — hit real Supabase test project
- `e2e/` — Playwright
- `load/` — k6 scripts (100 concurrent, 300-client batch)
- `arabic_qa/` — 20-post calibration + 50-post M2 eval set
- `fixtures/` — shared test data (F&B Najdi, Retail Hejazi, Beauty Gulf, …)

