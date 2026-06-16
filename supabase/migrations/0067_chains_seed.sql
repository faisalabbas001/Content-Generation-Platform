-- Migration 0067: Chain Library Seed Data
--
-- Seeds the 3 example chains documented in the client's chain spec files.
-- These serve as canonical examples for each output_type:
--   tf01_01 → image (single-model Flux)
--   tf22_03 → video (two-model: Flux keyframe → Kling video)
--   tf23_01 → video (two-model: Flux reference → Kling UGC)
--
-- Full library (88 chains, 23 families TF01–TF23) should be imported via
-- the admin UI Chain Library page once populated from the client doc
-- OGz_2_0_ChainLibrary_v2_Complete.docx.

INSERT INTO chains (
  chain_id, chain_ulid, family, schema_version,
  name_en, name_ar, purpose,
  fal_model_primary, fal_model_secondary,
  prompt_template, negative_prompt,
  input_schema, output_type,
  output_width, output_height, output_duration_s, aspect_ratio,
  eligible_sectors, excluded_sectors,
  eligible_occasions, excluded_occasions,
  quality_tiers, min_maturity_days,
  cultural_constraints, anti_patterns,
  cost_estimate_usd, latency_estimate_s,
  best_for_cd_brains,
  provenance_source, provenance_confirmer, provenance_confidence, provenance_scope,
  is_active, notes
) VALUES

-- ── TF01_01 Native Quote Card ────────────────────────────────────────────────
(
  'tf01_01_native_quote_card',
  '01HZQK2P3M7N8R4T5V6W9X0Y1Z',
  'TF01',
  1,
  'Native Quote Card',
  'بطاقة اقتباس أصيلة',
  'Generate a single-image quote card with Arabic typography rendered natively via post-generation overlay. Suitable for all sectors and occasions.',
  'fal-ai/flux-pro/v1.1-ultra',
  NULL,
  -- Prompt template — variables in {{double_braces}}
  'Professional brand photography for a quote card visual. {{tone_descriptor}} atmosphere. {{occasion_hint}} context. Clean background that complements Arabic typography. Brand-appropriate composition with generous negative space for text placement. No text, no words, no typography embedded in the image.',
  'text, words, letters, numbers, typography, captions, headlines, labels, watermarks, fonts, writing, signs, banners, cartoon, anime, illustration, CGI, 3D render, artificial, plastic',
  '{
    "required": ["tone_descriptor", "quote_text_ar"],
    "optional": ["quote_text_en", "attribution", "occasion_hint"],
    "descriptions": {
      "tone_descriptor": "English adjective phrase describing the mood (e.g. warm and nostalgic, bold and modern)",
      "quote_text_ar": "The Arabic quote text to overlay post-generation",
      "quote_text_en": "Optional English translation",
      "attribution": "Author or source attribution",
      "occasion_hint": "Saudi occasion context (e.g. Ramadan, National Day)"
    }
  }',
  'image',
  1080, 1080, NULL, '1:1',
  NULL,                                    -- all sectors
  NULL,                                    -- no exclusions
  NULL,                                    -- all occasions
  NULL,                                    -- no occasion exclusions
  ARRAY['starter','growth','enterprise'],
  0,
  '{
    "requires_wardrobe_check": false,
    "requires_gesture_check": false,
    "requires_cultural_coherence_check": true,
    "requires_arabic_text_validation": true,
    "high_religious_sensitivity": false,
    "high_gender_sensitivity": false,
    "human_review_recommended_above_quality_tier": "never"
  }',
  ARRAY[
    'Do not pass Arabic text into the prompt — overlay post-generation only (Hard Rule #3)',
    'Do not use busy backgrounds that obscure the text overlay zone',
    'Do not use promotional copy or percentages in the visual brief',
    'Avoid stock-photo lighting that undermines brand authenticity',
    'Do not over-specify layout — leave negative space for the overlay engine',
    'Never include brand logo instructions in the prompt — logos are applied separately'
  ],
  0.05,
  4,
  ARRAY['cd_01','cd_04'],
  'OGz_2_0_ChainLibrary_v2_Complete.docx',
  'Mohamed',
  'confirmed',
  'universal',
  true,
  'Workhorse chain for quote-style content. Works across all sectors and occasions. Primary chain for cultural/trust objective posts.'
),

