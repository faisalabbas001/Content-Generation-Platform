-- Fix V01-V05 video chains: primary model should be Flux (generates keyframe image),
-- secondary should be Kling/Seedance (animates keyframe to video).
-- generateFalVideoChain() in packages/image/src/fal-client.ts requires BOTH fields set.
-- With secondary=NULL the trigger !!(primary && secondary) evaluates false and video is skipped.

UPDATE chains SET
  fal_model_primary   = 'fal-ai/flux-pro/v1.1-ultra',
  fal_model_secondary = 'fal-ai/kling-video/v1.6/pro',
  updated_at          = now()
WHERE chain_id IN ('V01', 'V02', 'V03', 'V05');

UPDATE chains SET
  fal_model_primary   = 'fal-ai/flux-pro/v1.1-ultra',
  fal_model_secondary = 'fal-ai/seedance-2.0',
  updated_at          = now()
WHERE chain_id = 'V04';

-- Ensure output_type is set so the classify route can derive format_tier='video'
UPDATE chains
SET output_type = 'video'
WHERE chain_id IN ('V01','V02','V03','V04','V05')
  AND (output_type IS NULL OR output_type != 'video');
