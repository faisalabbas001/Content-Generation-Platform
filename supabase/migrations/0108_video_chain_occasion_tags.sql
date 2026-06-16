-- 0108_video_chain_occasion_tags.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Seed-data fix: tag the VIDEO chains' eligible_occasions so the deterministic
-- §9.5 chain scorer applies the +20 occasion boost to the doc-intended video chain
-- during an active occasion. Before this, V01–V05 all had eligible_occasions = NULL,
-- so during Ramadan/Eid the occasion boost never fired for any video chain and V05
-- (cheapest, all-tier) won by default — NOT the doc's intended V01/V04.
--
-- Chain Library (chain.md) intent:
--   V01 Ramadan Atmosphere Clip   → ramadan only
--   V04 Occasion Announcement     → "1 per active occasion" → ALL occasions
--   V02 Before/After, V03 Unboxing, V05 New Arrival → NOT occasion-gated (leave NULL =
--        always-eligible moments, no occasion boost — correct per the doc).
--
-- SAFETY: eligible_occasions ONLY gates the occasion BOOST (scorer line ~410); it does
-- NOT filter eligibility (that uses excluded_occasions). So this is purely additive —
-- it can never make a chain ineligible. Tokens use the canonical families that
-- normalizeOccasionToken() matches on substring (ramadan / eid / national_day / founding_day).
--
-- Idempotent: plain UPDATEs keyed by chain_id; safe to re-run.
-- Does NOT touch V02/V03/V05 (they stay NULL = always-eligible, no boost), and does
-- NOT alter any image chain.
-- ─────────────────────────────────────────────────────────────────────────────

-- V01 — Ramadan Atmosphere Clip → boosted only during Ramadan.
update public.chains
   set eligible_occasions = array['ramadan']::text[],
       updated_at = now()
 where chain_id = 'V01';

-- V04 — Occasion Announcement → boosted for every major Saudi occasion.
update public.chains
   set eligible_occasions = array['ramadan','eid_al_fitr','eid_al_adha','national_day','founding_day']::text[],
       updated_at = now()
 where chain_id = 'V04';

-- Note: V02 / V03 / V05 intentionally left with eligible_occasions = NULL.
-- They are evergreen high-value moment chains (before/after, unboxing, new-arrival),
-- not occasion greetings, so they should not receive the occasion boost. V05 remains
-- the default video for non-occasion calendars and the only starter-tier video chain.
