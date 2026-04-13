import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const REDIRECT_URL = import.meta.env.PROD
  ? 'https://ticket-marketplace-lyart.vercel.app/auth/callback?type=recovery'
  : `${window.location.origin}/auth/callback?type=recovery`

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: REDIRECT_URL,
    })
    if (error) { setError(error.message); setLoading(false); return }
    setSent(true)
    setLoading(false)
  }

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div style={{ marginBottom: '1.5rem' }}>
          <Link to="/login" className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }}>← Back to login</Link>
        </div>
        <h2 style={{ fontWeight: 700, fontSize: '1.3rem', marginBottom: '.4rem' }}>Reset your password</h2>
        <p style={{ color: 'var(--muted)', fontSize: '.9rem', marginBottom: '1.5rem' }}>
          Enter your email and we'll send you a link to set a new password.
        </p>

        {sent ? (
          <div className="alert alert-success">
            Check your inbox! We sent a reset link to <strong>{email}</strong>.
            <br /><br />
            <span style={{ fontSize: '.85rem' }}>Didn't receive it? Check your spam folder or wait a minute and try again.</span>
          </div>
        ) : (
          <>
            {error && <div className="alert alert-error">{error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  autoFocus
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
