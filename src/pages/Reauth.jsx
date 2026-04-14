import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Reauth() {
  const { user } = useAuth()
  const [profile, setProfile]           = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('stripe_account_id, first_name')
      .eq('id', user.id)
      .single()
      .then(({ data }) => { setProfile(data); setProfileLoading(false) })
  }, [user])

  if (!user) return <Navigate to="/login" replace />

  async function handleRestart() {
    setLoading(true)
    setError('')
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/stripe-connect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Failed to generate link'); setLoading(false); return }
    window.location.href = data.url
  }

  const hasAccount      = !!profile?.stripe_account_id
  const firstName       = profile?.first_name
  const greeting        = firstName ? `, ${firstName}` : ''

  if (profileLoading) return <div className="page-loading">Loading…</div>

  return (
    <div className="auth-page">
      <div className="auth-card card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>{hasAccount ? '🔄' : '💳'}</div>

        <h2 style={{ marginBottom: '.5rem' }}>
          {hasAccount ? 'Onboarding incomplete' : 'Connect payout account'}
        </h2>

        <p style={{ color: 'var(--muted)', marginBottom: '1.5rem', lineHeight: 1.7 }}>
          {hasAccount
            ? `Hey${greeting}! Your Stripe onboarding link has expired or wasn't completed. Generate a new link below to finish setting up your payout account.`
            : `Hey${greeting}! To receive payments when you sell tickets, you need to connect a Stripe account for payouts. It only takes a few minutes.`
          }
        </p>

        {/* What to expect */}
        <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem', textAlign: 'left' }}>
          <p style={{ fontSize: '.84rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '.5rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            What happens next
          </p>
          {[
            "You'll be redirected to Stripe's secure onboarding",
            'Provide your bank details and identity information',
            "Once complete, you'll be returned to your dashboard",
            'Your payout account will be active for receiving payments',
          ].map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: '.65rem', alignItems: 'flex-start', marginBottom: '.4rem' }}>
              <span style={{ color: 'var(--accent2)', fontWeight: 700, flexShrink: 0, fontSize: '.85rem' }}>{i + 1}.</span>
              <span style={{ fontSize: '.85rem', color: 'var(--muted)', lineHeight: 1.5 }}>{step}</span>
            </div>
          ))}
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          <button className="btn btn-primary" onClick={handleRestart} disabled={loading}>
            {loading
              ? 'Generating link…'
              : hasAccount ? 'Resume onboarding' : 'Connect with Stripe'}
          </button>
          <Link to="/dashboard" className="btn btn-ghost">Back to dashboard</Link>
        </div>

        <p style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: '1rem', lineHeight: 1.5 }}>
          🔒 Stripe handles all payment processing and keeps your financial information secure.
        </p>
      </div>
    </div>
  )
}
