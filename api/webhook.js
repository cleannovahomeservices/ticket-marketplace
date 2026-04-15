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
    case 'payment_intent.succeeded': {
      const pi = event.data.object
      const { data: order } = await supabase
        .from('orders').select('id, status, ticket_id').eq('stripe_payment_intent_id', pi.id).single()
      if (order) {
        await supabase.from('orders').update({
          status: 'paid', updated_at: new Date().toISOString(),
        }).eq('id', order.id)
        await supabase.from('tickets').update({ status: 'completed' }).eq('id', order.ticket_id)
        if (order.id) {
          const { data: full } = await supabase
            .from('orders').select('id, ticket_id, buyer_id, seller_id').eq('id', order.id).single()
          if (full?.id) {
            await supabase.from('messages').insert({
              order_id: full.id,
              ticket_id: full.ticket_id,
              sender_id: full.seller_id,
              receiver_id: full.buyer_id,
              content: '💳 Payment received. The sale is complete.',
            }).catch(() => {})
          }
        }
      }
      break
    }

    case 'payment_intent.payment_failed': {
      const pi = event.data.object
      const { data: order } = await supabase
        .from('orders').select('id').eq('stripe_payment_intent_id', pi.id).single()
      if (order) {
        await supabase.from('orders').update({
          status: 'accepted', updated_at: new Date().toISOString(),
        }).eq('id', order.id)
      }
      break
    }

    case 'payment_intent.canceled': {
      const pi = event.data.object
      const { data: order } = await supabase
        .from('orders').select('id, ticket_id, status').eq('stripe_payment_intent_id', pi.id).single()
      if (order && order.status !== 'paid') {
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
