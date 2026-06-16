-- 0110_fix_v_chains_complete_data.sql
--
-- V01–V05 (TF22 native video chains) were seeded in 0071 with placeholder
-- prompt_templates (just "V01"/"V02"/…), empty negative_prompts, generic
-- names, and wrong output_duration_s (all 7 — doc specifies 10/7/6/7/10).
-- This migration backfills correct values from OGz 2.0 ChainLibrary v2.
-- Idempotent: pure UPDATEs keyed by chain_id.

BEGIN;

-- V01 — Ramadan Atmosphere Clip (TF22, native video, no image step)
UPDATE chains SET
  name_en             = 'Ramadan Atmosphere Clip',
  name_ar             = 'مقطع أجواء رمضان',
  purpose             = 'Native 10-second Ramadan atmosphere video for F&B and lifestyle brands. Auto-triggers during ramadan_active. No image generation step — pure native video.',
  prompt_template     = 'Ramadan atmosphere video: traditional fanous lantern slowly illuminates in foreground, warm tungsten glow gradually intensifies, table with dates and water cups becomes visible, ambient golden-hour just-after-sunset light, peaceful contemplative atmosphere, no people, no text, ambient Ramadan sound, 10 seconds',
  negative_prompt     = 'text, watermark, faces, cross, christmas, alcohol, pork, inappropriate symbols, religious figures, pre-sunset lighting, people, crowd',
  output_duration_s   = 10,
  output_width        = 1080,
  output_height       = 1080,
  aspect_ratio        = '1:1',
  eligible_sectors    = NULL,
  eligible_occasions  = ARRAY['ramadan']::text[],
  quality_tiers       = ARRAY['starter','growth','enterprise']::text[],
  updated_at          = now()
WHERE chain_id = 'V01';

-- V02 — Before/After Transition Video (TF22, Kling 7s)
UPDATE chains SET
  name_en             = 'Before/After Transition Video',
  name_ar             = 'فيديو انتقال قبل وبعد',
  purpose             = 'Smooth 7-second before/after transformation video for beauty service brands. Modest framing throughout.',
  prompt_template     = 'Smooth before-and-after transition for {service_descriptor}: starts on before state, wipe transition reveals after state, both states clearly visible, modest framing throughout, professional reveal pace, 7 seconds',
  negative_prompt     = 'text, watermark, full face if not permitted, distorted faces, exaggerated transformation, AI face failures, immodest framing, exposed hair under hijab',
  output_duration_s   = 7,
  output_width        = 1080,
  output_height       = 1080,
  aspect_ratio        = '1:1',
  eligible_sectors    = ARRAY['beauty']::text[],
  quality_tiers       = ARRAY['growth','enterprise']::text[],
  updated_at          = now()
WHERE chain_id = 'V02';

-- V03 — Product Unboxing Loop (TF22, Kling 6s)
UPDATE chains SET
  name_en             = 'Product Unboxing Loop',
  name_ar             = 'فيديو حلقة فتح العبوة',
  purpose             = 'Hyper-realistic 6-second native unboxing video. Hands open premium packaging, reveal product. No face. All sectors.',
  prompt_template     = 'Native product unboxing video of {product_descriptor}: hands carefully open premium packaging, reveal product inside, hold up for camera angle, soft natural daylight, hyper-realistic hands and packaging detail, no face visible, premium reveal pace, 6 seconds',
  negative_prompt     = 'text, watermark, face visible, full body, distorted hands, extra fingers, AI hand failures, plastic skin, staged studio lighting, cartoon',
  output_duration_s   = 6,
  output_width        = 1080,
  output_height       = 1080,
  aspect_ratio        = '1:1',
  eligible_sectors    = NULL,
  quality_tiers       = ARRAY['growth','enterprise']::text[],
  updated_at          = now()
WHERE chain_id = 'V03';

-- V04 — Occasion Announcement Video (TF22, Seedance 7s with audio)
UPDATE chains SET
  name_en             = 'Occasion Announcement Video',
  name_ar             = 'فيديو إعلان مناسبة',
  purpose             = 'Premium 7-second occasion announcement video with native audio. Most weighted occasion chain. Auto-triggers at National Day, Founding Day, major Eid.',
  prompt_template     = 'Premium occasion announcement video for {occasion_descriptor}: cinematic opening showing occasion-appropriate visual motif (Saudi flag draping, traditional Najdi architecture, palm fronds), warm directional lighting, brand visual element subtly appears, peaceful ceremonial pace, native ambient occasion sound, 7 seconds',
  negative_prompt     = 'text, watermark, non-Saudi cultural symbols, western holidays, cartoon, low quality, bright harsh lighting, rushed pace',
  output_duration_s   = 7,
  output_width        = 1080,
  output_height       = 1080,
  aspect_ratio        = '1:1',
  eligible_sectors    = NULL,
  eligible_occasions  = ARRAY['national_day','founding_day','eid']::text[],
  quality_tiers       = ARRAY['enterprise']::text[],
  updated_at          = now()
WHERE chain_id = 'V04';

-- V05 — New Arrival Reveal Video (TF22, Kling 10s)
UPDATE chains SET
  name_en             = 'New Arrival Reveal Video',
  name_ar             = 'فيديو كشف وصول جديد',
  purpose             = 'Cinematic 10-second product launch reveal video. Starts dark, gradually illuminates product. All sectors for launch intent.',
  prompt_template     = 'Cinematic product launch reveal video for {product_descriptor}: starts in darkness with hint of product silhouette, camera slowly approaches as lighting builds, product gradually reveals in dramatic warm light, final moment shows product fully illuminated, anticipation-building pace, 10 seconds',
  negative_prompt     = 'text, watermark, faces, people, rushed pace, harsh cold lighting, cartoon, low quality, product movement',
  output_duration_s   = 10,
  output_width        = 1080,
  output_height       = 1080,
  aspect_ratio        = '1:1',
  eligible_sectors    = NULL,
  quality_tiers       = ARRAY['starter','growth','enterprise']::text[],
  updated_at          = now()
WHERE chain_id = 'V05';

COMMIT;
