import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Reauth() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleRestart() {
    if (!user) return
    setLoading(true)
    setError('')
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch('/api/stripe-connect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Failed'); setLoading(false); return }
    window.location.href = data.url
  }

  return (
    <div className="auth-page">
      <div className="auth-card card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔄</div>
        <h2 style={{ marginBottom: '.5rem' }}>Onboarding expired</h2>
        <p style={{ color: 'var(--muted)', marginBottom: '1.5rem', lineHeight: 1.7 }}>
          Your Stripe onboarding link has expired. Click below to start again.
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          <button className="btn btn-primary" onClick={handleRestart} disabled={loading}>
            {loading ? 'Generating link…' : 'Restart onboarding'}
          </button>
          <Link to="/dashboard" className="btn btn-ghost">Back to dashboard</Link>
        </div>
      </div>
    </div>
  )
}
