import { stripe, getSupabaseAdmin, requireUser, parseBody, json, CORS } from './_utils.js'

// Seller accepts a pending order. Creates a platform-controlled
// manual-capture PaymentIntent (no on_behalf_of / transfer_data — the
// seller does NOT need card_payments capability; the transfer to the
// seller happens in admin-approve.js via stripe.transfers.create()).
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  if (req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return }

  const { user, reason } = await requireUser(req)
  if (!user) { json(res, 401, { error: 'Unauthorized', reason }); return }

  const { order_id } = await parseBody(req)
  if (!order_id) { json(res, 400, { error: 'order_id required' }); return }

  const supabase = getSupabaseAdmin()

  const { data: order, error: oErr } = await supabase
    .from('orders').select('*').eq('id', order_id).single()
  if (oErr || !order) { json(res, 404, { error: 'Order not found' }); return }
  if (order.seller_id !== user.id) { json(res, 403, { error: 'Only the seller can accept this order' }); return }
  if (order.status !== 'pending_payment') { json(res, 400, { error: `Order is ${order.status}, cannot accept` }); return }

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
    })
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

  await supabase.from('tickets').update({ status: 'pending' }).eq('id', order.ticket_id)

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
  json(res, 200, { success: true, order_id: order.id })
}
