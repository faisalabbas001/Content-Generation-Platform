-- 0097_fix_video_chain_durations.sql
--
-- Sets each video production chain's output_duration_s to the client-specified
-- length, and assigns an animator model that can actually deliver that length.
--
-- Client spec (TechDoc — video length is chain-driven):
--   V01 Ramadan Atmosphere / V05 New Arrival Reveal .......... 10 s
--   V02 Before/After Transition / V04 Occasion Announcement ... 7 s
--   V03 Product Unboxing Loop ................................. 6 s
--
-- Model capability:
--   • Kling v1.6 i2v (fal-ai/kling-video/v1.6/pro/image-to-video) — duration
--     enum is ONLY 5 or 10. It cannot emit 6s or 7s. Fine for the 10s chains.
--   • Seedance v1 pro i2v (fal-ai/bytedance/seedance/v1/pro/image-to-video) —
--     honours the full 2–12s range. Required for the 6s and 7s chains.
--
-- Therefore V02 (7s) and V03 (6s) are switched from Kling → Seedance so their
-- exact lengths are honoured; V01/V05 stay on Kling (10s is a valid Kling value);
-- V04 stays on Seedance (already correct).
--
-- Scope: only output_type='video' chains V01..V05. No DDL, no RLS, no other
-- columns touched. Idempotent: re-running sets the same values. Image chains and
-- every non-video chain are left exactly as-is.

BEGIN;

-- 10-second chains (Kling can deliver 10s — model unchanged) ───────────────────
UPDATE public.chains SET output_duration_s = 10
  WHERE output_type = 'video' AND chain_id IN ('V01', 'V05');

-- 7-second chains — must use Seedance (Kling cannot do 7s) ─────────────────────
UPDATE public.chains
   SET output_duration_s   = 7,
       fal_model_secondary = 'fal-ai/bytedance/seedance/v1/pro/image-to-video'
  WHERE output_type = 'video' AND chain_id IN ('V02', 'V04');

-- 6-second chain — must use Seedance (Kling cannot do 6s) ──────────────────────
UPDATE public.chains
   SET output_duration_s   = 6,
       fal_model_secondary = 'fal-ai/bytedance/seedance/v1/pro/image-to-video'
  WHERE output_type = 'video' AND chain_id = 'V03';

COMMIT;
