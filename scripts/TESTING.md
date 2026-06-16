# Manual testing — BrandDNA pipeline

How to verify each piece of the BrandDNA stack works, without running a full live onboarding every time. All scripts live under `scripts/` and run from repo root with `node scripts/<name>.mjs`.

Prerequisites:

- `apps/web/.env.local` populated (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, N8N_WEBHOOK_SECRET, APP_BASE_URL, ANTHROPIC_API_KEY, APIFY_API_KEY)
- Dev server running: `pnpm --filter web dev` (so `APP_BASE_URL` resolves; default `http://localhost:3000`)
- Migrations applied: `supabase db push` (especially 0030 for `vector_namespace`)

---

## 1. Smoke test — schema + env (5 seconds)

```
node scripts/smoke-test.mjs
```

Runs 8 always-on invariants:

- Required env vars present
- composition_matrix seeded with 300 rows (12 × 5 × 5)
- brand_profiles has all v2 + audit columns (archetype/lifecycle/intent/vector_namespace/sector_baseline_id/place_id)
- memory_controller_queue accepts method_profile_update nomination type
- anomaly_records accepts composition_score_below_floor type
- onboarding_questions seeded
- sector_baselines has F&B entry
- visual_style_profiles + brand_method_profiles have v2 columns

Scoped to a brand (verifies a completed onboarding):

```
node scripts/smoke-test.mjs --brand=<uuid>
```

Adds:
- source_records ≥ 4 rows
- evidence_bundles ≥ 8 rows (proves Memory drained)
- brand_method_profiles row exists
- archetype_primary, lifecycle_stage, intent_state filled
- completeness_score ≥ 50
- composition_score ≥ 60 OR a matching anomaly row exists
- sector_baseline_id linked
- branddna_event_log ≥ 3 events

Exit code 0 = all pass; non-zero = something is wrong. Run this before deploy and after migrations.

---

## 2. Agent replay — CEO + COO + Memory + CaptionContext

```
node scripts/test-agents.mjs                          # picks most-recent complete brand
node scripts/test-agents.mjs --brand=<uuid>           # specific brand
node scripts/test-agents.mjs --agents=ceo,coo         # subset
node scripts/test-agents.mjs --dry-run                # preview payloads, no fire
```

What it does:

1. Picks a brand with already-extracted data (form + IG/website/places source_records).
2. Calls CEO classify with the real trigger payload (HMAC-signed, same way n8n does).
3. Calls COO build-branddna with all v2 fields (request_axes, method_profile_request, form_priors).
4. Calls Memory process to drain.
5. Calls COO compile-caption-context to verify the A01 path (Qdrant cache + v2 enrichment).
6. Re-reads the DB and verifies: completeness ≥ 50, archetype/lifecycle/intent set, evidence_bundles ≥ 8, method_profile exists, composition_score ≥ 60.

**Side effects:** this runs against a real brand and refreshes its BrandDNA via the same Memory Controller path agents use. Use a test brand. Use `--dry-run` first if unsure.

Typical output (success):

```
[test-agents] brand=5b8d…  slug=barnscoffee-gfs7  name="barn's"
[test-agents] data_richness=rich  pre_launch=false  has_form=true
[test-agents] before: evidence=12 queue=23 written=23

→ CEO classify: POST http://localhost:3000/api/agents/ceo/classify
  ← 200 in 18421ms
  ✓ {"ok":true,"request_id":"…","result":{"decision":{"confidence_mode":"Cautious",…
→ COO build-branddna: POST …
  ← 200 in 32108ms
  ✓ {"ok":true,…
→ Memory drain: …
→ COO compile-caption-context: …

=== Post-run verification ===
brand_profiles v2 fields: { archetype_primary: 'Sage', lifecycle_stage: 'maturity', intent_state: 'grow', completeness_score: 82, sector_baseline_id: '...', vector_namespace: 'brand_5b8d…' }
evidence_bundles rows: 12 (was 12)
memory_controller_queue: 46/46 written (was 23/23)
brand_method_profiles: { voice_register: 'authoritative_warm', visual_idiom: 'archive_film_grain', cadence_rule: 'steady_drumbeat', composition_score: 81, … }

Verdict:
  PASS  completeness_score ≥ 50
  PASS  archetype_primary set
  PASS  lifecycle_stage set
  PASS  intent_state set
  PASS  evidence_bundles ≥ 8
  PASS  method_profile exists
  PASS  method.composition_score ≥ 60
```

---

## 3. D02 — confidence-decay maintenance (BrandDNA)

D02 is scheduled cron (1st of month, 04:00 AST). It walks `evidence_bundles` and downgrades any field whose `last_evaluated` is older than 90 days. The decay rule:

- `last_evaluated > 365 days ago` → `deprecated`
- `inferred_high` → `inferred_medium`
- `inferred_medium` → `inferred_low`
- `inferred_low` → stays
- `evidence_strong` → `evidence_weak`
- `evidence_weak` → `inferred_low`
- `explicitly_confirmed` → never decays

