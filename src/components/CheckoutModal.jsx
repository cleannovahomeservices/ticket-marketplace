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

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ marginBottom: '1.25rem' }}>
        <PaymentElement options={{ layout: 'tabs' }} />
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

// ── Main modal ─────────────────────────────────────────────────
export default function CheckoutModal({ ticket, onClose, onSuccess }) {
  const [clientSecret, setClientSecret] = useState('')
  const [orderId, setOrderId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  const stripeOptions = clientSecret
    ? { clientSecret, appearance: { theme: 'night', variables: { colorPrimary: '#7c3aed', colorBackground: '#1a1a24', colorText: '#f1f0ff', colorDanger: '#ef4444', fontFamily: 'Inter, system-ui, sans-serif', borderRadius: '8px' } } }
    : null

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div style={{ marginBottom: '1.25rem' }}>
          <h2 style={{ marginBottom: '.25rem' }}>Complete purchase</h2>
          <p style={{ color: 'var(--muted)', fontSize: '.88rem' }}>
            {ticket.title} · <strong style={{ color: 'var(--accent2)' }}>€{Number(ticket.price).toFixed(2)}</strong>
          </p>
        </div>

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
            <PaymentForm ticket={ticket} orderId={orderId} onSuccess={onSuccess} onCancel={onClose} />
          </Elements>
        )}
      </div>
    </div>
  )
}
