import { stripe, getSupabaseAdmin, requireUser, parseBody, json, CORS } from './_utils.js'

// Buyer-only. Lazily creates the manual-capture PaymentIntent for a
// pending_payment order (with the 5% platform fee routed via
// transfer_data to the seller's Connect account) and returns the
// client_secret so the browser can confirm the card payment.
//
// If a PI already exists, we just return its client_secret — this makes
// the endpoint idempotent when the checkout modal re-opens.
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

  // Already created → reuse.
  if (order.stripe_payment_intent_id) {
    try {
      const pi = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id)
      json(res, 200, { client_secret: pi.client_secret, order_id: order.id }); return
    } catch (err) {
      json(res, 500, { error: err.message }); return
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
      transfer_data: { destination: sellerStripeId },
      application_fee_amount: platformFee,
      metadata: {
        order_id: order.id,
        ticket_id: order.ticket_id,
        buyer_id: order.buyer_id,
        seller_id: order.seller_id,
      },
    })
  } catch (err) { json(res, 500, { error: err.message }); return }

  const { error: uErr } = await supabase.from('orders').update({
    stripe_payment_intent_id: pi.id,
    updated_at: new Date().toISOString(),
  }).eq('id', order.id)
  if (uErr) {
    await stripe.paymentIntents.cancel(pi.id).catch(() => {})
    json(res, 500, { error: uErr.message }); return
  }

  json(res, 200, { client_secret: pi.client_secret, order_id: order.id })
}
