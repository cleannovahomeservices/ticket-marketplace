import { stripe, getSupabaseAdmin, requireUser, parseBody, json, CORS } from './_utils.js'

// Called by the client right after stripe.confirmPayment() resolves
// successfully. Defensive: does NOT trust the client — retrieves the
// PaymentIntent directly from Stripe and only advances the order when
// the PI is actually authorized/captured. This removes the hard
// dependency on webhooks being configured correctly, so an order can
// never be stuck at `pending_payment` after a successful card charge.
// Idempotent: if the webhook already transitioned the order, this is a
// no-op.
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
  if (!order.stripe_payment_intent_id) {
    json(res, 400, { error: 'No payment intent on this order' }); return
  }

  // Verify authoritatively against Stripe — never trust the client's
  // claim that the payment succeeded.
  let pi
  try {
    pi = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id)
  } catch (err) {
    console.error(`[confirm-payment] PI retrieve failed:`, err.message)
    json(res, 500, { error: err.message }); return
  }

  console.log(`[confirm-payment] order=${order.id} pi=${pi.id} pi_status=${pi.status} order_status=${order.status}`)

  const paidStatuses = ['requires_capture', 'succeeded', 'processing']
  if (!paidStatuses.includes(pi.status)) {
    json(res, 400, {
      error: `Payment is not confirmed yet (pi.status=${pi.status})`,
      pi_status: pi.status,
    }); return
  }

  // Already advanced by the webhook? Nothing to do.
  if (order.status !== 'pending_payment') {
    console.log(`[confirm-payment] order already in ${order.status}, no-op`)
    json(res, 200, { success: true, order_status: order.status, already_processed: true }); return
  }

  const nextStatus = pi.status === 'succeeded' ? 'completed' : 'paid_pending_ticket'

  const { error: upErr } = await supabase.from('orders').update({
    status: nextStatus,
    updated_at: new Date().toISOString(),
  }).eq('id', order.id).eq('status', 'pending_payment') // race-safe
  if (upErr) {
    console.error(`[confirm-payment] order update failed:`, upErr.message)
    json(res, 500, { error: upErr.message }); return
  }

  console.log(`[confirm-payment] ✓ order=${order.id} ${order.status} → ${nextStatus}`)

  await supabase.from('messages').insert({
    order_id: order.id,
    ticket_id: order.ticket_id,
    sender_id: order.seller_id,
    receiver_id: order.buyer_id,
    content: '💳 Payment received. Upload the ticket to continue.',
  }).catch(err => console.error('[confirm-payment] message insert failed:', err.message))

  json(res, 200, { success: true, order_status: nextStatus })
}
