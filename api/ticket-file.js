import { getSupabaseAdmin, requireUser, json, CORS, asUuid, rateLimit, logAudit } from './_utils.js'

// Serves signed URLs for the order-scoped ticket file uploaded by the
// seller. Enforces the visibility rules from the spec:
//
//   * Buyer  → only when order.status === 'completed'
//   * Seller → always (they uploaded it, so they can re-verify)
//   * Admin  → always (review / audit)
//
// No one else — and the file is NEVER exposed to the ticket listing.
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  if (req.method !== 'GET') { json(res, 405, { error: 'Method not allowed' }); return }

  const { user, reason } = await requireUser(req)
  if (!user) { json(res, 401, { error: 'Unauthorized', reason }); return }

  const url = new URL(req.url, `http://${req.headers.host}`)
  let orderId
  try {
    orderId = asUuid(url.searchParams.get('order_id'), 'order_id')
  } catch (err) { json(res, err.statusCode || 400, { error: err.message }); return }

  const rl = await rateLimit({ subject: user.id, action: 'ticket_file', limit: 30, windowSeconds: 60 })
  if (!rl.allowed) { json(res, 429, { error: 'Too many requests.' }); return }

  const supabase = getSupabaseAdmin()
  const { data: order } = await supabase
    .from('orders').select('id, buyer_id, seller_id, status, ticket_file_url')
    .eq('id', orderId).single()
  if (!order) { json(res, 404, { error: 'Order not found' }); return }
  if (!order.ticket_file_url) { json(res, 404, { error: 'No ticket uploaded yet' }); return }

  const { data: profile } = await supabase
    .from('profiles').select('role, is_admin').eq('id', user.id).single()
  const isAdmin = profile?.role === 'admin' || profile?.is_admin === true

  let allowed = false
  if (isAdmin) allowed = true
  else if (user.id === order.seller_id) allowed = true
  else if (user.id === order.buyer_id && order.status === 'completed') allowed = true

  if (!allowed) {
    await logAudit({ userId: user.id, action: 'ticket_file_denied', targetType: 'order', targetId: order.id, metadata: { status: order.status }, req })
    json(res, 403, { error: 'Access denied. Ticket is only visible after admin approval.' })
    return
  }

  const { data: signed, error: sErr } = await supabase.storage
    .from('order-tickets')
    .createSignedUrl(order.ticket_file_url, 60 * 10) // 10 min
  if (sErr) { json(res, 500, { error: `Sign URL failed: ${sErr.message}` }); return }

  await logAudit({ userId: user.id, action: 'ticket_file_signed', targetType: 'order', targetId: order.id, req })
  json(res, 200, { url: signed.signedUrl })
}
