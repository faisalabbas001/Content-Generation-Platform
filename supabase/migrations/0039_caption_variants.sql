-- Migration 0039 — Add caption_variants to calendar_posts
--
-- Stores the 3 DeepSeek-generated caption variants per post so the client
-- can pick their preferred voice. Shape:
--   [
--     { "caption_ar": "...", "hashtags": [...], "tone": "formal" },
--     { "caption_ar": "...", "hashtags": [...], "tone": "playful" },
--     { "caption_ar": "...", "hashtags": [...], "tone": "emotional" }
--   ]
-- The active caption is still in caption_ar (unchanged). caption_variants
-- holds all three so the UI can show a picker. When the client selects one,
-- caption_ar is overwritten and selected_variant_index is set.
--
-- selected_variant_index: 0-based index of which variant is currently active.
-- null = not yet selected / single-caption legacy post.

begin;

alter table public.calendar_posts
  add column if not exists caption_variants  jsonb    default null,
  add column if not exists selected_variant_index int default null
    check (selected_variant_index is null or selected_variant_index between 0 and 2);

comment on column public.calendar_posts.caption_variants is
  'Up to 3 DeepSeek caption variants. Array of {caption_ar, hashtags, tone}.';

comment on column public.calendar_posts.selected_variant_index is
  '0-based index of the active variant in caption_variants. Null = legacy single-caption.';

commit;
