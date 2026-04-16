import { stripe, getSupabaseAdmin, requireUser, parseBody, json, CORS } from './_utils.js'

// Seller-only rejection of an order.
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
  if (order.seller_id !== user.id) {
    json(res, 403, { error: 'Only the seller can reject this order' }); return
  }
  if (order.status !== 'pending_payment') {
    json(res, 400, { error: `Order is ${order.status}, cannot reject` }); return
  }

  if (order.stripe_payment_intent_id) {
    try { await stripe.paymentIntents.cancel(order.stripe_payment_intent_id) } catch { /* already resolved */ }
  }

  const { error: upErr } = await supabase.from('orders').update({
    status: 'rejected', updated_at: new Date().toISOString(),
  }).eq('id', order.id)
  if (upErr) { json(res, 500, { error: upErr.message }); return }

  // Free the ticket if nothing else is active on it.
  const { data: remaining } = await supabase
    .from('orders').select('id').eq('ticket_id', order.ticket_id).in('status', ['pending_payment','paid_pending_ticket','pending_admin_review','completed'])
  if (!remaining || remaining.length === 0) {
    await supabase.from('tickets')
      .update({ status: 'active', reserved_by: null })
      .eq('id', order.ticket_id)
  }

  if (order.id) {
    await supabase.from('messages').insert({
      order_id: order.id,
      ticket_id: order.ticket_id,
      sender_id: user.id,
      receiver_id: order.buyer_id,
      content: '❌ Seller rejected this offer.',
    })
  }

  json(res, 200, { success: true })
}