Each decay is a `confidence_upgrade` nomination → Memory Controller writes evidence_bundles (Hard Rule #2). No direct UPDATE.

Manual trigger (dev/test):

```
node scripts/trigger-d02.mjs                  # real run
node scripts/trigger-d02.mjs --dry-run        # preview what would change
node scripts/trigger-d02.mjs --threshold=30   # custom days
```

Dry-run example:

```
[d02] 14 stale evidence rows
[d02] 9 nominations to enqueue
  5b8d… arabic_dialect: inferred_high → inferred_medium (age=121d)
  5b8d… price_position: inferred_medium → inferred_low (age=121d)
  …
```

Verify after a real D02 run:

```
node scripts/smoke-test.mjs --brand=<aged-brand-uuid>
```

The completeness_score for aged brands should drop (because qualifying evidence count drops).

---

## 4. Full onboarding — end-to-end

When you want the *real* test:

1. Visit `http://localhost:3000/onboarding-start`
2. Submit Step 1 (brand name, IG handle, website, place)
3. Wait for extraction screen (A06 runs in n8n)
4. Submit Step 3 review form (A03 fires)
5. Watch `/<slug>/processing` — should progress through all stages
6. After `snapshot_ready`, redirected to `/<slug>/snapshot`

Verify with:

```
node scripts/smoke-test.mjs --brand=<new-brand-uuid>
```

And inspect manually:

- `/[slug]/profile` — BrandDirectionCard should show archetype + composition score
- `/[slug]/dashboard` — creative direction summary card at top
- `/admin/branddna/<brand_id>` — full inspector with queue/history/responses/posts
- `/admin/anomalies?state=open&brand_id=<uuid>` — check for any unresolved anomalies

---

## 5. Workflow-by-workflow test guide

| Workflow | What to verify | How |
|---|---|---|
| **A06 extraction** | Apify returns posts, persist-ig wrote ~30 brand_post_observations | After onboarding, count rows: `SELECT COUNT(*) FROM brand_post_observations WHERE brand_id='...'` |
| **A03 onboarding** | All stages emit + final snapshot has v2 fields | Watch `/processing`, then `node scripts/smoke-test.mjs --brand=<uuid>` |
| **A04 correction** | User edits a field on /profile → triggers A04 → Memory drains | Edit a field → check `branddna_event_log` for a new `confidence_upgraded` event |
| **A01 calendar** | DeepSeek receives v2 BrandDNA in caption_context | After A01 fires, captions should reference brand voice (Sage → educational tone, Lover → sensory language, etc.) |
| **V01 image** | prompt_en starts with "Brand visual identity: …" preamble | Check `image_assets.metadata.prompt_used` after V01 run |
| **D02 maintenance** | Stale evidence decays | `node scripts/trigger-d02.mjs --dry-run` shows decay candidates |
| **S03 anomaly** | Failed flows write anomaly_records | Trigger a failure deliberately (e.g. invalidate IG handle), check `/admin/anomalies` |

---

## 6. What to do if tests fail

| Failure | Likely cause | Fix |
|---|---|---|
| smoke-test: composition_matrix has 0 rows | migration 0023 not applied | `supabase db push` |
| smoke-test: vector_namespace column missing | migration 0030 not applied | `supabase db push` |
| test-agents: CEO returns 401 | N8N_WEBHOOK_SECRET mismatch | check `apps/web/.env.local` vs the secret you signed with |
| test-agents: COO returns 502 / timeout | Anthropic API key issue or model name wrong | check ANTHROPIC_API_KEY + model in `packages/ai/src/providers/anthropic.ts` |
| test-agents: completeness < 50 after drain | Memory Controller didn't pick up form_priors floor | inspect `memory_controller_queue` for `rejected` rows; check `rejection_reason` |
| test-agents: composition_score < 60 | composition matrix row for that tuple has low scores OR COO drifted | check `composition_matrix` row for `(archetype, lifecycle, intent)` |
| D02 dry-run: 0 nominations | no aged evidence yet | run with `--threshold=0` to force everything stale |
| V01: no preamble in prompt | brand has no method_profile yet | re-run COO via `test-agents.mjs --agents=coo,memory` |

---

## 7. Cleanup

If a test left bad data:

- Remove a brand entirely: `DELETE FROM brand_profiles WHERE brand_id='...'` (cascade clears everything)
- Reset evidence_bundles for one brand: `DELETE FROM evidence_bundles WHERE brand_id='...'`
- Clear queue: `DELETE FROM memory_controller_queue WHERE brand_id='...' AND status IN ('pending','rejected')`
- Drop Qdrant namespace: hit `/api/vectors/setup` after, or use Qdrant Cloud UI

Always work against a test brand. The scripts will refresh real BrandDNA if pointed at a real brand.
