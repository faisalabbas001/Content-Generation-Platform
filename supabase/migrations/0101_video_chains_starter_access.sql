-- Migration 0101 — open video chains to starter-tier brands
--
-- ROOT CAUSE: Every video chain (V01–V05) was inaccessible to starter brands:
--   V01–V04: quality_tiers excluded 'starter' (growth/enterprise only)
--   V05:     quality_tiers included 'starter' BUT cultural_constraints had
--            requires_wardrobe_check=true which blocks starter brands (Signal 3)
--
-- RESULT: CEO classify route filtered out ALL video chains for starter brands
-- → available_chains (video) was empty → CEO returned selected_chain=null
-- → chain_id=null reached V01 → 503 crash on image/generate.
--
-- FIX:
--   1. Add 'starter' to V01 and V02 quality_tiers
--      (V03/V04 stay enterprise-only — they are high-cost specialised chains)
--   2. Set V05 requires_wardrobe_check=false
--      (Cinematic Reveal Video is a product/abstract chain — no wardrobe needed)

-- 1. V01 — Brand Story Video: open to starter
UPDATE chains
SET quality_tiers = ARRAY['starter','growth','enterprise'],
    updated_at    = now()
WHERE chain_id = 'V01';

-- 2. V02 — open to starter
UPDATE chains
SET quality_tiers = ARRAY['starter','growth','enterprise'],
    updated_at    = now()
WHERE chain_id = 'V02';

-- 3. V05 — remove wardrobe check so starter brands are not blocked by Signal 3
UPDATE chains
SET cultural_constraints = cultural_constraints || '{"requires_wardrobe_check": false}'::jsonb,
    updated_at           = now()
WHERE chain_id = 'V05';
