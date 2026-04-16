import {
  getSupabaseAdmin, requireUser, parseBody, json, CORS,
  asUuid, rateLimit, logAudit,
} from './_utils.js'

export const config = { maxDuration: 60 }

// Allow-list of accepted MIME types + their magic-byte signatures.
// We match the declared content_type against magic bytes so a caller
// can't upload an .exe renamed to "ticket.pdf".
const FILE_KINDS = [
  { mime: 'image/png',       ext: '.png', sig: [0x89, 0x50, 0x4e, 0x47] },                 // \x89PNG
  { mime: 'image/jpeg',      ext: '.jpg', sig: [0xff, 0xd8, 0xff] },                        // JPEG SOI
  { mime: 'application/pdf', ext: '.pdf', sig: [0x25, 0x50, 0x44, 0x46, 0x2d] },             // %PDF-
]
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

function detectKind(bytes, declaredMime) {
  for (const k of FILE_KINDS) {
    if (k.mime !== declaredMime) continue
    if (k.sig.every((b, i) => bytes[i] === b)) return k
  }
  // Also try to auto-detect when MIME was guessed wrong by the client.
  for (const k of FILE_KINDS) {
    if (k.sig.every((b, i) => bytes[i] === b)) return k
  }
  return null
}

// Seller-only. Accepts a base64-encoded QR / PDF / image, validates
// type + magic bytes + size, stores in the private `order-tickets`
// bucket keyed by order_id, records the internal path, and transitions
// the order to `pending_admin_review`.
//
// The file is NEVER public. /api/ticket-file issues short-lived signed
// URLs after admin approval (or to seller/admin at any time).
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  if (req.method !== 'POST') { json(res, 405, { error: 'Method not allowed' }); return }

  const { user, reason } = await requireUser(req)
  if (!user) { json(res, 401, { error: 'Unauthorized', reason }); return }

  const rl = await rateLimit({ subject: user.id, action: 'upload_ticket', limit: 10, windowSeconds: 300 })
  if (!rl.allowed) { json(res, 429, { error: 'Too many uploads — wait a few minutes.' }); return }

  let body
  try { body = await parseBody(req) } catch (err) {
    if (err.message === 'payload_too_large') {
      json(res, 413, { error: 'File too large (max 5 MB)' }); return
    }
    json(res, 400, { error: 'Invalid body' }); return
  }

  let orderId
  try { orderId = asUuid(body.order_id, 'order_id') }
  catch (err) { json(res, err.statusCode || 400, { error: err.message }); return }

  const { file_base64, filename, content_type } = body
  if (!file_base64 || !filename) {
    json(res, 400, { error: 'file_base64 and filename are required' }); return
  }
  if (typeof filename !== 'string' || filename.length > 200) {
    json(res, 400, { error: 'Invalid filename' }); return
  }

  const supabase = getSupabaseAdmin()
  const { data: order, error: oErr } = await supabase
    .from('orders').select('*').eq('id', orderId).single()
  if (oErr || !order) { json(res, 404, { error: 'Order not found' }); return }
  if (order.seller_id !== user.id) {
    await logAudit({ userId: user.id, action: 'upload_denied', targetType: 'order', targetId: order.id, metadata: { reason: 'not_seller' }, req })
    json(res, 403, { error: 'Only the seller can upload the ticket' }); return
  }
  if (order.status !== 'paid_pending_ticket') {
    json(res, 400, { error: `Order is ${order.status}, cannot upload ticket now` }); return
  }

  // Strip an optional data-URL prefix, then decode.
  const cleanB64 = String(file_base64).replace(/^data:[^;]+;base64,/, '')
  let bytes
  try { bytes = Buffer.from(cleanB64, 'base64') }
  catch { json(res, 400, { error: 'Invalid base64 payload' }); return }

  if (bytes.length === 0) { json(res, 400, { error: 'Empty file' }); return }
  if (bytes.length > MAX_BYTES) {
    json(res, 413, { error: 'File too large (max 5 MB)' }); return
  }

  const kind = detectKind(bytes, String(content_type || '').toLowerCase())
  if (!kind) {
    await logAudit({ userId: user.id, action: 'upload_denied', targetType: 'order', targetId: order.id, metadata: { reason: 'bad_type', declared: content_type }, req })
    json(res, 400, { error: 'Unsupported file type. Allowed: PNG, JPEG, PDF.' }); return
  }

  // Sanitize filename and pin the extension to the detected kind.
  const baseName = filename
    .replace(/\.[^.]+$/, '')               // strip extension
    .replace(/[^a-zA-Z0-9_-]/g, '_')       // drop anything weird
    .slice(0, 80) || 'ticket'
  const path = `${order.id}/${Date.now()}-${baseName}${kind.ext}`

  const { error: upErr } = await supabase.storage
    .from('order-tickets')
    .upload(path, bytes, { contentType: kind.mime, upsert: true })
  if (upErr) {
    await logAudit({ userId: user.id, action: 'upload_failed', targetType: 'order', targetId: order.id, metadata: { error: upErr.message }, req })
    json(res, 500, { error: `Upload failed: ${upErr.message}` }); return
  }

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

  await logAudit({
    userId: user.id,
    action: 'ticket_upload',
    targetType: 'order',
    targetId: order.id,
    metadata: { mime: kind.mime, size: bytes.length, path },
    req,
  })

  json(res, 200, { success: true, path })
}
