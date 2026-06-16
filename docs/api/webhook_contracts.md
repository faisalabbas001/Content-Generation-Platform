# Webhook contracts (n8n ↔ Next.js)

All webhooks validated with `N8N_WEBHOOK_SECRET` header.

## POST /api/webhooks/n8n
Status callbacks from n8n flows.

## POST /api/webhooks/stripe
Stripe checkout + subscription events. Signature verified with `STRIPE_WEBHOOK_SECRET` (SEC-10).

## POST /api/webhooks/correction
Client brand correction — forwards to N8N-A04.

