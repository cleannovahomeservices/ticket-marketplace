import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import FavoriteButton from '../components/FavoriteButton'
import CheckoutModal from '../components/CheckoutModal'

const CATEGORY_EMOJI = { concerts: '🎵', sports: '⚽', travel: '✈️', events: '🎉', experiences: '🌟' }

export default function TicketDetail() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const chatEndRef = useRef(null)

  const [ticket, setTicket]     = useState(null)
  const [seller, setSeller]     = useState(null)
  const [offers, setOffers]     = useState([])
  const [messages, setMessages] = useState([])
  const [imgIdx, setImgIdx]     = useState(0)
  const [loading, setLoading]   = useState(true)
  const [offerModal, setOfferModal]     = useState(false)
  const [checkoutModal, setCheckoutModal] = useState(false)
  const [offerPrice, setOfferPrice]     = useState('')
  const [chatMsg, setChatMsg]   = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [chatLoading, setChatLoading]     = useState(false)
  const [fileUrl, setFileUrl]   = useState(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [msg, setMsg]   = useState('')
  const [error, setError] = useState('')

  // Show success message if redirected back from Stripe
  useEffect(() => {
    if (searchParams.get('payment') === 'success') {
      setMsg('Payment authorized! Your order is pending review. We'll notify you once approved.')
    }
  }, [searchParams])

  useEffect(() => {
    async function load() {
      const { data: t } = await supabase.from('tickets').select('*').eq('id', id).single()
      if (!t) { navigate('/'); return }
      setTicket(t)

      const { data: s } = await supabase.from('profiles')
        .select('first_name, last_name, name, email, avatar_url, stripe_account_id')
        .eq('id', t.seller_id).single()
      setSeller(s)

      if (user) {
        const [{ data: o }, { data: m }] = await Promise.all([
          supabase.from('offers').select('*').eq('ticket_id', id).order('created_at'),
          supabase.from('messages').select('*, profiles(first_name, last_name, name, avatar_url)').eq('ticket_id', id).order('created_at'),
        ])
        setOffers(o || [])
        setMessages(m || [])
      }
      setLoading(false)
    }
    load()
  }, [id, user, navigate])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const isOwner  = user && ticket && user.id === ticket.seller_id
  const isBuyer  = user && ticket && user.id !== ticket.seller_id
  const canAct   = ticket && ticket.status === 'active'
  const images   = ticket?.image_urls?.length ? ticket.image_urls : (ticket?.image_url ? [ticket.image_url] : [])
  const sellerHasStripe = !!seller?.stripe_account_id

  async function handleMakeOffer(e) {
    e.preventDefault(); setActionLoading(true); setError('')
    const { error } = await supabase.from('offers').insert({
      ticket_id: ticket.id, buyer_id: user.id,
      offer_price: parseFloat(offerPrice), status: 'pending',
    })
    if (error) { setError(error.message); setActionLoading(false); return }
    setMsg('Offer sent! The seller will review it.')
    setOfferModal(false); setOfferPrice(''); setActionLoading(false)
  }

  async function handleAcceptOffer(offer) {
    setActionLoading(true)
    await supabase.from('offers').update({ status: 'accepted' }).eq('id', offer.id)
    await supabase.from('offers').update({ status: 'rejected' }).eq('ticket_id', ticket.id).neq('id', offer.id)
    await supabase.from('orders').insert({
      ticket_id: ticket.id, buyer_id: offer.buyer_id, seller_id: user.id,
      price: offer.offer_price, status: 'pending_review',
    })
    await supabase.from('tickets').update({ status: 'pending' }).eq('id', ticket.id)
    setTicket(t => ({ ...t, status: 'pending' }))
    setOffers(os => os.map(o => o.id === offer.id ? { ...o, status: 'accepted' } : { ...o, status: 'rejected' }))
    setMsg('Offer accepted. The buyer has been notified.')
    setActionLoading(false)
  }

  async function handleRejectOffer(offer) {
    await supabase.from('offers').update({ status: 'rejected' }).eq('id', offer.id)
    setOffers(os => os.map(o => o.id === offer.id ? { ...o, status: 'rejected' } : o))
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
    if (!chatMsg.trim()) return
    setChatLoading(true)
    const receiver_id = isOwner
      ? (messages.find(m => m.sender_id !== user.id)?.sender_id || null)
      : ticket.seller_id
    if (!receiver_id) { setChatLoading(false); return }
    const { data, error } = await supabase.from('messages').insert({
      ticket_id: ticket.id, sender_id: user.id, receiver_id, content: chatMsg.trim(),
    }).select('*, profiles(first_name, last_name, name, avatar_url)').single()
    if (!error && data) setMessages(m => [...m, data])
    setChatMsg('')
    setChatLoading(false)
  }

  async function handleDelete() {
    await supabase.from('tickets').delete().eq('id', ticket.id)
    navigate('/dashboard')
  }

  function handleCheckoutSuccess(orderId) {
    setCheckoutModal(false)
    setTicket(t => ({ ...t, status: 'pending' }))
    setMsg('Payment authorized! Your order is pending review. We'll notify you once approved.')
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

  return (
    <div className="page">
      {msg   && <div className="alert alert-success" style={{ marginBottom: '1.25rem' }}>{msg}</div>}
      {error && <div className="alert alert-error"   style={{ marginBottom: '1.25rem' }}>{error}</div>}

      <div className="ticket-detail">
        {/* LEFT */}
        <div>
          {/* Image gallery */}
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

          {/* Description */}
          {ticket.description && (
            <div style={{ marginTop: '1.5rem' }}>
              <h3 style={{ fontWeight: 600, marginBottom: '.5rem' }}>About this ticket</h3>
              <p className="ticket-detail-desc">{ticket.description}</p>
            </div>
          )}

          {/* Offers (seller only) */}
          {isOwner && offers.length > 0 && (
            <div style={{ marginTop: '1.5rem' }}>
              <h3 style={{ fontWeight: 600, marginBottom: '.75rem' }}>
                Offers received ({offers.filter(o => o.status === 'pending').length} pending)
              </h3>
              <div className="offers-list">
                {offers.map(o => (
                  <div key={o.id} className="offer-row">
                    <div>
                      <span style={{ fontWeight: 700, color: 'var(--accent2)' }}>€{Number(o.offer_price).toFixed(2)}</span>
                      <span style={{ fontSize: '.8rem', color: 'var(--muted)', marginLeft: '.5rem' }}>{o.status}</span>
                    </div>
                    {o.status === 'pending' && canAct && (
                      <div className="offer-row-actions">
                        <button className="btn btn-success btn-sm" onClick={() => handleAcceptOffer(o)} disabled={actionLoading}>Accept</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleRejectOffer(o)} disabled={actionLoading}>Reject</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chat */}
          {user && (
            <div style={{ marginTop: '2rem' }}>
              <h3 style={{ fontWeight: 600, marginBottom: '.75rem' }}>
                {isOwner ? 'Messages' : `Chat with ${sellerName}`}
              </h3>
              <div className="chat-box">
                {messages.length === 0 ? (
                  <p style={{ color: 'var(--muted)', fontSize: '.88rem', textAlign: 'center', padding: '1rem' }}>No messages yet. Say hello!</p>
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
              {(isBuyer || (isOwner && messages.length > 0)) && (
                <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem' }}>
                  <input value={chatMsg} onChange={e => setChatMsg(e.target.value)} placeholder="Type a message…" style={{ flex: 1 }} />
                  <button type="submit" className="btn btn-primary" disabled={chatLoading || !chatMsg.trim()}>Send</button>
                </form>
              )}
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
              {/* Ticket file — secured */}
              {ticket.file_url && (isOwner ? (
                <a href={ticket.file_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
                  📄 View ticket file
                </a>
              ) : (
                <button className="btn btn-outline" onClick={handleViewFile} disabled={fileLoading}>
                  {fileLoading ? 'Loading…' : '📄 View ticket file'}
                </button>
              ))}

              {isOwner ? (
                <>
                  <Link to={`/edit/${ticket.id}`} className="btn btn-primary">Edit listing</Link>
                  <button className="btn btn-danger" onClick={handleDelete}>Delete listing</button>
                </>
              ) : isBuyer && canAct ? (
                sellerHasStripe ? (
                  <>
                    <button className="btn btn-primary btn-lg" onClick={() => setCheckoutModal(true)}>
                      Buy now · €{Number(ticket.price).toFixed(2)}
                    </button>
                    <button className="btn btn-outline" onClick={() => setOfferModal(true)}>
                      Make offer
                    </button>
                  </>
                ) : (
                  <div className="alert alert-error" style={{ marginBottom: 0, textAlign: 'center' }}>
                    Seller hasn't set up payouts yet.
                  </div>
                )
              ) : !user ? (
                <Link to="/login" className="btn btn-primary btn-lg">Log in to buy</Link>
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

      {/* Stripe checkout modal */}
      {checkoutModal && (
        <CheckoutModal ticket={ticket} onClose={() => setCheckoutModal(false)} onSuccess={handleCheckoutSuccess} />
      )}
    </div>
  )
}
