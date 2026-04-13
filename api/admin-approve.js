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

  // Fetch order
  const { data: order } = await supabase
    .from('orders').select('*').eq('id', order_id).single()

  if (!order) { json(res, 404, { error: 'Order not found' }); return }
  if (order.status !== 'pending_review') { json(res, 400, { error: 'Order is not in pending_review status' }); return }
  if (!order.stripe_payment_intent_id) { json(res, 400, { error: 'No payment intent on this order' }); return }

  try {
    // Capture the held payment (transfer_data was set at creation so transfer happens automatically)
    await stripe.paymentIntents.capture(order.stripe_payment_intent_id)
  } catch (err) {
    json(res, 500, { error: `Capture failed: ${err.message}` }); return
  }

  // Update order + ticket
  await supabase.from('orders').update({ status: 'completed' }).eq('id', order_id)
  await supabase.from('tickets').update({ status: 'completed' }).eq('id', order.ticket_id)

  json(res, 200, { success: true })
}
