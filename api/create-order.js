import {
  getSupabaseAdmin, requireUser, parseBody, json, CORS,
  asUuid, asPositiveNumber, rateLimit, logAudit,
} from './_utils.js'

// Buyer-only. Creates an order row authoritatively on the server:
//   * Buy-now → price is re-derived from tickets.price (NEVER trusted
//     from the client; that was a real hole before).
//   * Offer   → buyer chooses price, bounded to sane range.
// Status lands at 'pending_seller' for offers (seller must accept) or
// 'pending_payment' for buy-now. Idempotency-ish: if a matching pending
// order from this buyer on this ticket already exists, returns it.
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  if (req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return }

  const { user, reason } = await requireUser(req)
  if (!user) { json(res, 401, { error: 'Unauthorized', reason }); return }

  let body
  try { body = await parseBody(req) } catch { json(res, 400, { error: 'Invalid body' }); return }

  let ticketId, type, offerPrice
  try {
    ticketId = asUuid(body.ticket_id, 'ticket_id')
    type = body.type === 'offer' ? 'offer' : 'buy'
    if (type === 'offer') offerPrice = asPositiveNumber(body.price, { field: 'price' })
  } catch (err) { json(res, err.statusCode || 400, { error: err.message }); return }

  // Rate limit: max 10 order creations per user per 10 minutes.
  const rl = await rateLimit({ subject: user.id, action: 'create_order', limit: 10, windowSeconds: 600 })
  if (!rl.allowed) {
    await logAudit({ userId: user.id, action: 'rate_limited', targetType: 'order', metadata: { count: rl.count }, req })
    json(res, 429, { error: 'Too many orders created — please wait before trying again.' }); return
  }

  const supabase = getSupabaseAdmin()

  const { data: ticket, error: tErr } = await supabase
    .from('tickets').select('id, seller_id, price, status').eq('id', ticketId).single()
  if (tErr || !ticket) { json(res, 404, { error: 'Ticket not found' }); return }
  if (ticket.seller_id === user.id) { json(res, 400, { error: 'You cannot buy your own ticket' }); return }
  if (ticket.status !== 'active') {
    json(res, 409, { error: 'This ticket is no longer available.' }); return
  }

  // Price is authoritative from the DB for buy-now; client value ignored.
  const price = type === 'buy'
    ? Number(ticket.price)
    : offerPrice
  if (type === 'offer' && (price <= 0 || price > Number(ticket.price) * 5)) {
    json(res, 400, { error: 'Offer price is out of range.' }); return
  }

  // Return an existing pending order if the buyer already has one.
  const { data: existing } = await supabase
    .from('orders').select('*')
    .eq('ticket_id', ticket.id)
    .eq('buyer_id', user.id)
    .in('status', ['pending_seller', 'pending_payment'])
    .maybeSingle()
  if (existing) { json(res, 200, { order: existing, reused: true }); return }

  const initialStatus = type === 'offer' ? 'pending_seller' : 'pending_payment'

  const { data: order, error: iErr } = await supabase
    .from('orders').insert({
      ticket_id: ticket.id,
      buyer_id: user.id,
      seller_id: ticket.seller_id,
      price,
      type,
      status: initialStatus,
    }).select().single()
  if (iErr || !order) { json(res, 500, { error: iErr?.message || 'Failed to create order' }); return }

  await supabase.from('messages').insert({
    order_id: order.id,
    ticket_id: order.ticket_id,
    sender_id: user.id,
    receiver_id: order.seller_id,
    content: type === 'buy'
      ? `🛒 Buy request placed at €${price.toFixed(2)}.`
      : `💬 New offer: €${price.toFixed(2)}.`,
  }).catch(() => {})

  await logAudit({
    userId: user.id,
    action: 'order_create',
    targetType: 'order',
    targetId: order.id,
    metadata: { ticket_id: order.ticket_id, type, price, status: initialStatus },
    req,
  })

  json(res, 200, { order })
}
