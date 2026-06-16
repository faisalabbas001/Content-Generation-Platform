-- Migration 0114: Upgrade all flux/dev chains to flux-pro/v1.1
--
-- Problem: chains U01, U03, U04, F01, R01, B02, B04, T02 were set to
-- fal-ai/flux/dev which has poor prompt adherence — it generates loosely
-- thematic images instead of following the specific brief. This caused
-- "irrelevant" outputs (wrong scenes, wrong composition) even when the
-- prompt arriving at fal was 100% correct.
--
-- Fix: upgrade all flux/dev primary models to flux-pro/v1.1 which is
-- the commercial-grade model with strong prompt adherence.

UPDATE chains
SET fal_model_primary = 'fal-ai/flux-pro/v1.1'
WHERE fal_model_primary = 'fal-ai/flux/dev';
