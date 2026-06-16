-- 0081_negpat_occasion_scope_and_expansion.sql
--
-- F7: (1) add occasion_scope to global_negative_patterns so a pattern can be
--         scoped to an occasion window (null = always active).
--     (2) expand under-covered categories: adult content, gambling mechanics,
--         and extremism — all HARD_BLOCK. Conservative by design: we ADD new
--         explicit rows rather than re-classifying ambiguous ethnonyms, to
--         avoid false positives on legitimate usage.

alter table public.global_negative_patterns
  add column if not exists occasion_scope text;

comment on column public.global_negative_patterns.occasion_scope is
  'null = always active; e.g. ''ramadan'' | ''ramadan_daylight''. Matched by @repo/compliance gate.';

insert into public.global_negative_patterns (pattern_text, severity, category, description) values
  -- Adult / explicit content (expand beyond the 3 seed rows)
  ('porn', 'HARD_BLOCK', 'adult_content', 'Pornographic reference'),
  ('pornography', 'HARD_BLOCK', 'adult_content', 'Pornographic reference'),
  ('إباحية', 'HARD_BLOCK', 'adult_content', 'Pornography in Arabic'),
  ('جنس صريح', 'HARD_BLOCK', 'adult_content', 'Explicit sexual content in Arabic'),
  ('onlyfans', 'HARD_BLOCK', 'adult_content', 'Adult subscription platform reference'),
  ('escort service', 'HARD_BLOCK', 'adult_content', 'Adult escort solicitation'),

  -- Gambling mechanics (beyond the keyword set)
  ('lottery', 'HARD_BLOCK', 'gambling', 'Lottery in English'),
  ('يانصيب', 'HARD_BLOCK', 'gambling', 'Lottery in Arabic'),
  ('رهان', 'HARD_BLOCK', 'gambling', 'Bet/wager in Arabic'),
  ('jackpot', 'HARD_BLOCK', 'gambling', 'Jackpot — gambling mechanic'),
  ('spin to win', 'STRONG_WARN', 'gambling', 'Spin-to-win mechanic — gambling-adjacent promo'),
  ('اربح المليون', 'STRONG_WARN', 'gambling', 'Win-the-million promo — gambling-adjacent'),

  -- Extremism / terrorism
  ('إرهاب', 'STRONG_WARN', 'political', 'Terrorism in Arabic — sensitive context'),
  ('terrorism', 'STRONG_WARN', 'political', 'Terrorism in English — sensitive context'),
  ('داعش', 'HARD_BLOCK', 'political', 'Designated terrorist org (ISIS) in Arabic'),
  ('isis', 'HARD_BLOCK', 'political', 'Designated terrorist org in English'),
  ('تطبيع', 'STRONG_WARN', 'political', 'Normalization — politically sensitive in KSA context')
on conflict (lower(pattern_text)) do nothing;
