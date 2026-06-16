import { NextResponse } from 'next/server'
import { adminClient } from '@repo/db/client'

export const runtime = 'nodejs'

/**
 * Stripe webhook — Sprint S6.05.
 * Must verify signature with STRIPE_WEBHOOK_SECRET (SEC-10) before any handling.
 *
 * When fully implemented, install the `stripe` npm package and wire events:
 *
 *   import Stripe from 'stripe'
 *   const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
 *   const event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!)
 *
 * Then handle checkout.session.completed:
 *
 *   case 'checkout.session.completed': {
 *     const session = event.data.object as Stripe.Checkout.Session
 *     const brandId = session.metadata?.brand_id
 *     if (brandId) {
 *       // 1. Update brand tier
 *       await db.from('brand_profiles')
 *         .update({ tier: 'paid_starter' })
 *         .eq('brand_id', brandId)
 *
 *       // 2. Mark any pending marketing offers as converted — prevents the
 *       //    upgrade banner from reappearing if the user upgrades manually
 *       //    before dismissing it.
 *       await markOffersConverted(brandId)
 *     }
 *     break
 *   }
 */
export async function POST() {
  return NextResponse.json({ error: 'not_implemented', sprint: 'S6.05' }, { status: 501 })
}

/**
 * Call this after a brand's tier is updated to paid.
 * Marks any pending monthly_marketing offers as 'converted' so the dashboard
 * banner does not reappear on the next page load.
 */
export async function markOffersConverted(brandId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = adminClient() as any
  const { error } = await db
    .from('brand_performance_log')
    .update({ offer_status: 'converted' })
    .eq('brand_id', brandId)
    .eq('evaluation_type', 'upgrade_readiness')
    .eq('offer_status', 'pending')

  if (error) {
    console.error('[stripe/webhook] markOffersConverted failed:', error)
  }
}
