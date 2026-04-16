import { getSupabaseAdmin, requireUser, parseBody, json, CORS } from './_utils.js'

// Give the function room to finish the base64 decode + Storage upload +
// DB writes. The default 10s Vercel Hobby limit was cutting off just
// after the Storage write, so the order DID flip to pending_admin_review
// but the client saw an error and displayed "Upload failed".
export const config = { maxDuration: 60 }

// Seller-only. Accepts a base64-encoded QR / PDF / image, stores it in
// the private `order-tickets` Storage bucket keyed by order_id, writes
// the internal path onto orders.ticket_file_url, and transitions the
// order to `pending_admin_review` so the admin panel picks it up.
//
// The file is NEVER made public. The /api/ticket-file endpoint issues
// short-lived signed URLs, and only after the admin has approved.
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  if (req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return }

  const { user, reason } = await requireUser(req)
  if (!user) { json(res, 401, { error: 'Unauthorized', reason }); return }

  const { order_id, file_base64, filename, content_type } = await parseBody(req)
  if (!order_id || !file_base64 || !filename) {
    json(res, 400, { error: 'order_id, file_base64 and filename are required' }); return
  }

  const supabase = getSupabaseAdmin()
  const { data: order, error: oErr } = await supabase
    .from('orders').select('*').eq('id', order_id).single()
  if (oErr || !order) { json(res, 404, { error: 'Order not found' }); return }
  if (order.seller_id !== user.id) {
    json(res, 403, { error: 'Only the seller can upload the ticket' }); return
  }
  if (order.status !== 'paid_pending_ticket') {
    json(res, 400, { error: `Order is ${order.status}, cannot upload ticket now` }); return
  }

  // Strip an optional data-URL prefix.
  const cleanB64 = String(file_base64).replace(/^data:[^;]+;base64,/, '')
  let bytes
  try { bytes = Buffer.from(cleanB64, 'base64') }
  catch { json(res, 400, { error: 'Invalid base64 payload' }); return }

  if (bytes.length === 0) { json(res, 400, { error: 'Empty file' }); return }
  if (bytes.length > 10 * 1024 * 1024) {
    json(res, 400, { error: 'File too large (max 10 MB)' }); return
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${order.id}/${Date.now()}-${safeName}`

  const { error: upErr } = await supabase.storage
    .from('order-tickets')
    .upload(path, bytes, {
      contentType: content_type || 'application/octet-stream',
      upsert: true,
    })
  if (upErr) { json(res, 500, { error: `Upload failed: ${upErr.message}` }); return }

  const { error: updErr } = await supabase.from('orders').update({
    ticket_file_url: path,
    status: 'pending_admin_review',
    updated_at: new Date().toISOString(),
  }).eq('id', order.id)
  if (updErr) { json(res, 500, { error: updErr.message }); return }

  await supabase.from('messages').insert({
    order_id: order.id,
    ticket_id: order.ticket_id,
    sender_id: user.id,
    receiver_id: order.buyer_id,
    content: '🎟 Seller uploaded the ticket. Admin is now reviewing it.',
  }).catch(() => {})

  json(res, 200, { success: true, path })
}
