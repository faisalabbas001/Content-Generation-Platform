-- Migration 0070: Chain Prompt Variants Seed
-- Seeds default and occasion-specific prompt variants for key chains.

INSERT INTO chain_prompt_variants (
  chain_id, variant_name, variant_label_en, variant_label_ar,
  prompt_text, negative_prompt,
  applicable_occasions, applicable_sectors, applicable_regions, applicable_tiers,
  priority, is_default, is_active, notes
) VALUES

-- ── tf01_01_native_quote_card — Standard default ──────────────────────────────
('tf01_01_native_quote_card','standard','Standard','قياسي',
 'Professional brand photography for a quote card visual. {{tone_descriptor}} atmosphere. {{occasion_hint}} context. Clean background that complements Arabic typography. Brand-appropriate composition with generous negative space for text placement. No text, no words, no typography embedded in the image.',
 'text, words, letters, numbers, typography, captions, watermarks, cartoon, anime, illustration, CGI, 3D render',
 NULL, NULL, NULL, NULL, 0, true, true, 'Default standard variant'),

-- ── tf01_01_native_quote_card — Ramadan variant ───────────────────────────────
('tf01_01_native_quote_card','ramadan','Ramadan','رمضان',
 'Professional brand photography for a Ramadan quote card visual. Warm, spiritual, reverent atmosphere. Soft golden amber tones, subtle crescent or lantern elements in background bokeh. Generous negative space for Arabic typography overlay. No text, no words in image.',
 'text, words, letters, cartoon, secular commercial feel, cold lighting',
 ARRAY['ramadan','ramadan_iftar','ramadan_suhoor'], NULL, NULL, NULL, 10, false, true, 'Ramadan seasonal variant — warmer tone, spiritual atmosphere'),

-- ── tf01_01_native_quote_card — National Day variant ─────────────────────────
('tf01_01_native_quote_card','national_day','National Day','اليوم الوطني',
 'Professional brand photography for a Saudi National Day quote card. Patriotic atmosphere, deep Saudi green and white color palette. Clean background with subtle Saudi national identity elements. Generous negative space for Arabic typography. No text in image.',
 'text, words, letters, cartoon, non-Saudi colors dominant',
 ARRAY['national_day'], NULL, ARRAY['ksa'], NULL, 10, false, true, 'National Day variant — green/white patriotic palette'),

-- ── tf01_01_native_quote_card — Eid variant ──────────────────────────────────
('tf01_01_native_quote_card','eid','Eid','عيد',
 'Professional brand photography for an Eid celebration quote card. Joyful warm celebratory atmosphere. Soft gold and warm tones, subtle decorative elements in background bokeh. Festive yet elegant. Generous negative space for Arabic typography overlay. No text, no words in image.',
 'text, words, letters, cartoon, secular-only feel',
 ARRAY['eid','eid_al_fitr','eid_al_adha'], NULL, NULL, NULL, 10, false, true, 'Eid celebration variant — warm celebratory tone'),

-- ── tf10_01_food_hero_closeup — Standard default ──────────────────────────────
('tf10_01_food_hero_closeup','standard','Standard','قياسي',
 'Professional food photography. {{food_description}} as hero. Close-up angle, shallow depth of field. {{plating_style}} plating. Warm food photography lighting, steam if appropriate. Appetite appeal, photorealistic. No text, no hands.',
 'text, hands, cold clinical lighting, cartoon, unappetizing colors',
 NULL, NULL, NULL, NULL, 0, true, true, 'Standard food hero default'),

-- ── tf10_01_food_hero_closeup — Ramadan iftar variant ────────────────────────
('tf10_01_food_hero_closeup','ramadan_iftar','Ramadan Iftar','إفطار رمضان',
 'Professional food photography for Ramadan iftar. {{food_description}} as hero. Traditional Ramadan presentation — dates prominently featured if relevant, traditional Saudi iftar tableware. Warm golden iftar lighting, reverent hospitality atmosphere. Appetite appeal, photorealistic. No text.',
 'text, hands, cold clinical lighting, cartoon, Western-only presentation',
 ARRAY['ramadan','ramadan_iftar'], ARRAY['f_and_b','hospitality'], NULL, NULL, 15, false, true, 'Iftar food presentation for Ramadan season'),

-- ── tf05_01_hands_hold_product — Standard default ─────────────────────────────
('tf05_01_hands_hold_product','standard','Standard','قياسي',
 'Close-up commercial photography of {{talent_demographic}} hands holding {{product_description}}. {{background_setting}} background. Warm natural lighting. Right hand dominant. Clean, authentic, relatable framing. No text.',
 'text, left hand holding product, cartoon, studio strobe, artificial lighting',
 NULL, NULL, NULL, NULL, 0, true, true, 'Standard hands product default'),

-- ── tf05_03_gifting_moment — Eid variant ─────────────────────────────────────
('tf05_03_gifting_moment','eid','Eid Gifting','إهداء العيد',
 'Warm Eid gifting moment photography. {{talent_demographic}} hands presenting {{product_or_gift}} as Eid gift. Eid atmosphere — joyful, warm, celebratory. Traditional Eid wrapping or premium presentation. Soft warm lighting, genuine joy. No text.',
 'text, cartoon, cold settings, generic stock photo',
 ARRAY['eid','eid_al_fitr','eid_al_adha'], NULL, NULL, NULL, 10, false, true, 'Eid-specific gifting variant'),

