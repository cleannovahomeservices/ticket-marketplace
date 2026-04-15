import { stripe, getSupabaseAdmin, getAuthUser, parseBody, json, CORS } from './_utils.js'

// Buyer-only cancellation of an order. Sets status to 'rejected'
// (the allow-list contains no separate 'cancelled' value).
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  if (req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return }

  const user = await getAuthUser(req)
  if (!user) { json(res, 401, { error: 'Unauthorized' }); return }

  const { order_id } = await parseBody(req)
  if (!order_id) { json(res, 400, { error: 'order_id required' }); return }

  const supabase = getSupabaseAdmin()
  const { data: order, error: oErr } = await supabase
    .from('orders').select('*').eq('id', order_id).single()
  if (oErr || !order) { json(res, 404, { error: 'Order not found' }); return }
  if (order.buyer_id !== user.id) {
    json(res, 403, { error: 'Only the buyer can cancel this order' }); return
  }
  if (!['pending', 'accepted'].includes(order.status)) {
    json(res, 400, { error: `Order is ${order.status}, cannot cancel` }); return
  }

  if (order.status === 'accepted' && order.stripe_payment_intent_id) {
    try { await stripe.paymentIntents.cancel(order.stripe_payment_intent_id) } catch { /* already resolved */ }
  }

  const { error: upErr } = await supabase.from('orders').update({
    status: 'rejected', updated_at: new Date().toISOString(),
  }).eq('id', order.id)
  if (upErr) { json(res, 500, { error: upErr.message }); return }

  const { data: remaining } = await supabase
    .from('orders').select('id').eq('ticket_id', order.ticket_id).in('status', ['pending','accepted','paid'])
  if (!remaining || remaining.length === 0) {
    await supabase.from('tickets').update({ status: 'active' }).eq('id', order.ticket_id)
  }

  if (order.id) {
    await supabase.from('messages').insert({
      order_id: order.id,
      ticket_id: order.ticket_id,
      sender_id: user.id,
      receiver_id: order.seller_id,
      content: '❌ Buyer canceled this order.',
    })
  }

  json(res, 200, { success: true })
}
