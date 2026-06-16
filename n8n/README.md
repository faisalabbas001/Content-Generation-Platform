# n8n Workflows

All 11 workflows (Doc §5). Exported monthly as JSON under `flows/` (M3 requirement).

| Flow ID  | Trigger                 | Purpose                                           |
|----------|-------------------------|---------------------------------------------------|
| N8N-A01  | Cron (shard 23:00 AST)  | Batch calendar generation — full AI chain         |
| N8N-A02  | Webhook                 | On-demand single-post generation                  |
| N8N-A03  | Webhook                 | Onboarding auto-extraction + BrandDNA v0.1        |
| N8N-A04  | Webhook                 | Brand correction → Memory Controller nomination   |
| N8N-A05  | Cron (1st of month)     | Growth — upgrade readiness alerts                 |
| N8N-B03  | Webhook                 | Revision request                                  |
| N8N-V01  | Sub-flow                | Weavy visual chain + Sharp Arabic overlay         |
| N8N-D02  | Cron (1st of month)     | BrandDNA maintenance + CIO trigger (Phase 2)      |
| N8N-S01  | Cron (15 min)           | Pipeline health check                             |
| N8N-S02  | Event                   | Cost ceiling alerts 70/90/100%                    |
| N8N-S03  | Event                   | Anomaly router                                    |

Every flow must have: trigger + credential ref + error branch (2× retry + backoff) + usage_logs write + N8N-S03 on final fail.