-- ── TF22_03 Cinematic Slow-Dolly Subject Reveal ──────────────────────────────
(
  'tf22_03_cinematic_slow_dolly_subject_reveal',
  '01HZQK2P3M7N8R4T5V6W9X0Y2A',
  'TF22',
  1,
  'Cinematic Slow-Dolly Subject Reveal',
  'كشف الموضوع بحركة دولي سينمائية',
  'Generate a 5-8 second cinematic video with a slow-dolly push-in reveal of the hero subject. Premium production value for growth and enterprise brands.',
  'fal-ai/flux-pro/v1.1-ultra',
  'fal-ai/kling-video/v2.1-pro',
  -- Step 1 prompt (Flux — generates keyframe reference image)
  '{{first_frame_description}} Cinematic DSLR still, shallow depth of field, dramatic professional lighting, photorealistic. The hero subject: {{hero_subject_description}}. Setting: {{setting_description}}. No motion blur, sharp keyframe, no text.',
  'text, words, letters, numbers, cartoon, anime, illustration, CGI render, artificial, plastic, cheap production, blurry, overexposed',
  '{
    "required": ["hero_subject_description", "setting_description", "first_frame_description"],
    "optional": ["last_frame_description", "duration_seconds", "talent_reference_uri"],
    "descriptions": {
      "hero_subject_description": "What is being revealed (product, person, space)",
      "setting_description": "Background environment and atmosphere",
      "first_frame_description": "Opening frame composition before the dolly move",
      "last_frame_description": "Ending frame after the dolly completes",
      "duration_seconds": "Target duration 5-8 seconds (default 6)",
      "talent_reference_uri": "Optional Supabase URL of a talent reference image"
    }
  }',
  'video',
  1920, 1080, 6, '16:9',
  NULL,                                    -- all sectors
  ARRAY['healthcare_emergency'],
  NULL,                                    -- all occasions
  NULL,
  ARRAY['growth','enterprise'],
  14,                                      -- requires 14 days brand maturity
  '{
    "requires_wardrobe_check": true,
    "requires_gesture_check": true,
    "requires_cultural_coherence_check": true,
    "requires_arabic_text_validation": false,
    "high_religious_sensitivity": false,
    "high_gender_sensitivity": true,
    "human_review_recommended_above_quality_tier": "never"
  }',
  ARRAY[
    'Do not use this for starter-tier brands — the production gap will look incongruent',
    'Do not specify camera brand or lens model in prompt — describe light quality instead',
    'Avoid instructing the model to show price text or promotional overlays',
    'Do not use generic "beautiful" descriptors — be specific about the cinematic quality'
  ],
  1.80,
  75,
  ARRAY['cd_01','cd_03','cd_04'],
  'OGz_2_0_ChainLibrary_v2_Complete.docx',
  'Mohamed',
  'confirmed',
  'universal',
  true,
  'Two-model pipeline: Flux Ultra generates the keyframe reference image, then Kling Pro animates the dolly move. Requires fal_model_secondary. Duration default 6s.'
),

