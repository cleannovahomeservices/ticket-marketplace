import { getSupabaseAdmin, getAuthUser, json, CORS } from './_utils.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  if (req.method !== 'GET') { json(res, 405, { error: 'Method not allowed' }); return }

  const user = await getAuthUser(req)
  if (!user) { json(res, 401, { error: 'Unauthorized' }); return }

  const url = new URL(req.url, `http://${req.headers.host}`)
  const ticket_id = url.searchParams.get('ticket_id')
  if (!ticket_id) { json(res, 400, { error: 'ticket_id required' }); return }

  const supabase = getSupabaseAdmin()

  // Fetch the ticket
  const { data: ticket } = await supabase
    .from('tickets').select('id, seller_id, file_url').eq('id', ticket_id).single()

  if (!ticket) { json(res, 404, { error: 'Ticket not found' }); return }

  // Allow: owner of the ticket
  if (ticket.seller_id === user.id) {
    json(res, 200, { url: ticket.file_url }); return
  }

  // Allow: buyer with a completed order
  const { data: order } = await supabase
    .from('orders')
    .select('id, status')
    .eq('ticket_id', ticket_id)
    .eq('buyer_id', user.id)
    .eq('status', 'completed')
    .maybeSingle()

  if (!order) {
    json(res, 403, { error: 'Access denied. Purchase must be completed to view this file.' })
    return
  }

  json(res, 200, { url: ticket.file_url })
}
