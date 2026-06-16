-- Migration 0079: Hard Block Violations — deterministic compliance gate
-- Seeds the 10 exact violations from spec §11.1 into global_negative_patterns
-- These are NEVER overridable — severity = 'HARD_BLOCK', scope = 'universal'

-- ── Ensure the table exists (created in 0041) ─────────────────────────────────

-- ── Seed the 10 hard-block violations ────────────────────────────────────────

insert into public.global_negative_patterns
  (pattern_id, pattern_code, pattern_text, severity, scope, sector, applies_to, source, notes)
values
  (
    gen_random_uuid(),
    'left_hand_serving',
    'Left hand serving food or beverages to another person',
    'HARD_BLOCK', 'universal', null, 'visual',
    'ogz_spec_v2',
    'Spec §11.1 — Saudi cultural violation. Left hand is considered impure for serving.'
  ),
  (
    gen_random_uuid(),
    'left_hand_exchange',
    'Left hand used for formal object exchange (gifts, documents, business cards)',
    'HARD_BLOCK', 'universal', null, 'visual',
    'ogz_spec_v2',
    'Spec §11.1 — Formal exchanges must use the right hand in Saudi cultural context.'
  ),
  (
    gen_random_uuid(),
    'sole_pointing',
    'Sole of foot pointed directly at a person',
    'HARD_BLOCK', 'universal', null, 'visual',
    'ogz_spec_v2',
    'Spec §11.1 — Highly offensive gesture in Saudi/Arab culture.'
  ),
  (
    gen_random_uuid(),
    'beckoning_palm_up',
    'Palm-up beckoning gesture directed at a person',
    'HARD_BLOCK', 'universal', null, 'visual',
    'ogz_spec_v2',
    'Spec §11.1 — Considered rude or demeaning in Saudi context.'
  ),
  (
    gen_random_uuid(),
    'cross_gender_contact',
    'Physical contact between non-mahrams (unrelated man and woman) in traditional-register content',
    'HARD_BLOCK', 'universal', null, 'visual',
    'ogz_spec_v2',
    'Spec §11.1 — Only applies to traditional/conservative register brands. Modern/youth register brands may be exempt per brand religious_sensitivity setting.'
  ),
  (
    gen_random_uuid(),
    'food_consumption_ramadan_daylight',
    'Food or beverage being consumed during Ramadan daylight hours',
    'HARD_BLOCK', 'universal', null, 'visual',
    'ogz_spec_v2',
    'Spec §11.1 — Seasonal violation. Active only when Ramadan occasion flag is set. Posting food/drink consumption during fasting hours is extremely offensive.'
  ),
  (
    gen_random_uuid(),
    'quran_mishandling',
    'Quran placed under other objects or handled disrespectfully',
    'HARD_BLOCK', 'universal', null, 'visual',
    'ogz_spec_v2',
    'Spec §11.1 — Absolute violation with potential legal implications in KSA.'
  ),
  (
    gen_random_uuid(),
    'index_finger_pointing',
    'Index finger pointing directly at a person',
    'HARD_BLOCK', 'universal', null, 'visual',
    'ogz_spec_v2',
    'Spec §11.1 — Considered aggressive and disrespectful in Saudi/Arab context.'
  ),
  (
    gen_random_uuid(),
    'western_head_shake_no',
    'Western side-to-side head shake to indicate refusal or disagreement',
    'HARD_BLOCK', 'universal', null, 'visual',
    'ogz_spec_v2',
    'Spec §11.1 — In Saudi context, the upward chin tilt means no. Western head-shake creates confusion and cultural misalignment.'
  ),
  (
    gen_random_uuid(),
    'counting_wrong_sequence',
    'Counting gesture starting at the index finger (Western style) instead of the thumb',
    'HARD_BLOCK', 'universal', null, 'visual',
    'ogz_spec_v2',
    'Spec §11.1 — Saudi/Arab counting starts with the thumb. Index-first counting signals cultural inauthenticity.'
  )
on conflict (pattern_code) do update set
  pattern_text = excluded.pattern_text,
  severity     = excluded.severity,
  scope        = excluded.scope,
  notes        = excluded.notes,
  updated_at   = now();

-- ── Add pattern_code unique index if not present ──────────────────────────────
create unique index if not exists idx_global_neg_patterns_code
  on public.global_negative_patterns(pattern_code)
  where pattern_code is not null;

-- ── Add applies_to column if missing (visual | text | both) ──────────────────
alter table public.global_negative_patterns
  add column if not exists applies_to text not null default 'both';

-- ── View: active hard blocks (used by CCO + compliance gate) ─────────────────
create or replace view public.v_hard_block_violations as
select
  pattern_code,
  pattern_text,
  severity,
  scope,
  sector,
  applies_to,
  notes
from public.global_negative_patterns
where severity = 'HARD_BLOCK'
  and scope = 'universal'
order by pattern_code;
