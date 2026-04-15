import { stripe, getSupabaseAdmin, getAuthUser, parseBody, json, CORS } from './_utils.js'

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
  if (order.seller_id !== user.id) { json(res, 403, { error: 'Only the seller can accept this order' }); return }
  if (order.status !== 'pending') { json(res, 400, { error: `Order is ${order.status}, cannot accept` }); return }

  const { data: seller } = await supabase
    .from('profiles').select('stripe_account_id').eq('id', order.seller_id).single()
  const sellerStripeId = seller?.stripe_account_id
  if (!sellerStripeId) {
    json(res, 400, { error: 'Seller must complete payout setup before accepting' }); return
  }

  let account
  try { account = await stripe.accounts.retrieve(sellerStripeId) }
  catch (err) { json(res, 500, { error: `Stripe account lookup failed: ${err.message}` }); return }

  if (!account.charges_enabled || !account.payouts_enabled) {
    json(res, 400, { error: 'Seller must complete payout setup before accepting' }); return
  }

  const amountCents = Math.round(Number(order.price) * 100)
  const platformFee = Math.round(amountCents * 0.05)

  let paymentIntent
  try {
    paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      payment_method_types: ['card'],
      transfer_data: { destination: sellerStripeId },
      application_fee_amount: platformFee,
      metadata: {
        order_id: order.id,
        ticket_id: order.ticket_id,
        buyer_id: order.buyer_id,
        seller_id: order.seller_id,
      },
    })
  } catch (err) { json(res, 500, { error: err.message }); return }

  const { error: uErr } = await supabase.from('orders').update({
    status: 'accepted',
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
    .eq('status', 'pending')
    .neq('id', order.id)

  await supabase.from('tickets').update({ status: 'pending' }).eq('id', order.ticket_id)

  // Post a system chat message — order.id is guaranteed by the fetch above.
  if (order.id) {
    await supabase.from('messages').insert({
      order_id: order.id,
      ticket_id: order.ticket_id,
      sender_id: user.id,
      receiver_id: order.buyer_id,
      content: '✅ Offer accepted. Complete the payment to confirm your ticket.',
    })
  }

  json(res, 200, { success: true, order_id: order.id })
}
