import { getSupabaseAdmin, requireUser, json, CORS } from './_utils.js'

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
  const order_id = url.searchParams.get('order_id')
  if (!order_id) { json(res, 400, { error: 'order_id required' }); return }

  const supabase = getSupabaseAdmin()
  const { data: order } = await supabase
    .from('orders').select('id, buyer_id, seller_id, status, ticket_file_url')
    .eq('id', order_id).single()
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
    json(res, 403, { error: 'Access denied. Ticket is only visible after admin approval.' })
    return
  }

  const { data: signed, error: sErr } = await supabase.storage
    .from('order-tickets')
    .createSignedUrl(order.ticket_file_url, 60 * 10) // 10 min
  if (sErr) { json(res, 500, { error: `Sign URL failed: ${sErr.message}` }); return }

  json(res, 200, { url: signed.signedUrl })
}
