import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import FavoriteButton from '../components/FavoriteButton'
import CheckoutModal from '../components/CheckoutModal'

const CATEGORY_EMOJI = { concerts: '🎵', sports: '⚽', travel: '✈️', events: '🎉', experiences: '🌟' }

const ACTIVE_STATUSES = ['pending', 'accepted', 'paid']

export default function TicketDetail() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const chatEndRef = useRef(null)

  const [ticket, setTicket]           = useState(null)
  const [seller, setSeller]           = useState(null)
  const [myOrder, setMyOrder]         = useState(null)       // buyer's active order on this ticket
  const [sellerOrders, setSellerOrders] = useState([])       // all non-final orders (seller view)
  const [selectedOrderId, setSelectedOrderId] = useState(null) // for the seller — which order's chat
  const [buyerProfiles, setBuyerProfiles] = useState({})     // id → profile (seller view)
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
  const [msg, setMsg]                 = useState('')
  const [error, setError]             = useState('')

  const isOwner = user && ticket && user.id === ticket.seller_id
  const isBuyer = user && ticket && user.id !== ticket.seller_id

  // Active chat order (the one we subscribe to)
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
        .select('first_name, last_name, name, email, avatar_url, stripe_account_id')
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
  useEffect(() => {
    if (!activeOrderId) { setMessages([]); return }
    let active = true
    supabase
      .from('messages')
      .select('*, profiles(first_name, last_name, name, avatar_url)')
      .eq('order_id', activeOrderId)
      .order('created_at')
      .then(({ data }) => { if (active) setMessages(data || []) })
    return () => { active = false }
  }, [activeOrderId])

  // ── Realtime: messages for active order + orders for this ticket ──
  useEffect(() => {
    if (!activeOrderId) return
    const ch = supabase
      .channel(`order-msgs-${activeOrderId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `order_id=eq.${activeOrderId}` },
        async payload => {
          const { data } = await supabase
            .from('messages').select('*, profiles(first_name, last_name, name, avatar_url)')
            .eq('id', payload.new.id).single()
          if (data) setMessages(m => m.some(x => x.id === data.id) ? m : [...m, data])
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

  const canAct  = ticket && ticket.status === 'active'
  const images  = ticket?.image_urls?.length ? ticket.image_urls : (ticket?.image_url ? [ticket.image_url] : [])

  // ── Actions ───────────────────────────────────────────────────
  async function createOrder(type, price) {
    setActionLoading(true); setError('')
    const { data, error: insErr } = await supabase.from('orders').insert({
      ticket_id: ticket.id,
      buyer_id: user.id,
      seller_id: ticket.seller_id,
      price,
      type,
      status: 'pending',
    }).select().single()
    if (insErr) { setError(insErr.message); setActionLoading(false); return }
    // Seed the chat with a system line so both parties see something
    await supabase.from('messages').insert({
      order_id: data.id,
      ticket_id: ticket.id,
      sender_id: user.id,
      receiver_id: ticket.seller_id,
      content: type === 'buy'
        ? `🛒 Buy request placed at €${Number(price).toFixed(2)}.`
        : `💬 New offer: €${Number(price).toFixed(2)}.`,
    })
    setMyOrder(data)
    setMsg(type === 'buy' ? 'Buy request sent. Waiting for seller response.' : 'Offer sent.')
    setActionLoading(false)
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
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ order_id }),
    })
    const data = await res.json()
    setActionLoading(false)
    if (!res.ok) { setError(data.error || 'Action failed'); return false }
    await loadOrders(ticket, user)
    return true
  }

  async function handleAccept(order) {
    const ok = await callOrderAction('accept-order', order.id)
    if (ok) setMsg('Order accepted. Waiting for buyer payment.')
  }

  async function handleReject(order) {
    const ok = await callOrderAction('reject-order', order.id)
    if (ok) setMsg('Order rejected.')
  }

  async function handleCancel() {
    if (!myOrder) return
    const ok = await callOrderAction('reject-order', myOrder.id)
    if (ok) { setMsg('Order canceled.'); setMyOrder(null) }
  }

  async function handleViewFile() {
    if (fileUrl) { window.open(fileUrl, '_blank'); return }
    setFileLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/ticket-file?ticket_id=${ticket.id}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setFileLoading(false); return }
    setFileUrl(data.url)
    window.open(data.url, '_blank')
    setFileLoading(false)
  }

  async function handleSendMessage(e) {
    e.preventDefault()
    if (!chatMsg.trim() || !activeOrder) return
    setChatLoading(true)
    const receiver_id = user.id === activeOrder.seller_id ? activeOrder.buyer_id : activeOrder.seller_id
    await supabase.from('messages').insert({
      order_id: activeOrder.id,
      ticket_id: activeOrder.ticket_id,
      sender_id: user.id,
      receiver_id,
      content: chatMsg.trim(),
    })
    setChatMsg('')
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

  const sellerName = seller
    ? (seller.first_name ? `${seller.first_name} ${seller.last_name || ''}`.trim() : seller.name || seller.email)
    : '—'

  const buyerNameOf = order => {
    const p = buyerProfiles[order.buyer_id]
    if (!p) return '—'
    return p.first_name ? `${p.first_name} ${p.last_name || ''}`.trim() : (p.name || p.email)
  }

  return (
    <div className="page">
      {msg   && <div className="alert alert-success" style={{ marginBottom: '1.25rem' }}>{msg}</div>}
      {error && <div className="alert alert-error"   style={{ marginBottom: '1.25rem' }}>{error}</div>}

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

          {/* Seller: list of buyer orders */}
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
                    {o.status === 'pending' && (
                      <div className="offer-row-actions" onClick={e => e.stopPropagation()}>
                        <button className="btn btn-success btn-sm" onClick={() => handleAccept(o)} disabled={actionLoading}>Accept</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleReject(o)} disabled={actionLoading}>Reject</button>
                      </div>
                    )}
                    {o.status === 'accepted' && (
                      <span style={{ fontSize: '.8rem', color: 'var(--warning)', fontWeight: 600 }}>Awaiting payment</span>
                    )}
                    {o.status === 'paid' && (
                      <span style={{ fontSize: '.8rem', color: 'var(--success)', fontWeight: 600 }}>✓ Paid</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chat — scoped to the active order */}
          {user && activeOrder && (
            <div style={{ marginTop: '2rem' }}>
              <h3 style={{ fontWeight: 600, marginBottom: '.75rem' }}>
                {isOwner ? `Chat with ${buyerNameOf(activeOrder)}` : `Chat with ${sellerName}`}
              </h3>
              <div className="chat-box">
                {messages.length === 0 ? (
                  <p style={{ color: 'var(--muted)', fontSize: '.88rem', textAlign: 'center', padding: '1rem' }}>No messages yet.</p>
                ) : (
                  messages.map(m => {
                    const isMe = m.sender_id === user.id
                    const senderName = m.profiles
                      ? (m.profiles.first_name ? `${m.profiles.first_name} ${m.profiles.last_name || ''}`.trim() : m.profiles.name)
                      : 'User'
                    return (
                      <div key={m.id} className={`chat-msg ${isMe ? 'chat-msg--me' : ''}`}>
                        {!isMe && <div className="chat-sender">{senderName}</div>}
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
              {/* Ticket file */}
              {ticket.file_url && (isOwner ? (
                <a href={ticket.file_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
                  📄 View ticket file
                </a>
              ) : myOrder?.status === 'paid' ? (
                <button className="btn btn-outline" onClick={handleViewFile} disabled={fileLoading}>
                  {fileLoading ? 'Loading…' : '📄 View ticket file'}
                </button>
              ) : null)}

              {isOwner ? (
                <>
                  <Link to={`/edit/${ticket.id}`} className="btn btn-primary">Edit listing</Link>
                  <button className="btn btn-danger" onClick={handleDelete}>Delete listing</button>
                </>
              ) : !user ? (
                <Link to="/login" className="btn btn-primary btn-lg">Log in to buy</Link>
              ) : myOrder ? (
                // ── Buyer with an active order ────────────────────
                <>
                  {myOrder.status === 'pending' && (
                    <>
                      <div className="alert" style={{ textAlign: 'center', marginBottom: 0, background: 'var(--surface2)' }}>
                        ⏳ Waiting for seller response
                      </div>
                      <button className="btn btn-ghost" onClick={handleCancel} disabled={actionLoading}>Cancel request</button>
                    </>
                  )}
                  {myOrder.status === 'accepted' && (
                    <>
                      <button className="btn btn-primary btn-lg" onClick={() => setCheckoutModal(true)}>
                        Pay €{Number(myOrder.price).toFixed(2)} now
                      </button>
                      <button className="btn btn-ghost" onClick={handleCancel} disabled={actionLoading}>Cancel</button>
                    </>
                  )}
                  {myOrder.status === 'paid' && (
                    <div className="alert alert-success" style={{ textAlign: 'center', marginBottom: 0 }}>
                      ✅ Paid. Your ticket file is now available.
                    </div>
                  )}
                </>
              ) : isBuyer && canAct ? (
                // ── Buyer with no active order ────────────────────
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

      {/* Stripe checkout modal — only opens after seller acceptance */}
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
