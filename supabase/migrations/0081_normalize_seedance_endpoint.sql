-- Migration 0081 — normalize the invalid Seedance endpoint table-wide
--
-- WHY: The 0071 seed used 'fal-ai/seedance-2.0' as fal_model_secondary on ~30
-- chains. That endpoint is early-access/B2B-gated and NOT generally available on
-- fal.ai (a request to it 422s). On output_type='image' chains the secondary is
-- vestigial (never reaches the animator — the isVideoChain gate skips it), so this
-- is currently dead data; 0080 already fixed the one true video chain (V04). This
-- migration removes the invalid string everywhere so the table is accurate and
-- future-proof: if any of these chains is ever flipped to output_type='video',
-- it will resolve to a reachable model instead of 422-ing.
--
-- GA replacement: 'fal-ai/bytedance/seedance/v1/pro/image-to-video'
-- (same model family, publicly reachable). Per-brand Seedance 2.0 access can still
-- be wired via chain_brand_overrides.fal_model_override.
--
-- SAFE: only rows whose fal_model_secondary is exactly the invalid string are
-- touched. Re-runnable (idempotent UPDATE … WHERE).

UPDATE chains
SET fal_model_secondary = 'fal-ai/bytedance/seedance/v1/pro/image-to-video',
    notes = COALESCE(notes, '') || ' | 0081: seedance-2.0 -> GA seedance pro i2v'
WHERE fal_model_secondary = 'fal-ai/seedance-2.0';