-- ── tf08_05_ramadan_night_atmosphere — Standard default ────────────────────────
('tf08_05_ramadan_night_atmosphere','standard','Standard','قياسي',
 'Atmospheric Ramadan night photography. {{scene_description}} with traditional Ramadan lanterns and warm ambient light. Moonlit sky, date palm silhouettes, warm family atmosphere. Golden and amber palette, no harsh lighting. Reverent respectful mood. No text.',
 'text, daylight scenes, commercial product focus only, cartoon, non-Islamic elements',
 ARRAY['ramadan','ramadan_iftar','ramadan_suhoor'], NULL, NULL, NULL, 0, true, true, 'Ramadan night atmosphere default'),

-- ── tf12_01_national_day_celebration — Standard default ───────────────────────
('tf12_01_national_day_celebration','standard','Standard','قياسي',
 'Saudi National Day celebration photography. {{celebration_scene}} with Saudi national colors — deep green and white. {{brand_element}} integrated with national pride theme. Fireworks or festive elements in {{setting_description}}. No text.',
 'text, non-Saudi colors, cartoon, generic celebration stock',
 ARRAY['national_day'], NULL, ARRAY['ksa'], NULL, 0, true, true, 'National Day standard default'),

-- ── tf22_03_cinematic_slow_dolly_subject_reveal — Standard default ─────────────
('tf22_03_cinematic_slow_dolly_subject_reveal','standard','Standard','قياسي',
 '{{first_frame_description}} Cinematic DSLR still, shallow depth of field, dramatic professional lighting, photorealistic. The hero subject: {{hero_subject_description}}. Setting: {{setting_description}}. No motion blur, sharp keyframe, no text.',
 'text, words, letters, numbers, cartoon, anime, illustration, CGI render, artificial, plastic, cheap production, blurry, overexposed',
 NULL, NULL, NULL, NULL, 0, true, true, 'Canonical TF22 two-model dolly chain default'),

-- ── tf23_01_saudi_ugc_phone_pov_unboxing — Standard default ──────────────────
('tf23_01_saudi_ugc_phone_pov_unboxing','standard','Standard','قياسي',
 'Phone camera POV, {{talent_demographic}} hands holding {{product_description}}. {{setting_environment}} background visible behind. Natural ambient lighting, slightly imperfect exposure, authentic home or café setting. No studio lighting, no professional composition. Vertical format.',
 'studio lighting, professional photography, perfect composition, artificial lighting, text, watermarks, logos, cartoon',
 NULL, ARRAY['retail','f_and_b','beauty'], NULL, NULL, 0, true, true, 'UGC unboxing default variant'),

-- ── tf09_01_fashion_portrait_ksa — Standard default ──────────────────────────
('tf09_01_fashion_portrait_ksa','standard','Standard','قياسي',
 'Professional fashion portrait photography. {{model_description}} wearing {{outfit_description}}. {{setting_description}} background. Studio or natural professional lighting. Contemporary Saudi modest fashion aesthetic. Confident, aspirational expression. No text.',
 'text, immodest attire, revealing clothing, cartoon, Western-only fashion',
 NULL, ARRAY['fashion','beauty','lifestyle'], NULL, NULL, 0, true, true, 'KSA fashion portrait standard default'),

-- ── tf04_01_desert_landscape_hero — Standard default ─────────────────────────
('tf04_01_desert_landscape_hero','standard','Standard','قياسي',
 'Commercial product photography in authentic desert landscape. {{product_description}} placed on {{desert_surface}} in a vast Saudi desert landscape. Golden sand dunes in background, natural desert light. Photorealistic, cinematic composition. No text.',
 'text, cartoon, urban backgrounds, green forests, non-desert environments',
 NULL, NULL, ARRAY['ksa','gcc'], NULL, 0, true, true, 'Saudi desert landscape default variant'),

-- ── tf16_01_ramadan_product_mood — Standard default ──────────────────────────
('tf16_01_ramadan_product_mood','standard','Standard','قياسي',
 'Product photography with Ramadan atmosphere. {{product_description}} in warm Ramadan context. Traditional Ramadan lanterns and crescent moon elements as background. Warm golden-amber palette. Spiritual yet commercial balance. No text.',
 'text, secular only, cold lighting, cartoon',
 ARRAY['ramadan'], NULL, NULL, NULL, 0, true, true, 'Ramadan product mood standard default')

ON CONFLICT (chain_id, variant_name) DO UPDATE SET
  prompt_text          = EXCLUDED.prompt_text,
  negative_prompt      = EXCLUDED.negative_prompt,
  applicable_occasions = EXCLUDED.applicable_occasions,
  applicable_sectors   = EXCLUDED.applicable_sectors,
  priority             = EXCLUDED.priority,
  is_default           = EXCLUDED.is_default,
  notes                = EXCLUDED.notes,
  updated_at           = now();
