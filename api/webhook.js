import { stripe, getSupabaseAdmin, getRawBody, json } from './_utils.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return }

  let rawBody
  try { rawBody = await getRawBody(req) } catch (err) {
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
      // Payment was authorized (manual capture). Mark ticket as pending_review.
      const pi = event.data.object
      const { data: order } = await supabase
        .from('orders').select('id, status, ticket_id').eq('stripe_payment_intent_id', pi.id).single()
      if (order) {
        if (order.status !== 'pending_review') {
          await supabase.from('orders').update({ status: 'pending_review' }).eq('id', order.id)
        }
        // Only transition the ticket if it's still in the reservation state
        await supabase.from('tickets')
          .update({ status: 'pending_review' })
          .eq('id', order.ticket_id)
          .in('status', ['pending', 'active'])
      }
      break
    }

    case 'payment_intent.payment_failed': {
      const pi = event.data.object
      const { data: order } = await supabase
        .from('orders').select('id, ticket_id').eq('stripe_payment_intent_id', pi.id).single()
      if (order) {
        await supabase.from('orders').update({ status: 'failed' }).eq('id', order.id)
        await supabase.from('tickets').update({ status: 'active' }).eq('id', order.ticket_id)
      }
      break
    }

    case 'payment_intent.canceled': {
      // Handled by admin-reject but good to have as fallback
      const pi = event.data.object
      const { data: order } = await supabase
        .from('orders').select('id, ticket_id, status').eq('stripe_payment_intent_id', pi.id).single()
      if (order && order.status === 'pending_review') {
        await supabase.from('orders').update({ status: 'rejected' }).eq('id', order.id)
        await supabase.from('tickets').update({ status: 'active' }).eq('id', order.ticket_id)
      }
      break
    }

    case 'account.updated': {
      // Stripe Connect seller onboarding status update
      const account = event.data.object
      if (account.details_submitted) {
        await supabase.from('profiles')
          .update({ stripe_account_id: account.id })
          .eq('stripe_account_id', account.id)
      }
      break
    }

    default:
      // Unhandled event — log and return 200 to avoid Stripe retries
      console.log(`Unhandled event: ${event.type}`)
  }

  json(res, 200, { received: true })
}