-- ── TF23_01 Saudi UGC Phone POV Unboxing ────────────────────────────────────
(
  'tf23_01_saudi_ugc_phone_pov_unboxing',
  '01HZQK2P3M7N8R4T5V6W9X0Y3B',
  'TF23',
  1,
  'Saudi UGC Phone POV Unboxing',
  'فيديو فتح العلبة بأسلوب المحتوى السعودي الأصيل',
  'Phone-POV unboxing video that looks like authentic Saudi user-generated content. Must feel unproduced and native. For retail, F&B, and beauty sectors only.',
  'fal-ai/flux-pro/v1.1',
  'fal-ai/kling-video/v2.1-standard',
  -- Step 1 prompt (Flux — reference frame for hands/product/setting)
  'Phone camera POV, {{talent_demographic}} hands holding {{product_description}}. {{setting_environment}} background visible behind. Natural ambient lighting, slightly imperfect exposure, authentic home or café setting. No studio lighting, no professional composition. Vertical format.',
  'studio lighting, professional photography, perfect composition, artificial lighting, text, watermarks, logos, cartoon',
  '{
    "required": ["product_description", "talent_demographic", "setting_environment"],
    "optional": ["voiceover_text_ar", "duration_seconds"],
    "descriptions": {
      "product_description": "What is being unboxed (product name, appearance, packaging)",
      "talent_demographic": "Demographic descriptor for hands/person (e.g. young Saudi woman, Saudi man in his 30s)",
      "setting_environment": "Where the unboxing happens (e.g. home kitchen, café table, living room)",
      "voiceover_text_ar": "Optional Arabic voiceover text to add as audio layer",
      "duration_seconds": "Target duration in seconds (default 30)"
    }
  }',
  'video',
  1080, 1920, 30, '9:16',
  ARRAY['retail','f_and_b','beauty'],
  ARRAY['healthcare_clinical','real_estate_luxury'],
  NULL,
  ARRAY['ramadan_solemn_phase'],
  ARRAY['starter','growth','enterprise'],
  0,
  '{
    "requires_wardrobe_check": true,
    "requires_gesture_check": true,
    "requires_cultural_coherence_check": true,
    "requires_arabic_text_validation": false,
    "high_religious_sensitivity": false,
    "high_gender_sensitivity": true,
    "human_review_recommended_above_quality_tier": "never"
  }',
  ARRAY[
    'Never make this look produced — imperfection is the point',
    'Avoid studio lighting descriptions — ambient and natural only',
    'Do not stabilize camera motion in the prompt description',
    'Avoid left-hand product handling (cultural sensitivity)',
    'Do not use luxury or aspirational language — keep it relatable'
  ],
  1.20,
  60,
  ARRAY['cd_03','cd_05'],
  'OGz_2_0_ChainLibrary_v2_Complete.docx',
  'Mohamed',
  'confirmed',
  'universal',
  true,
  'TF23 family represents Saudi-UGC native authenticity layer. Two-model pipeline: Flux generates reference frame, Kling Standard animates. Excluded from Ramadan solemn phase.'
)

ON CONFLICT (chain_id) DO UPDATE SET
  name_en              = EXCLUDED.name_en,
  name_ar              = EXCLUDED.name_ar,
  purpose              = EXCLUDED.purpose,
  fal_model_primary    = EXCLUDED.fal_model_primary,
  fal_model_secondary  = EXCLUDED.fal_model_secondary,
  prompt_template      = EXCLUDED.prompt_template,
  negative_prompt      = EXCLUDED.negative_prompt,
  input_schema         = EXCLUDED.input_schema,
  output_type          = EXCLUDED.output_type,
  output_width         = EXCLUDED.output_width,
  output_height        = EXCLUDED.output_height,
  output_duration_s    = EXCLUDED.output_duration_s,
  aspect_ratio         = EXCLUDED.aspect_ratio,
  eligible_sectors     = EXCLUDED.eligible_sectors,
  excluded_sectors     = EXCLUDED.excluded_sectors,
  eligible_occasions   = EXCLUDED.eligible_occasions,
  excluded_occasions   = EXCLUDED.excluded_occasions,
  quality_tiers        = EXCLUDED.quality_tiers,
  min_maturity_days    = EXCLUDED.min_maturity_days,
  cultural_constraints = EXCLUDED.cultural_constraints,
  anti_patterns        = EXCLUDED.anti_patterns,
  cost_estimate_usd    = EXCLUDED.cost_estimate_usd,
  latency_estimate_s   = EXCLUDED.latency_estimate_s,
  best_for_cd_brains   = EXCLUDED.best_for_cd_brains,
  notes                = EXCLUDED.notes,
  updated_at           = now();
