import { stripe, getSupabaseAdmin, requireUser, parseBody, json, CORS } from './_utils.js'

// Buyer-only. Lazily creates a platform-controlled manual-capture
// PaymentIntent for a pending_payment order. Funds are charged to the
// PLATFORM account and held — no on_behalf_of / transfer_data here, so
// the seller does NOT need `card_payments` capability enabled.
// The seller is paid via a separate stripe.transfers.create() call in
// admin-approve.js after the admin verifies the uploaded ticket.
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

  // ── Atomically reserve the ticket for this buyer ──
  // Succeeds only if the ticket is `active` or already `reserved` by the
  // same buyer (allows the buyer to retry their own payment). Any other
  // state — reserved by someone else, sold, completed — blocks the sale
  // and prevents double-selling.
  const { data: reserved, error: resErr } = await supabase
    .from('tickets')
    .update({ status: 'reserved', reserved_by: order.buyer_id })
    .eq('id', order.ticket_id)
    .or(`status.eq.active,and(status.eq.reserved,reserved_by.eq.${order.buyer_id})`)
    .select('id')
  if (resErr) {
    console.error(`[create-pi] reserve failed for ticket=${order.ticket_id}:`, resErr.message)
    json(res, 500, { error: resErr.message }); return
  }
  if (!reserved || reserved.length === 0) {
    console.warn(`[create-pi] ticket=${order.ticket_id} not available for buyer=${order.buyer_id}`)
    json(res, 409, { error: 'This ticket is no longer available.' }); return
  }

  const REUSABLE = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action'])

  if (order.stripe_payment_intent_id) {
    try {
      const existing = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id)
      console.log(`[create-pi] existing pi=${existing.id} status=${existing.status}`)

      if (REUSABLE.has(existing.status)) {
        console.log(`[create-pi] ↻ reusing pi=${existing.id} for order=${order.id}`)
        json(res, 200, { client_secret: existing.client_secret, order_id: order.id }); return
      }

      if (['requires_capture', 'succeeded', 'processing'].includes(existing.status)) {
        console.log(`[create-pi] pi=${existing.id} already authorized/captured, signaling already_paid`)
        json(res, 200, { already_paid: true, order_id: order.id, pi_status: existing.status }); return
      }

      console.log(`[create-pi] pi=${existing.id} is ${existing.status}, creating a replacement`)
    } catch (err) {
      console.error(`[create-pi] retrieve failed for order=${order.id}:`, err.message)
    }
  }

  const amountCents = Math.round(Number(order.price) * 100)

  let pi
  try {
    pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      payment_method_types: ['card'],
      capture_method: 'manual',
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

  console.log(`[create-pi] ✓ linked pi=${pi.id} → order=${order.id}  amount=${amountCents}  (platform-held, no transfer_data)`)
  json(res, 200, { client_secret: pi.client_secret, order_id: order.id })
}
