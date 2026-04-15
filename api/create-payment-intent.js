import { stripe, getSupabaseAdmin, getAuthUser, parseBody, json, CORS } from './_utils.js'

// Retrieves (or refreshes) the client_secret for an order that the seller
// has already accepted. The PaymentIntent is created at accept time in
// /api/accept-order — this endpoint only exposes its client_secret to the buyer.
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  if (req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return }

  const user = await getAuthUser(req)
  if (!user) { json(res, 401, { error: 'Unauthorized' }); return }

  const { order_id } = await parseBody(req)
  if (!order_id) { json(res, 400, { error: 'order_id required' }); return }

  const supabase = getSupabaseAdmin()
  const { data: order, error } = await supabase
    .from('orders').select('*').eq('id', order_id).single()
  if (error || !order) { json(res, 404, { error: 'Order not found' }); return }
  if (order.buyer_id !== user.id) { json(res, 403, { error: 'Not allowed' }); return }
  if (order.status !== 'accepted') { json(res, 400, { error: `Order is ${order.status}, cannot pay` }); return }
  if (!order.stripe_payment_intent_id) { json(res, 500, { error: 'No payment intent on this order' }); return }

  let pi
  try { pi = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id) }
  catch (err) { json(res, 500, { error: err.message }); return }

  json(res, 200, { client_secret: pi.client_secret, order_id: order.id })
}
