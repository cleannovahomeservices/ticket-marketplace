import { stripe, getSupabaseAdmin, getAuthUser, parseBody, json, CORS } from './_utils.js'

export default async function handler(req, res) {
  // OPTIONS preflight
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  if (req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return }

  const user = await getAuthUser(req)
  if (!user) { json(res, 401, { error: 'Unauthorized' }); return }

  const { ticket_id } = await parseBody(req)
  if (!ticket_id) { json(res, 400, { error: 'ticket_id required' }); return }

  const supabase = getSupabaseAdmin()

  // Fetch ticket + seller
  const { data: ticket, error: tErr } = await supabase
    .from('tickets').select('*, profiles(stripe_account_id)').eq('id', ticket_id).single()

  if (tErr || !ticket) { json(res, 404, { error: 'Ticket not found' }); return }
  if (ticket.status !== 'active') { json(res, 400, { error: 'Ticket is not available' }); return }
  if (ticket.seller_id === user.id) { json(res, 400, { error: 'Cannot buy your own ticket' }); return }

  const sellerStripeId = ticket.profiles?.stripe_account_id
  if (!sellerStripeId) { json(res, 400, { error: 'Seller has not set up payouts yet' }); return }

  const amountCents = Math.round(Number(ticket.price) * 100)

  // Platform fee: 5%
  const platformFee = Math.round(amountCents * 0.05)

  // Create PaymentIntent with manual capture + transfer to seller
  let paymentIntent
  try {
    paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      payment_method_types: ['card'],
      capture_method: 'manual',
      transfer_data: { destination: sellerStripeId },
      application_fee_amount: platformFee,
      metadata: {
        ticket_id,
        buyer_id: user.id,
        seller_id: ticket.seller_id,
      },
    })
  } catch (err) {
    json(res, 500, { error: err.message }); return
  }

  // Create order in Supabase
  const { data: order, error: oErr } = await supabase.from('orders').insert({
    ticket_id,
    buyer_id: user.id,
    seller_id: ticket.seller_id,
    price: ticket.price,
    status: 'pending_review',
    stripe_payment_intent_id: paymentIntent.id,
  }).select().single()

  if (oErr) {
    // Roll back: cancel the PaymentIntent
    await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {})
    json(res, 500, { error: oErr.message }); return
  }

  // Mark ticket as pending
  await supabase.from('tickets').update({ status: 'pending' }).eq('id', ticket_id)

  json(res, 200, { client_secret: paymentIntent.client_secret, order_id: order.id })
}
