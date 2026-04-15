import { useState, useEffect } from 'react'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import stripePromise from '../lib/stripe'
import { supabase } from '../lib/supabase'

// ── Inner form (inside <Elements>) ────────────────────────────
function PaymentForm({ ticket, order, onSuccess, onCancel }) {
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const price = Number(order.price)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!stripe || !elements) {
      console.warn('[checkout] stripe or elements not ready')
      return
    }
    setLoading(true)
    setError('')

    console.log('[checkout] submitting payment for order', order.id)

    // Validate + submit the PaymentElement before confirming — required
    // by modern Stripe.js to prevent a hang when the form has issues.
    const { error: submitError } = await elements.submit()
    if (submitError) {
      console.error('[checkout] elements.submit error:', submitError)
      setError(submitError.message || 'Please check your card details.')
      setLoading(false)
      return
    }

    let result
    try {
      result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/ticket/${ticket.id}?payment=success`,
        },
        redirect: 'if_required',
      })
    } catch (err) {
      console.error('[checkout] confirmPayment threw:', err)
      setError(err.message || 'Payment failed unexpectedly.')
      setLoading(false)
      return
    }

    const { error: stripeError, paymentIntent } = result || {}

    if (stripeError) {
      console.error('[checkout] stripe error:', stripeError)
      setError(stripeError.message || 'Payment failed.')
      setLoading(false)
      return
    }

    // Manual-capture flow: success = PI in `requires_capture` state.
    // `succeeded`/`processing` are also valid (auto-capture fallback).
    const okStatuses = ['requires_capture', 'succeeded', 'processing']
    const status = paymentIntent?.status
    console.log('[checkout] confirmPayment resolved, PI status =', status)

    if (!paymentIntent || !okStatuses.includes(status)) {
      setError(`Unexpected payment state (${status || 'unknown'}). Refresh and try again.`)
      setLoading(false)
      return
    }

    setLoading(false)
    onSuccess(order.id)
  }

  const platformFee = +(price * 0.05).toFixed(2)
  const sellerReceives = +(price - platformFee).toFixed(2)

  return (
    <form onSubmit={handleSubmit} className="checkout-form">
      <div className="checkout-payment-element">
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>

      {/* Price breakdown */}
      <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '.85rem 1rem', marginBottom: '1.1rem', fontSize: '.88rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', marginBottom: '.35rem' }}>
          <span>{order.type === 'offer' ? 'Accepted offer' : 'Ticket price'}</span>
          <span>€{price.toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', marginBottom: '.5rem' }}>
          <span>Service fee (5%)</span>
          <span>€{platformFee.toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: '.5rem', color: 'var(--text)' }}>
          <span>You pay</span>
          <span style={{ color: 'var(--accent2)', fontSize: '1rem' }}>€{price.toFixed(2)}</span>
        </div>
        <p style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: '.4rem' }}>
          Seller receives €{sellerReceives.toFixed(2)} after the platform fee.
        </p>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}
      <div className="checkout-actions">
        <button type="submit" className="btn btn-primary btn-lg checkout-pay-btn" disabled={loading || !stripe}>
          {loading ? 'Processing…' : `Pay €${price.toFixed(2)}`}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={loading}>Cancel</button>
      </div>
      <p style={{ fontSize: '.75rem', color: 'var(--muted)', textAlign: 'center', marginTop: '.75rem' }}>
        🔒 Payment secured by Stripe.
      </p>
    </form>
  )
}

// ── Success state ──────────────────────────────────────────────
function SuccessView({ ticket, onClose }) {
  return (
    <div style={{ textAlign: 'center', padding: '1rem 0' }}>
      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
      <h2 style={{ marginBottom: '.5rem' }}>Payment successful!</h2>
      <p style={{ color: 'var(--muted)', lineHeight: 1.7, marginBottom: '1.5rem' }}>
        Your payment for <strong style={{ color: 'var(--text)' }}>{ticket.title}</strong> is complete.
        The ticket file is now available in your dashboard.
      </p>
      <button className="btn btn-primary" style={{ width: '100%' }} onClick={onClose}>
        Got it
      </button>
    </div>
  )
}

// ── Main modal ─────────────────────────────────────────────────
export default function CheckoutModal({ ticket, order, onClose, onSuccess }) {
  const [clientSecret, setClientSecret] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [succeeded, setSucceeded] = useState(false)

  const coverImage = ticket?.image_urls?.[0] || ticket?.image_url || null

  useEffect(() => {
    async function fetchIntent() {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setError('You must be logged in.'); setLoading(false); return }

      const res = await fetch('/api/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ order_id: order.id }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        console.error('[checkout] create-payment-intent failed:', res.status, data)
        setError(data.error || `Failed to initialize payment (HTTP ${res.status}).`)
        setLoading(false)
        return
      }

      // Server signals PI is already captured/authorized — skip Stripe
      // Elements entirely and flip straight to success.
      if (data.already_paid) {
        console.log('[checkout] PI already paid, skipping Elements')
        setSucceeded(true)
        setLoading(false)
        onSuccess(order.id)
        return
      }

      if (!data.client_secret) {
        setError('Payment could not be initialized.')
        setLoading(false)
        return
      }
      setClientSecret(data.client_secret)
      setLoading(false)
    }
    fetchIntent()
  }, [order.id, onSuccess])

  function handleSuccess(oid) {
    setSucceeded(true)
    onSuccess(oid)
  }

  const stripeOptions = clientSecret
    ? { clientSecret, appearance: { theme: 'night', variables: { colorPrimary: '#7c3aed', colorBackground: '#1a1a24', colorText: '#f1f0ff', colorDanger: '#ef4444', fontFamily: 'Inter, system-ui, sans-serif', borderRadius: '8px' } } }
    : null

  return (
    <div className="modal-overlay checkout-overlay" onClick={e => e.target === e.currentTarget && !succeeded && onClose()}>
      <div className="modal checkout-modal" style={{ maxWidth: 480 }}>

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
                €{Number(order.price).toFixed(2)}
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
                <PaymentForm ticket={ticket} order={order} onSuccess={handleSuccess} onCancel={onClose} />
              </Elements>
            )}
          </>
        )}
      </div>
    </div>
  )
}
