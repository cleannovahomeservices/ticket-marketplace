import { stripe, getSupabaseAdmin, requireAdmin, parseBody, json, CORS } from './_utils.js'

const PLATFORM_FEE_PCT = 0.05

// Admin-only. Captures the PaymentIntent held on the platform, then
// creates a separate stripe.transfers.create() to pay the seller's
// connected account (amount - 5% platform fee), using source_transaction
// so the transfer is tied to the captured charge and Stripe lets us
// push funds before card settlement.
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
  if (order.status !== 'pending_admin_review') {
    json(res, 400, { error: `Order is ${order.status}, cannot approve` }); return
  }
  if (!order.stripe_payment_intent_id) {
    json(res, 400, { error: 'No payment intent on this order' }); return
  }

  // ── 0. Validate the seller can actually receive the transfer ──
  // Refuse to capture if the seller has no Stripe Connect account — we
  // would otherwise take the buyer's money with no way to pay out.
  const { data: seller } = await supabase
    .from('profiles').select('stripe_account_id').eq('id', order.seller_id).single()
  const sellerStripeId = seller?.stripe_account_id || null
  if (!sellerStripeId) {
    json(res, 400, {
      error: 'Seller has no Stripe account connected — cannot transfer funds. Ask the seller to connect their payout account before approving.',
      code: 'seller_not_connected',
    }); return
  }

  // ── 1. Capture the held funds into the platform account ──
  let captured
  try {
    captured = await stripe.paymentIntents.capture(order.stripe_payment_intent_id)
    console.log(`[admin-approve] ✓ captured pi=${captured.id} status=${captured.status}`)
  } catch (err) {
    console.error(`[admin-approve] capture failed:`, err.message)
    json(res, 500, { error: `Capture failed: ${err.message}` }); return
  }

  // ── 2. Transfer the seller's net amount to their connected account ──
  const amountCents = Math.round(Number(order.price) * 100)
  const platformFee = Math.round(amountCents * PLATFORM_FEE_PCT)
  const sellerNet   = amountCents - platformFee

  let transferId = null
  let transferError = null
  try {
    const chargeId = typeof captured.latest_charge === 'string'
      ? captured.latest_charge
      : captured.latest_charge?.id
    const transfer = await stripe.transfers.create({
      amount: sellerNet,
      currency: 'eur',
      destination: sellerStripeId,
      ...(chargeId ? { source_transaction: chargeId } : {}),
      metadata: {
        order_id: order.id,
        payment_intent_id: captured.id,
      },
    })
    transferId = transfer.id
    console.log(`[admin-approve] ✓ transfer=${transfer.id} amount=${sellerNet} → seller=${sellerStripeId}`)
  } catch (err) {
    // Don't roll back the capture — the admin already decided. Surface
    // the error on the order so an operator can retry the transfer.
    transferError = err.message
    console.error(`[admin-approve] transfer failed:`, err.message)
  }

  // ── 3. Mark the order completed and the ticket sold ──
  await supabase.from('orders').update({
    status: 'completed',
    updated_at: new Date().toISOString(),
  }).eq('id', order_id)
  await supabase.from('tickets').update({
    status: 'sold',
    reserved_by: null,
  }).eq('id', order.ticket_id)

  await supabase.from('messages').insert({
    order_id: order.id,
    ticket_id: order.ticket_id,
    sender_id: user.id,
    receiver_id: order.buyer_id,
    content: '✅ Admin approved the ticket. Your QR is now available.',
  }).catch(() => {})

  json(res, 200, {
    success: true,
    transfer_id: transferId,
    transfer_error: transferError,
  })
}
