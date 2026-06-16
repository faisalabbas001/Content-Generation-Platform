# Incident — Weavy down

## Symptoms
- N8N-V01 executions failing with timeout / 5xx.
- qa_review_queue backlog rising.

## Mitigation
1. Confirm Weavy status (status.weavy.ai).
2. Enable fallback image model via env (`WEAVY_FALLBACK=nano_banana_direct`).
3. N8N-V01 continues to hold affected posts in QA queue; batch is never failed wholesale.
4. Post-incident: clear held posts once Weavy recovers.

