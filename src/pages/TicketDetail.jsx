import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import FavoriteButton from '../components/FavoriteButton'
import CheckoutModal from '../components/CheckoutModal'

const CATEGORY_EMOJI = { concerts: '🎵', sports: '⚽', travel: '✈️', events: '🎉', experiences: '🌟' }
const ACTIVE_STATUSES = ['pending_payment', 'paid_pending_ticket', 'pending_admin_review', 'completed']

export default function TicketDetail() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const chatEndRef = useRef(null)

  const [ticket, setTicket]           = useState(null)
  const [seller, setSeller]           = useState(null)
  const [myOrder, setMyOrder]         = useState(null)
  const [sellerOrders, setSellerOrders] = useState([])
  const [selectedOrderId, setSelectedOrderId] = useState(null)
  const [buyerProfiles, setBuyerProfiles] = useState({})
  const [messages, setMessages]       = useState([])
  const [imgIdx, setImgIdx]           = useState(0)
  const [loading, setLoading]         = useState(true)
  const [offerModal, setOfferModal]   = useState(false)
  const [checkoutModal, setCheckoutModal] = useState(false)
  const [offerPrice, setOfferPrice]   = useState('')
  const [chatMsg, setChatMsg]         = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [chatLoading, setChatLoading] = useState(false)
  const [fileUrl, setFileUrl]         = useState(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [uploadLoading, setUploadLoading] = useState(false)
  const [msg, setMsg]                 = useState('')
  const [error, setError]             = useState('')

  const isOwner = !!(user && ticket && user.id === ticket.seller_id)
  const isBuyer = !!(user && ticket && user.id !== ticket.seller_id)

  const activeOrder = isOwner
    ? sellerOrders.find(o => o.id === selectedOrderId) || null
    : myOrder
  const activeOrderId = activeOrder?.id || null

  useEffect(() => {
    if (searchParams.get('payment') === 'success') {
      setMsg('✅ Payment successful. The seller has been notified.')
    }
  }, [searchParams])

  // ── Load ticket + seller + orders ─────────────────────────────
  const loadOrders = useCallback(async (ticketRow, currentUser) => {
    if (!currentUser || !ticketRow) return
    if (currentUser.id === ticketRow.seller_id) {
      const { data } = await supabase
        .from('orders').select('*')
        .eq('ticket_id', ticketRow.id)
        .in('status', ACTIVE_STATUSES)
        .order('created_at', { ascending: false })
      const orders = data || []
      setSellerOrders(orders)
      setSelectedOrderId(prev => prev && orders.some(o => o.id === prev) ? prev : (orders[0]?.id || null))

      const buyerIds = [...new Set(orders.map(o => o.buyer_id))]
      if (buyerIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles').select('id, first_name, last_name, name, email, avatar_url').in('id', buyerIds)
        const map = {}
        ;(profs || []).forEach(p => { map[p.id] = p })
        setBuyerProfiles(map)
      }
    } else {
      const { data } = await supabase
        .from('orders').select('*')
        .eq('ticket_id', ticketRow.id)
        .eq('buyer_id', currentUser.id)
        .in('status', ACTIVE_STATUSES)
        .order('created_at', { ascending: false })
        .limit(1)
      setMyOrder(data?.[0] || null)
    }
  }, [])

  useEffect(() => {
    let active = true
    async function load() {
      const { data: t } = await supabase.from('tickets').select('*').eq('id', id).single()
      if (!active) return
      if (!t) { navigate('/'); return }
      setTicket(t)

      const { data: s } = await supabase.from('profiles')
        .select('id, first_name, last_name, name, email, avatar_url, stripe_account_id')
        .eq('id', t.seller_id).single()
      if (!active) return
      setSeller(s)

      if (user) await loadOrders(t, user)
      if (!active) return
      setLoading(false)
    }
    load()
    return () => { active = false }
  }, [id, user, navigate, loadOrders])

  // ── Load messages for the active order ────────────────────────
  // IMPORTANT: no profiles(...) join — messages.sender_id FK points to
  // auth.users, not public.profiles, so PostgREST can't resolve it and
  // would error the whole query. Names are resolved client-side below.
  useEffect(() => {
    if (!activeOrderId) { setMessages([]); return }
    let active = true
    supabase
      .from('messages')
      .select('id, order_id, sender_id, receiver_id, content, created_at')
      .eq('order_id', activeOrderId)
      .order('created_at', { ascending: true })
      .then(({ data, error: selErr }) => {
        if (!active) return
        if (selErr) { console.error('load messages failed:', selErr); setMessages([]); return }
        setMessages(data || [])
      })
    return () => { active = false }
  }, [activeOrderId])

  // ── Realtime: messages for the active order + orders for this ticket ──
  useEffect(() => {
    if (!activeOrderId) return
    const ch = supabase
      .channel(`order-msgs-${activeOrderId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `order_id=eq.${activeOrderId}` },
        payload => {
          const row = payload.new
          setMessages(prev => prev.some(m => m.id === row.id) ? prev : [...prev.filter(m => !m._optimistic || m.content !== row.content || m.sender_id !== row.sender_id), row])
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [activeOrderId])

  useEffect(() => {
    if (!user || !ticket) return
    const ch = supabase
      .channel(`ticket-orders-${ticket.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `ticket_id=eq.${ticket.id}` },
        () => loadOrders(ticket, user))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user, ticket, loadOrders])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const canAct = ticket && ticket.status === 'active'
  const images = ticket?.image_urls?.length ? ticket.image_urls : (ticket?.image_url ? [ticket.image_url] : [])

  // ── Name resolution (no DB join) ──────────────────────────────
  const sellerName = seller
    ? (seller.first_name ? `${seller.first_name} ${seller.last_name || ''}`.trim() : seller.name || seller.email)
    : '—'

  const buyerNameOf = order => {
    const p = buyerProfiles[order.buyer_id]
    if (!p) return 'Buyer'
    return p.first_name ? `${p.first_name} ${p.last_name || ''}`.trim() : (p.name || p.email)
  }

  function senderNameFor(message) {
    if (!message) return 'User'
    if (message.sender_id === seller?.id) return sellerName
    if (activeOrder && message.sender_id === activeOrder.buyer_id) return buyerNameOf(activeOrder)
    return 'User'
  }

  // ── Actions ───────────────────────────────────────────────────
  async function createOrder(type, price) {
    if (!user) { navigate('/login'); return }
    setActionLoading(true); setError('')
    const { data, error: insErr } = await supabase.from('orders').insert({
      ticket_id: ticket.id,
      buyer_id: user.id,
      seller_id: ticket.seller_id,
      price,
      type,
      status: 'pending_payment',
    }).select().single()
    if (insErr || !data?.id) {
      setError(insErr?.message || 'Failed to create order')
      setActionLoading(false)
      return
    }
    await sendOrderMessage(data, type === 'buy'
      ? `🛒 Buy request placed at €${Number(price).toFixed(2)}.`
      : `💬 New offer: €${Number(price).toFixed(2)}.`)
    setMyOrder(data)
    setMsg(type === 'buy' ? 'Buy request sent. Waiting for seller response.' : 'Offer sent.')
    setActionLoading(false)
  }

  // Single insert point — always carries order_id and the correct receiver.
  async function sendOrderMessage(order, content, { optimistic = false } = {}) {
    if (!order?.id) {
      console.error('sendOrderMessage: missing order_id')
      return { error: 'missing order_id' }
    }
    const receiver_id = user.id === order.seller_id ? order.buyer_id : order.seller_id
    const payload = {
      order_id: order.id,
      ticket_id: order.ticket_id,
      sender_id: user.id,
      receiver_id,
      content,
    }
    if (optimistic) {
      const tempId = `tmp-${Date.now()}-${Math.random()}`
      const optimisticRow = { ...payload, id: tempId, created_at: new Date().toISOString(), _optimistic: true }
      setMessages(m => [...m, optimisticRow])
      const { data, error: insErr } = await supabase.from('messages').insert(payload).select().single()
      if (insErr || !data) {
        setMessages(m => m.filter(x => x.id !== tempId))
        setError(insErr?.message || 'Message failed to send')
        return { error: insErr }
      }
      setMessages(m => m.map(x => x.id === tempId ? data : x))
      return { data }
    }
    return supabase.from('messages').insert(payload)
  }

  async function handleBuyNow() { await createOrder('buy', Number(ticket.price)) }

  async function handleMakeOffer(e) {
    e.preventDefault()
    const n = parseFloat(offerPrice)
    if (!n || n <= 0) { setError('Invalid price'); return }
    setOfferModal(false); setOfferPrice('')
    await createOrder('offer', n)
  }

  async function callOrderAction(endpoint, order_id) {
    setActionLoading(true); setError('')

    // Always refresh the session first so we never send an expired JWT.
    let { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      const { data: refreshed } = await supabase.auth.refreshSession()
      session = refreshed?.session || null
    }
    if (!session?.access_token) {
      setActionLoading(false)
      setError('You must be logged in. Please sign in again.')
      return false
    }

    let res, data
    try {
      res = await fetch(`/api/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ order_id }),
      })
      data = await res.json().catch(() => ({}))
    } catch (err) {
      setActionLoading(false); setError(`Network error: ${err.message}`); return false
    }

    setActionLoading(false)

    if (!res.ok) {
      // Surface diagnostic info so "Unauthorized" stops being a black box.
      if (res.status === 401) {
        setError(`Unauthorized${data.reason ? ` (${data.reason})` : ''}. Try logging out and back in.`)
      } else if (data.code === 'stripe_not_connected') {
        setError('You need to connect your Stripe payout account before accepting orders. Open your Dashboard and click "Connect payout account".')
      } else {
        setError(data.error || `Action failed (HTTP ${res.status})`)
      }
      return false
    }
    await loadOrders(ticket, user)
    return true
  }

  async function handleAccept(order) {
    if (!order || user.id !== order.seller_id) { setError('Only the seller can accept'); return }
    const ok = await callOrderAction('accept-order', order.id)
    if (ok) setMsg('Order accepted. Waiting for buyer payment.')
  }

  async function handleReject(order) {
    if (!order || user.id !== order.seller_id) { setError('Only the seller can reject'); return }
    const ok = await callOrderAction('reject-order', order.id)
    if (ok) setMsg('Order rejected.')
  }

  async function handleCancel(order) {
    if (!order || user.id !== order.buyer_id) { setError('Only the buyer can cancel'); return }
    const ok = await callOrderAction('cancel-order', order.id)
    if (ok) { setMsg('Order canceled.'); setMyOrder(null) }
  }

  async function handleViewOrderFile() {
    if (!activeOrder?.id) return
    setFileLoading(true); setError('')
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/ticket-file?order_id=${activeOrder.id}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = await res.json().catch(() => ({}))
    setFileLoading(false)
    if (!res.ok) { setError(data.error || 'Could not fetch ticket'); return }
    setFileUrl(data.url)
    window.open(data.url, '_blank')
  }

  async function handleUploadTicket(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // reset input
    if (!file || !activeOrder?.id) return
    if (!activeOrder.seller_id || activeOrder.seller_id !== user.id) {
      setError('Only the seller can upload the ticket'); return
    }
    if (activeOrder.status !== 'paid_pending_ticket') {
      setError(`Cannot upload — order is ${activeOrder.status}`); return
    }
    if (file.size > 10 * 1024 * 1024) { setError('File too large (max 10 MB)'); return }

    setUploadLoading(true); setError('')
    const b64 = await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result).split(',')[1] || '')
      r.onerror = () => reject(r.error)
      r.readAsDataURL(file)
    })

    const { data: { session } } = await supabase.auth.getSession()
    try {
      const res = await fetch('/api/upload-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          order_id: activeOrder.id,
          file_base64: b64,
          filename: file.name,
          content_type: file.type || 'application/octet-stream',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Upload failed'); setUploadLoading(false); return }
      setMsg('Ticket uploaded. Admin will review it shortly.')
      await loadOrders(ticket, user)
    } catch (err) {
      setError(`Upload failed: ${err.message}`)
    }
    setUploadLoading(false)
  }

  async function handleSendMessage(e) {
    e.preventDefault()
    if (!chatMsg.trim() || !activeOrder?.id) return
    setChatLoading(true)
    const text = chatMsg.trim()
    setChatMsg('')
    await sendOrderMessage(activeOrder, text, { optimistic: true })
    setChatLoading(false)
  }

  async function handleDelete() {
    await supabase.from('tickets').delete().eq('id', ticket.id)
    navigate('/dashboard')
  }

  function handleCheckoutSuccess() {
    setCheckoutModal(false)
    setMsg('✅ Payment successful. The seller has been notified.')
    loadOrders(ticket, user)
  }

  if (loading) return <div className="page-loading">Loading…</div>
  if (!ticket) return null

  const formattedDate = ticket.event_date
    ? new Date(ticket.event_date).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : null
  const formattedTime = ticket.event_date
    ? new Date(ticket.event_date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : null

  // ── Inline chat action/status bar (Vinted-style, inside the chat) ──
  function ChatActionBar() {
    if (!activeOrder) return null
    const isMySellerOrder = activeOrder.seller_id === user.id
    const isMyBuyerOrder  = activeOrder.buyer_id === user.id
    const label = activeOrder.type === 'offer'
      ? `Offer · €${Number(activeOrder.price).toFixed(2)}`
      : `Buy · €${Number(activeOrder.price).toFixed(2)}`

    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.5rem', padding: '.65rem .85rem', background: 'var(--surface2)', borderRadius: 8, marginBottom: '.5rem' }}>
        <span style={{ fontWeight: 600, fontSize: '.88rem' }}>{label}</span>
        <span style={{ fontSize: '.78rem', color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>
          {activeOrder.status.replace(/_/g, ' ')}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* pending_payment ─────────────────────────────────────── */}
          {isMyBuyerOrder && activeOrder.status === 'pending_payment' && (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => setCheckoutModal(true)}>Pay now</button>
              <button className="btn btn-ghost btn-sm" onClick={() => handleCancel(activeOrder)} disabled={actionLoading}>Cancel</button>
            </>
          )}
          {isMySellerOrder && activeOrder.status === 'pending_payment' && (
            <span style={{ fontSize: '.8rem', color: 'var(--warning)', fontWeight: 600 }}>Awaiting buyer payment</span>
          )}

          {/* paid_pending_ticket ─────────────────────────────────── */}
          {isMySellerOrder && activeOrder.status === 'paid_pending_ticket' && (
            <button className="btn btn-primary btn-sm" onClick={() => document.getElementById('upload-ticket-input')?.click()} disabled={uploadLoading}>
              {uploadLoading ? 'Uploading…' : '📤 Upload ticket'}
            </button>
          )}
          {isMyBuyerOrder && activeOrder.status === 'paid_pending_ticket' && (
            <span style={{ fontSize: '.8rem', color: 'var(--warning)', fontWeight: 600 }}>⏳ Waiting for seller to upload ticket</span>
          )}

          {/* pending_admin_review ────────────────────────────────── */}
          {activeOrder.status === 'pending_admin_review' && (
            <span style={{ fontSize: '.8rem', color: 'var(--warning)', fontWeight: 600 }}>🛡 Admin reviewing the ticket</span>
          )}

          {/* completed ───────────────────────────────────────────── */}
          {isMyBuyerOrder && activeOrder.status === 'completed' && (
            <button className="btn btn-success btn-sm" onClick={handleViewOrderFile} disabled={fileLoading}>
              {fileLoading ? 'Loading…' : '🎟 View your ticket'}
            </button>
          )}
          {!isMyBuyerOrder && activeOrder.status === 'completed' && (
            <span style={{ fontSize: '.8rem', color: 'var(--success)', fontWeight: 600 }}>✓ Completed</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      {msg   && <div className="alert alert-success" style={{ marginBottom: '1.25rem' }}>{msg}</div>}
      {error && <div className="alert alert-error"   style={{ marginBottom: '1.25rem' }}>{error}</div>}

      {/* Hidden file input used by the seller's "Upload ticket" button */}
      <input
        id="upload-ticket-input"
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={handleUploadTicket}
      />

      <div className="ticket-detail">
        {/* LEFT */}
        <div>
          {images.length > 0 ? (
            <div>
              <div className="ticket-detail-image"><img src={images[imgIdx]} alt={ticket.title} /></div>
              {images.length > 1 && (
                <div className="image-thumbs">
                  {images.map((url, i) => (
                    <button key={i} className={`image-thumb ${i === imgIdx ? 'active' : ''}`} onClick={() => setImgIdx(i)}>
                      <img src={url} alt="" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="ticket-detail-image"><div className="ticket-detail-no-image">🎟</div></div>
          )}

          {ticket.description && (
            <div style={{ marginTop: '1.5rem' }}>
              <h3 style={{ fontWeight: 600, marginBottom: '.5rem' }}>About this ticket</h3>
              <p className="ticket-detail-desc">{ticket.description}</p>
            </div>
          )}

          {/* Seller: list of buyer orders (click to open chat) */}
          {isOwner && sellerOrders.length > 0 && (
            <div style={{ marginTop: '1.5rem' }}>
              <h3 style={{ fontWeight: 600, marginBottom: '.75rem' }}>
                Orders ({sellerOrders.length})
              </h3>
              <div className="offers-list">
                {sellerOrders.map(o => (
                  <div
                    key={o.id}
                    className="offer-row"
                    style={{
                      cursor: 'pointer',
                      outline: o.id === selectedOrderId ? '2px solid var(--accent2)' : 'none',
                    }}
                    onClick={() => setSelectedOrderId(o.id)}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '.9rem' }}>{buyerNameOf(o)}</div>
                      <div>
                        <span style={{ fontWeight: 700, color: 'var(--accent2)' }}>€{Number(o.price).toFixed(2)}</span>
                        <span style={{ fontSize: '.78rem', color: 'var(--muted)', marginLeft: '.5rem' }}>
                          {o.type === 'offer' ? 'Offer' : 'Buy'} · {o.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chat — scoped to the active order, with inline actions */}
          {user && activeOrder && (
            <div style={{ marginTop: '2rem' }}>
              <h3 style={{ fontWeight: 600, marginBottom: '.75rem' }}>
                {isOwner ? `Chat with ${buyerNameOf(activeOrder)}` : `Chat with ${sellerName}`}
              </h3>
              <ChatActionBar />
              <div className="chat-box">
                {messages.length === 0 ? (
                  <p style={{ color: 'var(--muted)', fontSize: '.88rem', textAlign: 'center', padding: '1rem' }}>No messages yet.</p>
                ) : (
                  messages.map(m => {
                    const isMe = m.sender_id === user.id
                    return (
                      <div key={m.id} className={`chat-msg ${isMe ? 'chat-msg--me' : ''}`} style={m._optimistic ? { opacity: 0.6 } : null}>
                        {!isMe && <div className="chat-sender">{senderNameFor(m)}</div>}
                        <div className="chat-bubble">{m.content}</div>
                        <div className="chat-time">{new Date(m.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                    )
                  })
                )}
                <div ref={chatEndRef} />
              </div>
              <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem' }}>
                <input value={chatMsg} onChange={e => setChatMsg(e.target.value)} placeholder="Type a message…" style={{ flex: 1 }} />
                <button type="submit" className="btn btn-primary" disabled={chatLoading || !chatMsg.trim()}>Send</button>
              </form>
            </div>
          )}
        </div>

        {/* RIGHT: info card */}
        <div>
          <div className="card" style={{ position: 'sticky', top: 80 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.75rem' }}>
              <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span className={`ticket-badge ticket-badge--${ticket.status}`} style={{ position: 'static' }}>{ticket.status.replace('_', ' ')}</span>
                {ticket.category && (
                  <span className={`category-badge category-badge--${ticket.category}`}>
                    {CATEGORY_EMOJI[ticket.category]} {ticket.category}
                  </span>
                )}
              </div>
              <FavoriteButton ticketId={ticket.id} />
            </div>

            <h1 className="ticket-detail-title">{ticket.title}</h1>

            <div className="ticket-detail-meta">
              {formattedDate && <span>📅 {formattedDate}{formattedTime && formattedTime !== '12:00 AM' ? ` · ${formattedTime}` : ''}</span>}
              {ticket.location && <span>📍 {ticket.location}</span>}
              <span>👤 {sellerName}</span>
            </div>

            <div className="ticket-detail-price">€{Number(ticket.price).toFixed(2)}</div>

            <div className="ticket-actions">
              {isOwner ? (
                <>
                  <Link to={`/edit/${ticket.id}`} className="btn btn-primary">Edit listing</Link>
                  <button className="btn btn-danger" onClick={handleDelete}>Delete listing</button>
                </>
              ) : !user ? (
                <Link to="/login" className="btn btn-primary btn-lg">Log in to buy</Link>
              ) : myOrder ? (
                <div className="alert" style={{ textAlign: 'center', marginBottom: 0, background: 'var(--surface2)' }}>
                  {myOrder.status === 'pending_payment'      && '💳 Pay in the chat below to confirm your ticket'}
                  {myOrder.status === 'paid_pending_ticket'  && '⏳ Waiting for seller to upload the ticket'}
                  {myOrder.status === 'pending_admin_review' && '🛡 Admin is reviewing the ticket'}
                  {myOrder.status === 'completed'            && '✅ Ticket approved — open it from the chat'}
                </div>
              ) : isBuyer && canAct ? (
                <>
                  <button className="btn btn-primary btn-lg" onClick={handleBuyNow} disabled={actionLoading}>
                    Buy now · €{Number(ticket.price).toFixed(2)}
                  </button>
                  <button className="btn btn-outline" onClick={() => setOfferModal(true)} disabled={actionLoading}>
                    Make offer
                  </button>
                </>
              ) : ticket.status !== 'active' ? (
                <div className="alert alert-error" style={{ textAlign: 'center', marginBottom: 0 }}>
                  This ticket is no longer available.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Offer modal */}
      {offerModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setOfferModal(false)}>
          <div className="modal">
            <h2>Make an offer</h2>
            <p style={{ color: 'var(--muted)', fontSize: '.9rem', marginBottom: '1rem' }}>
              Listed price: <strong style={{ color: 'var(--text)' }}>€{Number(ticket.price).toFixed(2)}</strong>
            </p>
            <form onSubmit={handleMakeOffer}>
              <div className="form-group">
                <label>Your offer (EUR)</label>
                <input type="number" min="0.01" step="0.01" value={offerPrice} onChange={e => setOfferPrice(e.target.value)} required autoFocus />
              </div>
              <div style={{ display: 'flex', gap: '.75rem', marginTop: '.5rem' }}>
                <button type="submit" className="btn btn-primary" disabled={actionLoading} style={{ flex: 1 }}>
                  {actionLoading ? 'Sending…' : 'Send offer'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setOfferModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stripe checkout — opens once seller accepts */}
      {checkoutModal && myOrder && (
        <CheckoutModal
          ticket={ticket}
          order={myOrder}
          onClose={() => setCheckoutModal(false)}
          onSuccess={handleCheckoutSuccess}
        />
      )}
    </div>
  )
}
