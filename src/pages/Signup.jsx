import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const REDIRECT_URL = import.meta.env.PROD
  ? 'https://ticket-marketplace-lyart.vercel.app/auth/callback'
  : `${window.location.origin}/auth/callback`

export default function Signup() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => { if (user) navigate('/', { replace: true }) }, [user, navigate])

  function handleChange(e) { setForm(f => ({ ...f, [e.target.name]: e.target.value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { data, error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { emailRedirectTo: REDIRECT_URL },
    })
    if (error) { setError(error.message); setLoading(false); return }
    if (data.user) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        email: form.email,
        first_name: form.first_name,
        last_name: form.last_name,
        name: `${form.first_name} ${form.last_name}`.trim(),
      })
    }
    setDone(true)
    setLoading(false)
  }

  async function handleGoogle() {
    setGoogleLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: REDIRECT_URL },
    })
    if (error) { setError('Google login is not configured yet.'); setGoogleLoading(false) }
  }

  if (done) return (
    <div className="auth-page">
      <div className="auth-card card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📧</div>
        <h2 style={{ marginBottom: '.5rem' }}>Check your email</h2>
        <p style={{ color: 'var(--muted)', lineHeight: 1.7 }}>
          We sent a confirmation link to <strong style={{ color: 'var(--text)' }}>{form.email}</strong>.<br />
          Click it to activate your account.
        </p>
        <Link to="/login" className="btn btn-ghost" style={{ marginTop: '1.5rem', display: 'inline-flex' }}>Back to login</Link>
      </div>
    </div>
  )

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="auth-logo">🎟 TicketMarket</div>

        <button className="btn-google" onClick={handleGoogle} disabled={googleLoading || loading}>
          <GoogleIcon />
          {googleLoading ? 'Redirecting…' : 'Sign up with Google'}
        </button>

        <div className="auth-divider"><span>or</span></div>

        <h2 style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '1rem' }}>Create your account</h2>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>First name *</label>
              <input name="first_name" value={form.first_name} onChange={handleChange} required placeholder="Jane" autoComplete="given-name" />
            </div>
            <div className="form-group">
              <label>Last name *</label>
              <input name="last_name" value={form.last_name} onChange={handleChange} required placeholder="Doe" autoComplete="family-name" />
            </div>
          </div>
          <div className="form-group">
            <label>Email *</label>
            <input name="email" type="email" value={form.email} onChange={handleChange} required placeholder="you@example.com" autoComplete="email" />
          </div>
          <div className="form-group">
            <label>Password *</label>
            <input name="password" type="password" value={form.password} onChange={handleChange} required placeholder="Min. 6 characters" minLength={6} autoComplete="new-password" />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '.25rem' }} disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
          <p style={{ fontSize: '.78rem', color: 'var(--muted)', textAlign: 'center', marginTop: '.75rem' }}>
            Already have an account? <Link to="/login" style={{ color: 'var(--accent2)' }}>Log in</Link>
          </p>
        </form>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.96L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}
