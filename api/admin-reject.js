import { stripe, getSupabaseAdmin, requireAdmin, parseBody, json, CORS } from './_utils.js'

// Admin-only. Cancels the uncaptured PaymentIntent (or refunds if it was
// already captured for any reason), transitions the order to `rejected`,
// and frees the ticket listing.
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
  if (!['paid_pending_ticket', 'pending_admin_review'].includes(order.status)) {
    json(res, 400, { error: `Order is ${order.status}, cannot reject` }); return
  }

  if (order.stripe_payment_intent_id) {
    try {
      await stripe.paymentIntents.cancel(order.stripe_payment_intent_id)
    } catch {
      // PI may already be captured in edge cases — refund instead.
      try {
        await stripe.refunds.create({ payment_intent: order.stripe_payment_intent_id })
      } catch (err2) {
        json(res, 500, { error: `Cancel/refund failed: ${err2.message}` }); return
      }
    }
  }

  await supabase.from('orders').update({
    status: 'rejected', updated_at: new Date().toISOString(),
  }).eq('id', order_id)
  await supabase.from('tickets').update({ status: 'active' }).eq('id', order.ticket_id)

  await supabase.from('messages').insert({
    order_id: order.id,
    ticket_id: order.ticket_id,
    sender_id: user.id,
    receiver_id: order.buyer_id,
    content: '❌ Admin rejected this ticket. You will be refunded.',
  }).catch(() => {})

  json(res, 200, { success: true })
}
