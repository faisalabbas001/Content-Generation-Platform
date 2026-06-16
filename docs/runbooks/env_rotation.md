# Env variable rotation runbook (M3 requirement — Doc §11.3)

For each env var: current holder, rotation steps, who to notify, rollback.

1. **ANTHROPIC_API_KEY**
   - Generate new key in Anthropic console.
   - Update Vercel env; redeploy.
   - Update n8n credential object.
   - Revoke old key after 24h.
   - Rollback: keep old key active during transition window.

(Repeat for each of the 27 env vars in `.env.example`.)

