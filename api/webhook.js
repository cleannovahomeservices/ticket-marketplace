import { stripe, getSupabaseAdmin, getRawBody, json } from './_utils.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return }

  let rawBody
  try { rawBody = await getRawBody(req) } catch {
    json(res, 400, { error: 'Cannot read body' }); return
  }

  const sig = req.headers['stripe-signature']
  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    json(res, 400, { error: `Webhook error: ${err.message}` }); return
  }

  const supabase = getSupabaseAdmin()

  switch (event.type) {
    // With capture_method='manual', a successful buyer confirmation fires
    // `amount_capturable_updated` first (authorization held but not yet
    // captured). That's the signal the buyer has paid — the seller must
    // now upload the ticket and the admin must approve before capture.
    case 'payment_intent.amount_capturable_updated': {
      const pi = event.data.object
      const { data: order } = await supabase
        .from('orders').select('id, ticket_id, buyer_id, seller_id, status')
        .eq('stripe_payment_intent_id', pi.id).single()
      if (order && order.status === 'pending_payment') {
        await supabase.from('orders').update({
          status: 'paid_pending_ticket', updated_at: new Date().toISOString(),
        }).eq('id', order.id)
        await supabase.from('messages').insert({
          order_id: order.id,
          ticket_id: order.ticket_id,
          sender_id: order.seller_id,
          receiver_id: order.buyer_id,
          content: '💳 Payment received. Upload the ticket to continue.',
        }).catch(() => {})
      }
      break
    }

    // Fires when capture completes (admin approved). admin-approve.js
    // already transitions the row — this is a safety net so the status
    // never drifts if the DB write failed after capture.
    case 'payment_intent.succeeded': {
      const pi = event.data.object
      const { data: order } = await supabase
        .from('orders').select('id, ticket_id, status')
        .eq('stripe_payment_intent_id', pi.id).single()
      if (order && order.status !== 'completed') {
        await supabase.from('orders').update({
          status: 'completed', updated_at: new Date().toISOString(),
        }).eq('id', order.id)
        await supabase.from('tickets').update({ status: 'completed' }).eq('id', order.ticket_id)
      }
      break
    }

    case 'payment_intent.payment_failed': {
      const pi = event.data.object
      const { data: order } = await supabase
        .from('orders').select('id').eq('stripe_payment_intent_id', pi.id).single()
      if (order) {
        await supabase.from('orders').update({
          status: 'pending_payment', updated_at: new Date().toISOString(),
        }).eq('id', order.id)
      }
      break
    }

    case 'payment_intent.canceled': {
      const pi = event.data.object
      const { data: order } = await supabase
        .from('orders').select('id, ticket_id, status').eq('stripe_payment_intent_id', pi.id).single()
      if (order && order.status !== 'completed') {
        await supabase.from('orders').update({
          status: 'rejected', updated_at: new Date().toISOString(),
        }).eq('id', order.id)
        await supabase.from('tickets').update({ status: 'active' }).eq('id', order.ticket_id)
      }
      break
    }

    case 'account.updated': {
      const account = event.data.object
      if (account.details_submitted) {
        await supabase.from('profiles')
          .update({ stripe_account_id: account.id })
          .eq('stripe_account_id', account.id)
      }
      break
    }

    default:
      console.log(`Unhandled event: ${event.type}`)
  }

  json(res, 200, { received: true })
}
