import { stripe, getSupabaseAdmin, getAuthUser, parseBody, json, CORS } from './_utils.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  if (req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return }

  const user = await getAuthUser(req)
  if (!user) { json(res, 401, { error: 'Unauthorized' }); return }

  const supabase = getSupabaseAdmin()

  // Verify admin
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) { json(res, 403, { error: 'Forbidden' }); return }

  const { order_id } = await parseBody(req)
  if (!order_id) { json(res, 400, { error: 'order_id required' }); return }

  const { data: order } = await supabase
    .from('orders').select('*').eq('id', order_id).single()

  if (!order) { json(res, 404, { error: 'Order not found' }); return }
  if (!['pending', 'accepted'].includes(order.status)) {
    json(res, 400, { error: `Order is ${order.status}, cannot reject` }); return
  }
  if (!order.stripe_payment_intent_id) { json(res, 400, { error: 'No payment intent on this order' }); return }

  try {
    // Try to refund the payment intent (works if already captured)
    await stripe.refunds.create({ payment_intent: order.stripe_payment_intent_id })
  } catch (err) {
    // If the PI is still in manual-capture state (not yet captured),
    // refunds aren't possible — cancel it to release the authorization.
    try {
      await stripe.paymentIntents.cancel(order.stripe_payment_intent_id)
    } catch (cancelErr) {
      json(res, 500, { error: `Refund failed: ${err.message}; cancel failed: ${cancelErr.message}` }); return
    }
  }

  // Mark order rejected, ticket refunded
  await supabase.from('orders').update({ status: 'rejected' }).eq('id', order_id)
  await supabase.from('tickets').update({ status: 'refunded' }).eq('id', order.ticket_id)

  json(res, 200, { success: true })
}
