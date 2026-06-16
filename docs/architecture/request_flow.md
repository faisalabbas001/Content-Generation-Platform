# Request flow — every generation event (Doc §3.2)

Applies to N8N-A01 (batch) and N8N-A02 (on-demand). The chain is identical; only trigger and priority differ.

TRIGGER → n8n → CEO (routing) → COO (CaptionContext) → DeepSeek (20 captions) → CCO (QC) → CEO (confidence gate + 11 override triggers) → N8N-V01 (per non-held post) → assemble calendar → Resend email → CEO (batch completion) → Memory Controller (nominations).

