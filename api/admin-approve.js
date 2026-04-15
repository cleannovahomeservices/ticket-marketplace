import { stripe, getSupabaseAdmin, requireAdmin, parseBody, json, CORS } from './_utils.js'

// Admin-only. Captures the authorized PaymentIntent, transitions the
// order to `completed`, and releases the ticket file to the buyer.
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  if (req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return }

  const { user, profile, reason } = await requireAdmin(req)
  if (!user) { json(res, 401, { error: 'Unauthorized', reason }); return }
  if (!profile) { json(res, 403, { error: 'Forbidden', reason }); return }

  const { order_id } = await parseBody(req)
  if (!order_id) { json(res, 400, { error: 'order_id required' }); return }

  const supabase = getSupabaseAdmin()
  const { data: order } = await supabase
    .from('orders').select('*').eq('id', order_id).single()
  if (!order) { json(res, 404, { error: 'Order not found' }); return }
  if (order.status !== 'pending_admin_review') {
    json(res, 400, { error: `Order is ${order.status}, cannot approve` }); return
  }
  if (!order.stripe_payment_intent_id) {
    json(res, 400, { error: 'No payment intent on this order' }); return
  }

  try {
    await stripe.paymentIntents.capture(order.stripe_payment_intent_id)
  } catch (err) {
    json(res, 500, { error: `Capture failed: ${err.message}` }); return
  }

  await supabase.from('orders').update({
    status: 'completed', updated_at: new Date().toISOString(),
  }).eq('id', order_id)
  await supabase.from('tickets').update({ status: 'completed' }).eq('id', order.ticket_id)

  await supabase.from('messages').insert({
    order_id: order.id,
    ticket_id: order.ticket_id,
    sender_id: user.id,
    receiver_id: order.buyer_id,
    content: '✅ Admin approved the ticket. Your QR is now available.',
  }).catch(() => {})

  json(res, 200, { success: true })
}
