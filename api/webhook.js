import { stripe, getSupabaseAdmin, getRawBody, json } from './_utils.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return }

  let rawBody
  try { rawBody = await getRawBody(req) } catch {
    console.error('[webhook] failed to read raw body')
    json(res, 400, { error: 'Cannot read body' }); return
  }

  const sig = req.headers['stripe-signature']
  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('[webhook] signature verification failed:', err.message)
    json(res, 400, { error: `Webhook error: ${err.message}` }); return
  }

  console.log(`[webhook] ▶ triggered  event=${event.id}  type=${event.type}  livemode=${event.livemode}`)

  const supabase = getSupabaseAdmin()

  async function findOrderByPi(piId, select = 'id, ticket_id, buyer_id, seller_id, status') {
    const { data, error } = await supabase
      .from('orders').select(select).eq('stripe_payment_intent_id', piId).maybeSingle()
    if (error) {
      console.error(`[webhook] order lookup failed for pi=${piId}:`, error.message)
      return null
    }
    if (!data) {
      console.warn(`[webhook] no order matches pi=${piId} — ignoring`)
      return null
    }
    return data
  }

  async function setStatus(order, next, extra = {}) {
    const { error } = await supabase.from('orders').update({
      status: next, updated_at: new Date().toISOString(), ...extra,
    }).eq('id', order.id)
    if (error) {
      console.error(`[webhook] FAILED to update order=${order.id} ${order.status}→${next}:`, error.message)
      return false
    }
    console.log(`[webhook] ✓ order=${order.id} status ${order.status} → ${next}`)
    return true
  }

  switch (event.type) {
    // Manual-capture flow: buyer successfully authorized the card. Funds are
    // held but not yet captured. This is the signal to move the order out
    // of pending_payment so the seller can upload the ticket.
    case 'payment_intent.amount_capturable_updated': {
      const pi = event.data.object
      console.log(`[webhook]   amount_capturable_updated  pi=${pi.id}  amount=${pi.amount_capturable}`)
      const order = await findOrderByPi(pi.id)
      if (!order) break
      if (order.status !== 'pending_payment') {
        console.log(`[webhook]   order=${order.id} is already ${order.status} — skipping transition`)
        break
      }
      const ok = await setStatus(order, 'paid_pending_ticket')
      if (ok) {
        await supabase.from('messages').insert({
          order_id: order.id,
          ticket_id: order.ticket_id,
          sender_id: order.seller_id,
          receiver_id: order.buyer_id,
          content: '💳 Payment received. Upload the ticket to continue.',
        }).catch(err => console.error('[webhook] message insert failed:', err.message))
      }
      break
    }

    // Fires when the PI is fully captured. With manual-capture this happens
    // after admin-approve.js calls paymentIntents.capture(). For
    // auto-capture PIs it would fire right after the buyer pays — handle
    // both: if still pending_payment, advance to paid_pending_ticket; if
    // already past that, mark completed.
    case 'payment_intent.succeeded': {
      const pi = event.data.object
      console.log(`[webhook]   payment_intent.succeeded  pi=${pi.id}  amount_received=${pi.amount_received}  capture_method=${pi.capture_method}`)
      const order = await findOrderByPi(pi.id)
      if (!order) break

      if (order.status === 'pending_payment') {
        // Auto-capture path (or a race where amount_capturable_updated was
        // missed): treat this as buyer-paid, not fully completed.
        const ok = await setStatus(order, 'paid_pending_ticket')
        if (ok) {
          await supabase.from('messages').insert({
            order_id: order.id,
            ticket_id: order.ticket_id,
            sender_id: order.seller_id,
            receiver_id: order.buyer_id,
            content: '💳 Payment received. Upload the ticket to continue.',
          }).catch(err => console.error('[webhook] message insert failed:', err.message))
        }
      } else if (order.status !== 'completed') {
        // Admin-approved path: capture finished, order is done.
        const ok = await setStatus(order, 'completed')
        if (ok) {
          const { error: tErr } = await supabase.from('tickets')
            .update({ status: 'completed' }).eq('id', order.ticket_id)
          if (tErr) console.error(`[webhook] ticket status update failed:`, tErr.message)
          else console.log(`[webhook] ✓ ticket=${order.ticket_id} status → completed`)
        }
      } else {
        console.log(`[webhook]   order=${order.id} already completed — no-op`)
      }
      break
    }

    case 'payment_intent.payment_failed': {
      const pi = event.data.object
      const reason = pi.last_payment_error?.message || 'unknown'
      console.log(`[webhook]   payment_intent.payment_failed  pi=${pi.id}  reason=${reason}`)
      const order = await findOrderByPi(pi.id, 'id, status')
      if (!order) break
      await setStatus(order, 'pending_payment')
      break
    }

    case 'payment_intent.canceled': {
      const pi = event.data.object
      console.log(`[webhook]   payment_intent.canceled  pi=${pi.id}`)
      const order = await findOrderByPi(pi.id)
      if (!order) break
      if (order.status === 'completed') {
        console.log(`[webhook]   order=${order.id} already completed — refusing to reject`)
        break
      }
      const ok = await setStatus(order, 'rejected')
      if (ok) {
        const { error: tErr } = await supabase.from('tickets')
          .update({ status: 'active' }).eq('id', order.ticket_id)
        if (tErr) console.error(`[webhook] ticket status update failed:`, tErr.message)
        else console.log(`[webhook] ✓ ticket=${order.ticket_id} status → active`)
      }
      break
    }

    case 'account.updated': {
      const account = event.data.object
      console.log(`[webhook]   account.updated  account=${account.id}  details_submitted=${account.details_submitted}  charges_enabled=${account.charges_enabled}`)
      if (account.details_submitted) {
        await supabase.from('profiles')
          .update({ stripe_account_id: account.id })
          .eq('stripe_account_id', account.id)
      }
      break
    }

    default:
      console.log(`[webhook]   unhandled event type: ${event.type}`)
  }

  console.log(`[webhook] ◀ done  event=${event.id}`)
  json(res, 200, { received: true })
}
