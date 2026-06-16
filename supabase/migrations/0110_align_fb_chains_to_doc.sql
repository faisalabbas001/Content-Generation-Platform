-- 0110 — Align F&B chains to chain.md (authoritative Production Chain Library v1.0).
--
-- Root cause of "same shawarma platter repeats": the chains table was misaligned with
-- the doc. F01 "Hot Food Hero" (the PRIMARY F&B food chain, chain.md line 100/671) was
-- MISSING entirely, and F02 was mislabeled "Laptop Lifestyle Context" with a beverage
-- template ({beverage_descriptor} in {glass_style}). So food posts couldn't get F01 and
-- fell onto F02's wrong (beverage) composition → repetitive/wrong images.
--
-- Fix: (1) INSERT F01 Hot Food Hero; (2) correct F02's name + template.
--
-- KEY DESIGN: both templates use {base_visual_brief} — the image route substitutes that
-- with DeepSeek's actual per-post visual_brief_en (the varied shawarma scene), then layers
-- the chain's STYLE on top. This guarantees: (a) no literal {placeholder} ever leaks to
-- fal, and (b) every post renders its OWN scene (no repetition), while the chain still
-- contributes its photographic style + model/cost/aspect routing.

-- ── F01 Hot Food Hero (chain.md §F01) — the primary F&B food chain (was missing) ──
insert into public.chains (
  chain_id, name_en, name_ar, family, purpose,
  eligible_sectors, output_type, fal_model_primary, fal_model_secondary,
  cost_estimate_usd, quality_tiers, style_affinity, min_maturity_days, is_active,
  intent, eligible_occasions, frequency,
  prompt_template, negative_prompt, aspect_ratio
) values (
  'F01', 'Hot Food Hero', 'طبق الطعام الرئيسي', 'TF_F01',
  'Chain F01: Hot Food Hero — the dish at its best moment (steam, color, texture). Primary F&B food chain.',
  array['f_and_b'], 'image', 'fal-ai/flux/dev', 'fal-ai/seedance-2.0',
  0.025, array['starter','growth','enterprise'], 'modern', 0, true,
  array['launch','grow','harvest'], null, '3-5 per week',
  -- {base_visual_brief} = DeepSeek's real per-post scene; chain adds food-hero styling.
  '{base_visual_brief}. Hero food photography, steam rising, fresh garnish detail, warm appetizing lighting, shallow depth of field, 45-degree or top-down angle, no text, no watermark.',
  'text, watermark, raw uncooked, burnt, unappetizing, plastic looking, fake food, alcohol, pork, faces',
  '1:1'
)
on conflict (chain_id) do update set
  name_en          = excluded.name_en,
  name_ar          = excluded.name_ar,
  purpose          = excluded.purpose,
  eligible_sectors = excluded.eligible_sectors,
  output_type      = excluded.output_type,
  fal_model_primary= excluded.fal_model_primary,
  cost_estimate_usd= excluded.cost_estimate_usd,
  quality_tiers    = excluded.quality_tiers,
  style_affinity   = excluded.style_affinity,
  is_active        = excluded.is_active,
  prompt_template  = excluded.prompt_template,
  negative_prompt  = excluded.negative_prompt;

-- ── F02 Beverage Showcase (chain.md §F02) — fix the mislabel + beverage template ──
-- Keep it for DRINK posts; {base_visual_brief} ensures the actual post scene is used so
-- it no longer forces "{beverage_descriptor} in {glass_style}" onto every post.
update public.chains set
  name_en = 'Beverage Showcase',
  name_ar = 'عرض المشروبات',
  purpose = 'Chain F02: Beverage Showcase — drinks/beverages hero shot for F&B.',
  style_affinity = 'modern',
  prompt_template = '{base_visual_brief}. Appetizing beverage photography, condensation and freshness detail, soft directional natural light, warm inviting tones, shallow depth of field, no text, no watermark, no hands.',
  negative_prompt = 'text, watermark, alcohol, pork, faces, harsh lighting, plastic looking, fake'
where chain_id = 'F02';
