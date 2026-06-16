-- OpenClaw — 0118_admin_regen_visual_score
-- Why: B03 now runs visual-qc after V01 generates the image for regenerations.
-- The score and issues need to be stored on the draft row so admins can see
-- image quality before deciding to approve or reject.

alter table public.admin_regenerations
  add column if not exists visual_score   float  default null,
  add column if not exists visual_issues  jsonb  default null;

comment on column public.admin_regenerations.visual_score  is
  'GPT-4o vision score (0-100) from visual-qc run post-regeneration. NULL = not yet scored. 0 = hard cultural block.';
comment on column public.admin_regenerations.visual_issues is
  'Structured visual issues array from visual-qc: [{code, label, severity, detail?}]. NULL until scored.';
