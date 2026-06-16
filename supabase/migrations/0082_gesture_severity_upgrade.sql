-- 0082_gesture_severity_upgrade.sql
--
-- Upgrade 4 cultural gesture blocks from STRONG/SOFT_WARN to HARD_BLOCK.
-- Doc §11.1 lists all 10 gestures as "never published" violations. The
-- original seed under-classified these four; this migration corrects the
-- live rows so the Compliance Gate actually blocks them.
--
-- The in-code fallback (packages/compliance/src/gestures.ts) was updated in
-- the same PR so the gate is consistent whether it reads from the DB or the
-- in-code constants.

update public.cultural_gesture_blocks
set
  severity   = 'HARD_BLOCK',
  updated_at = now()
where gesture_key in (
  'beckoning_palm_up',
  'index_finger_pointing',
  'western_head_shake_no',
  'counting_wrong_sequence'
);
