import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function TicketDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [ticket, setTicket]   = useState(null)
  const [seller, setSeller]   = useState(null)
  const [offers, setOffers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [offerModal, setOfferModal] = useState(false)
  const [offerPrice, setOfferPrice] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError]     = useState('')

  useEffect(() => {
    async function load() {
      const { data: t } = await supabase.from('tickets').select('*').eq('id', id).single()
      if (!t) { navigate('/'); return }
      setTicket(t)
      const { data: s } = await supabase.from('profiles').select('name, email').eq('id', t.seller_id).single()
      setSeller(s)
      if (user) {
        const { data: o } = await supabase.from('offers').select('*').eq('ticket_id', id)
        setOffers(o || [])
      }
      setLoading(false)
    }
    load()
  }, [id, user, navigate])

  const isOwner  = user && ticket && user.id === ticket.seller_id
  const isBuyer  = user && ticket && user.id !== ticket.seller_id
  const canAct   = ticket && ticket.status === 'active'

  async function handleBuyNow() {
    setActionLoading(true)
    setError('')
    const { error } = await supabase.from('orders').insert({
      ticket_id: ticket.id,
      buyer_id: user.id,
      seller_id: ticket.seller_id,
      price: ticket.price,
      status: 'pending',
    })
    if (error) { setError(error.message); setActionLoading(false); return }
    await supabase.from('tickets').update({ status: 'reserved' }).eq('id', ticket.id)
    setTicket(t => ({ ...t, status: 'reserved' }))
    setMessage('Order created! Go to your dashboard to complete the purchase.')
    setActionLoading(false)
  }

  async function handleMakeOffer(e) {
    e.preventDefault()
    setActionLoading(true)
    setError('')
    const { error } = await supabase.from('offers').insert({
      ticket_id: ticket.id,
      buyer_id: user.id,
      offer_price: parseFloat(offerPrice),
      status: 'pending',
    })
    if (error) { setError(error.message); setActionLoading(false); return }
    setMessage('Offer sent! The seller will review it.')
    setOfferModal(false)
    setOfferPrice('')
    setActionLoading(false)
  }

  async function handleAcceptOffer(offer) {
    setActionLoading(true)
    await supabase.from('offers').update({ status: 'accepted' }).eq('id', offer.id)
    await supabase.from('offers').update({ status: 'rejected' }).eq('ticket_id', ticket.id).neq('id', offer.id)
    await supabase.from('orders').insert({
      ticket_id: ticket.id,
      buyer_id: offer.buyer_id,
      seller_id: user.id,
      price: offer.offer_price,
      status: 'pending',
    })
    await supabase.from('tickets').update({ status: 'reserved' }).eq('id', ticket.id)
    setTicket(t => ({ ...t, status: 'reserved' }))
    setOffers(os => os.map(o => o.id === offer.id ? { ...o, status: 'accepted' } : { ...o, status: 'rejected' }))
    setMessage('Offer accepted. An order has been created.')
    setActionLoading(false)
  }

  async function handleRejectOffer(offer) {
    await supabase.from('offers').update({ status: 'rejected' }).eq('id', offer.id)
    setOffers(os => os.map(o => o.id === offer.id ? { ...o, status: 'rejected' } : o))
  }

  async function handleDelete() {
    if (!confirm('Delete this listing?')) return
    await supabase.from('tickets').delete().eq('id', ticket.id)
    navigate('/dashboard')
  }

  if (loading) return <div className="page-loading">Loading…</div>
  if (!ticket) return null

  const formattedDate = ticket.event_date
    ? new Date(ticket.event_date).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  const pendingOffers = offers.filter(o => o.status === 'pending')

  return (
    <div className="page">
      {message && <div className="alert alert-success" style={{ marginBottom: '1.25rem' }}>{message}</div>}
      {error   && <div className="alert alert-error"   style={{ marginBottom: '1.25rem' }}>{error}</div>}

      <div className="ticket-detail">
        {/* LEFT: image + description */}
        <div>
          <div className="ticket-detail-image">
            {ticket.image_url
              ? <img src={ticket.image_url} alt={ticket.title} />
              : <div className="ticket-detail-no-image">🎟</div>
            }
          </div>

          {ticket.description && (
            <div style={{ marginTop: '1.5rem' }}>
              <h3 style={{ fontWeight: 600, marginBottom: '.5rem' }}>About this ticket</h3>
              <p className="ticket-detail-desc">{ticket.description}</p>
            </div>
          )}

          {/* Owner-only: offers received */}
          {isOwner && offers.length > 0 && (
            <div style={{ marginTop: '1.5rem' }}>
              <h3 style={{ fontWeight: 600, marginBottom: '.75rem' }}>Offers received</h3>
              <div className="offers-list">
                {offers.map(o => (
                  <div key={o.id} className="offer-row">
                    <div>
                      <span style={{ fontWeight: 700, color: 'var(--accent2)' }}>${Number(o.offer_price).toFixed(2)}</span>
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
        </div>

        {/* RIGHT: info card */}
        <div>
          <div className="card">
            <span className={`ticket-badge ticket-badge--${ticket.status}`} style={{ position: 'static', display: 'inline-block', marginBottom: '.75rem' }}>{ticket.status}</span>
            <h1 className="ticket-detail-title">{ticket.title}</h1>

            <div className="ticket-detail-meta">
              {formattedDate && <span>📅 {formattedDate}</span>}
              {ticket.location && <span>📍 {ticket.location}</span>}
              {seller && <span>👤 Sold by {seller.name || seller.email}</span>}
            </div>

            <div className="ticket-detail-price">${Number(ticket.price).toFixed(2)}</div>

            <div className="ticket-actions">
              {ticket.file_url && (
                <a href={ticket.file_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
                  📄 View ticket file
                </a>
              )}

              {isOwner ? (
                <>
                  <Link to={`/edit/${ticket.id}`} className="btn btn-primary">Edit listing</Link>
                  <button className="btn btn-danger" onClick={handleDelete}>Delete listing</button>
                </>
              ) : isBuyer && canAct ? (
                <>
                  <button className="btn btn-primary btn-lg" onClick={handleBuyNow} disabled={actionLoading}>
                    {actionLoading ? 'Processing…' : 'Buy now'}
                  </button>
                  <button className="btn btn-outline" onClick={() => setOfferModal(true)} disabled={actionLoading}>
                    Make offer
                  </button>
                </>
              ) : !user ? (
                <Link to="/login" className="btn btn-primary btn-lg">Log in to buy</Link>
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
              Listed price: <strong style={{ color: 'var(--text)' }}>${Number(ticket.price).toFixed(2)}</strong>
            </p>
            <form onSubmit={handleMakeOffer}>
              <div className="form-group">
                <label>Your offer (USD)</label>
                <input
                  type="number" min="0.01" step="0.01"
                  value={offerPrice} onChange={e => setOfferPrice(e.target.value)}
                  required autoFocus
                />
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
    </div>
  )
}
