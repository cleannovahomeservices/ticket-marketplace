import { useState, useEffect } from 'react'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { stripePromise } from '../lib/stripe'
import { supabase } from '../lib/supabase'

// ── Inner form (inside <Elements>) ────────────────────────────
function PaymentForm({ ticket, orderId, onSuccess, onCancel }) {
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!stripe || !elements) return
    setLoading(true)
    setError('')

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/ticket/${ticket.id}?payment=success`,
      },
      redirect: 'if_required',
    })

    if (stripeError) {
      setError(stripeError.message)
      setLoading(false)
      return
    }

    onSuccess(orderId)
  }

  const platformFee = +(Number(ticket.price) * 0.05).toFixed(2)
  const sellerReceives = +(Number(ticket.price) - platformFee).toFixed(2)

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ marginBottom: '1.25rem' }}>
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>

      {/* Price breakdown */}
      <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '.85rem 1rem', marginBottom: '1.1rem', fontSize: '.88rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', marginBottom: '.35rem' }}>
          <span>Ticket price</span>
          <span>€{Number(ticket.price).toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', marginBottom: '.5rem' }}>
          <span>Service fee (5%)</span>
          <span>€{platformFee.toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: '.5rem', color: 'var(--text)' }}>
          <span>You pay</span>
          <span style={{ color: 'var(--accent2)', fontSize: '1rem' }}>€{Number(ticket.price).toFixed(2)}</span>
        </div>
        <p style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: '.4rem' }}>
          Seller receives €{sellerReceives.toFixed(2)} after the platform fee.
        </p>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '.75rem' }}>
        <button type="submit" className="btn btn-primary btn-lg" disabled={loading || !stripe} style={{ flex: 1 }}>
          {loading ? 'Processing…' : `Pay €${Number(ticket.price).toFixed(2)}`}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={loading}>Cancel</button>
      </div>
      <p style={{ fontSize: '.75rem', color: 'var(--muted)', textAlign: 'center', marginTop: '.75rem' }}>
        🔒 Payment secured by Stripe. Your card will be authorized but only charged after review.
      </p>
    </form>
  )
}

// ── Success state ──────────────────────────────────────────────
function SuccessView({ ticket, onClose }) {
  return (
    <div style={{ textAlign: 'center', padding: '1rem 0' }}>
      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
      <h2 style={{ marginBottom: '.5rem' }}>Payment authorized!</h2>
      <p style={{ color: 'var(--muted)', lineHeight: 1.7, marginBottom: '1.5rem' }}>
        Your payment for <strong style={{ color: 'var(--text)' }}>{ticket.title}</strong> has been
        authorized. Your order is now <strong style={{ color: 'var(--warning)' }}>pending review</strong> —
        we'll notify you once it's approved and your ticket is confirmed.
      </p>
      <button className="btn btn-primary" style={{ width: '100%' }} onClick={onClose}>
        Got it
      </button>
    </div>
  )
}

// ── Main modal ─────────────────────────────────────────────────
export default function CheckoutModal({ ticket, onClose, onSuccess }) {
  const [clientSecret, setClientSecret] = useState('')
  const [orderId, setOrderId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [succeeded, setSucceeded] = useState(false)

  const coverImage = ticket?.image_urls?.[0] || ticket?.image_url || null

  useEffect(() => {
    async function createIntent() {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setError('You must be logged in.'); setLoading(false); return }

      const res = await fetch('/api/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ticket_id: ticket.id }),
      })
      const data = await res.json()

      if (!res.ok) { setError(data.error || 'Failed to initialize payment.'); setLoading(false); return }
      setClientSecret(data.client_secret)
      setOrderId(data.order_id)
      setLoading(false)
    }
    createIntent()
  }, [ticket.id])

  function handleSuccess(oid) {
    setSucceeded(true)
    onSuccess(oid)
  }

  const stripeOptions = clientSecret
    ? { clientSecret, appearance: { theme: 'night', variables: { colorPrimary: '#7c3aed', colorBackground: '#1a1a24', colorText: '#f1f0ff', colorDanger: '#ef4444', fontFamily: 'Inter, system-ui, sans-serif', borderRadius: '8px' } } }
    : null

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !succeeded && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>

        {succeeded ? (
          <SuccessView ticket={ticket} onClose={onClose} />
        ) : (
          <>
            {/* Ticket summary header */}
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.5rem', background: 'var(--surface2)', padding: '.85rem 1rem', borderRadius: 8 }}>
              {coverImage ? (
                <img src={coverImage} alt={ticket.title} style={{ width: 60, height: 60, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div style={{ width: 60, height: 60, borderRadius: 8, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem', flexShrink: 0 }}>🎟</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '.95rem', marginBottom: '.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.title}</div>
                {ticket.event_date && (
                  <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: '.15rem' }}>
                    📅 {new Date(ticket.event_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                )}
                {ticket.location && (
                  <div style={{ fontSize: '.8rem', color: 'var(--muted)' }}>📍 {ticket.location}</div>
                )}
              </div>
              <div style={{ fontWeight: 800, fontSize: '1.2rem', color: 'var(--accent2)', flexShrink: 0 }}>
                €{Number(ticket.price).toFixed(2)}
              </div>
            </div>

            <h2 style={{ marginBottom: '1.1rem' }}>Complete purchase</h2>

            {loading && (
              <div style={{ textAlign: 'center', padding: '2rem' }}>
                <div className="spinner" style={{ margin: '0 auto' }} />
                <p style={{ color: 'var(--muted)', marginTop: '1rem' }}>Initializing secure payment…</p>
              </div>
            )}

            {error && (
              <>
                <div className="alert alert-error">{error}</div>
                <button className="btn btn-ghost" onClick={onClose} style={{ width: '100%', marginTop: '.5rem' }}>Close</button>
              </>
            )}

            {!loading && !error && stripeOptions && (
              <Elements stripe={stripePromise} options={stripeOptions}>
                <PaymentForm ticket={ticket} orderId={orderId} onSuccess={handleSuccess} onCancel={onClose} />
              </Elements>
            )}
          </>
        )}
      </div>
    </div>
  )
}
