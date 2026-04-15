import { stripe, getSupabaseAdmin, requireUser, parseBody, json, CORS } from './_utils.js'

// Buyer-only. Lazily creates the manual-capture PaymentIntent for a
// pending_payment order (with the 5% platform fee routed via
// transfer_data to the seller's Connect account) and returns the
// client_secret so the browser can confirm the card payment.
//
// If a usable PI already exists, we reuse it. If the prior PI is in a
// state that can no longer be confirmed (captured, cancelled, succeeded,
// etc.), we transparently create a fresh one — otherwise the buyer
// would see "Processing…" forever because stripe.js can't re-confirm.
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  if (req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return }

  const { user, reason } = await requireUser(req)
  if (!user) { json(res, 401, { error: 'Unauthorized', reason }); return }

  const { order_id } = await parseBody(req)
  if (!order_id) { json(res, 400, { error: 'order_id required' }); return }

  const supabase = getSupabaseAdmin()
  const { data: order, error } = await supabase
    .from('orders').select('*').eq('id', order_id).single()
  if (error || !order) { json(res, 404, { error: 'Order not found' }); return }
  if (order.buyer_id !== user.id) { json(res, 403, { error: 'Not allowed' }); return }
  if (order.status !== 'pending_payment') {
    json(res, 400, { error: `Order is ${order.status}, cannot pay` }); return
  }

  // PI status that still allows client-side confirmation.
  const REUSABLE = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action'])

  // Already created → only reuse if it can still be confirmed.
  if (order.stripe_payment_intent_id) {
    try {
      const existing = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id)
      console.log(`[create-pi] existing pi=${existing.id} status=${existing.status}`)

      if (REUSABLE.has(existing.status)) {
        console.log(`[create-pi] ↻ reusing pi=${existing.id} for order=${order.id}`)
        json(res, 200, { client_secret: existing.client_secret, order_id: order.id }); return
      }

      // Already paid (manual-capture authorized OR fully captured) —
      // client should jump straight to success without re-confirming.
      if (['requires_capture', 'succeeded', 'processing'].includes(existing.status)) {
        console.log(`[create-pi] pi=${existing.id} already authorized/captured, signaling already_paid`)
        json(res, 200, { already_paid: true, order_id: order.id, pi_status: existing.status }); return
      }

      // Cancelled or in a terminal dead state → mint a new one below.
      console.log(`[create-pi] pi=${existing.id} is ${existing.status}, creating a replacement`)
    } catch (err) {
      console.error(`[create-pi] retrieve failed for order=${order.id}:`, err.message)
      // Fall through to create a new one.
    }
  }

  // Need the seller's Stripe Connect destination account.
  const { data: seller } = await supabase
    .from('profiles').select('stripe_account_id').eq('id', order.seller_id).single()
  const sellerStripeId = seller?.stripe_account_id
  if (!sellerStripeId) {
    json(res, 400, { error: 'Seller has not connected a payout account yet.', code: 'stripe_not_connected' }); return
  }

  let account
  try { account = await stripe.accounts.retrieve(sellerStripeId) }
  catch (err) { json(res, 500, { error: `Stripe account lookup failed: ${err.message}` }); return }

  if (!account.charges_enabled || !account.payouts_enabled) {
    json(res, 400, { error: 'Seller payout account is not yet ready.', code: 'stripe_not_connected' }); return
  }

  const amountCents = Math.round(Number(order.price) * 100)
  const platformFee = Math.round(amountCents * 0.05)

  let pi
  try {
    pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      payment_method_types: ['card'],
      capture_method: 'manual',
      // on_behalf_of makes the charge appear on the connected account's
      // dashboard and fixes cross-currency/3DS edge cases where
      // transfer_data alone would silently fail authentication.
      on_behalf_of: sellerStripeId,
      transfer_data: { destination: sellerStripeId },
      application_fee_amount: platformFee,
      metadata: {
        order_id: order.id,
        ticket_id: order.ticket_id,
        buyer_id: order.buyer_id,
        seller_id: order.seller_id,
      },
    })
  } catch (err) {
    console.error(`[create-pi] create failed for order=${order.id}:`, err.message)
    json(res, 500, { error: err.message }); return
  }

  const { error: uErr } = await supabase.from('orders').update({
    stripe_payment_intent_id: pi.id,
    updated_at: new Date().toISOString(),
  }).eq('id', order.id)
  if (uErr) {
    console.error(`[create-pi] failed to link pi=${pi.id} to order=${order.id}:`, uErr.message)
    await stripe.paymentIntents.cancel(pi.id).catch(() => {})
    json(res, 500, { error: uErr.message }); return
  }

  console.log(`[create-pi] ✓ linked pi=${pi.id} → order=${order.id}  amount=${amountCents}  fee=${platformFee}  seller=${sellerStripeId}`)
  json(res, 200, { client_secret: pi.client_secret, order_id: order.id })
}
