import {
  stripe, getSupabaseAdmin, requireUser, parseBody, json, CORS,
  asUuid, idempotencyKey, rateLimit, logAudit,
} from './_utils.js'

// Seller accepts a pending order. Creates a platform-controlled
// manual-capture PaymentIntent (no on_behalf_of / transfer_data — the
// seller does NOT need card_payments capability; the transfer to the
// seller happens in admin-approve.js via stripe.transfers.create()).
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  if (req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return }

  const { user, reason } = await requireUser(req)
  if (!user) { json(res, 401, { error: 'Unauthorized', reason }); return }

  let orderId
  try {
    const body = await parseBody(req)
    orderId = asUuid(body.order_id, 'order_id')
  } catch (err) { json(res, err.statusCode || 400, { error: err.message }); return }

  const rl = await rateLimit({ subject: user.id, action: 'accept_order', limit: 30, windowSeconds: 60 })
  if (!rl.allowed) { json(res, 429, { error: 'Too many accepts — slow down.' }); return }

  const supabase = getSupabaseAdmin()

  const { data: order, error: oErr } = await supabase
    .from('orders').select('*').eq('id', orderId).single()
  if (oErr || !order) { json(res, 404, { error: 'Order not found' }); return }
  if (order.seller_id !== user.id) { json(res, 403, { error: 'Only the seller can accept this order' }); return }
  if (order.status !== 'pending_seller') { json(res, 400, { error: `Order is ${order.status}, cannot accept` }); return }

  const amountCents = Math.round(Number(order.price) * 100)

  let paymentIntent
  try {
    paymentIntent = await stripe.paymentIntents.create({
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
    }, { idempotencyKey: idempotencyKey('pi_accept', order.id, amountCents) })
  } catch (err) {
    console.error(`[accept-order] PI create failed:`, err.message)
    json(res, 500, { error: err.message }); return
  }

  const { error: uErr } = await supabase.from('orders').update({
    status: 'pending_payment',
    stripe_payment_intent_id: paymentIntent.id,
    updated_at: new Date().toISOString(),
  }).eq('id', order.id)

  if (uErr) {
    await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {})
    json(res, 500, { error: uErr.message }); return
  }

  // Reject any other pending orders for the same ticket so only one buyer proceeds.
  await supabase.from('orders')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('ticket_id', order.ticket_id)
    .eq('status', 'pending_payment')
    .neq('id', order.id)

  // Reserve the ticket for this buyer (atomic — blocks double-selling).
  const { data: reserved } = await supabase.from('tickets')
    .update({ status: 'reserved', reserved_by: order.buyer_id })
    .eq('id', order.ticket_id)
    .or(`status.eq.active,and(status.eq.reserved,reserved_by.eq.${order.buyer_id})`)
    .select('id')
  if (!reserved || reserved.length === 0) {
    await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {})
    await supabase.from('orders').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', order.id)
    json(res, 409, { error: 'This ticket is already reserved by another buyer.' }); return
  }

  if (order.id) {
    await supabase.from('messages').insert({
      order_id: order.id,
      ticket_id: order.ticket_id,
      sender_id: user.id,
      receiver_id: order.buyer_id,
      content: '✅ Offer accepted. Complete the payment to confirm your ticket.',
    })
  }

  console.log(`[accept-order] ✓ order=${order.id} accepted, pi=${paymentIntent.id}`)
  await logAudit({
    userId: user.id,
    action: 'order_accept',
    targetType: 'order',
    targetId: order.id,
    metadata: { pi_id: paymentIntent.id, amount_cents: amountCents },
    req,
  })
  json(res, 200, { success: true, order_id: order.id })
}
