import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const REDIRECT_URL = import.meta.env.PROD
  ? 'https://ticket-marketplace-lyart.vercel.app/auth/callback'
  : `${window.location.origin}/auth/callback`

export default function Login() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (user) navigate('/', { replace: true }) }, [user, navigate])

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.message.includes('Email not confirmed')) {
        setError('Please confirm your email first. Check your inbox for the confirmation link.')
      } else if (error.message.includes('Invalid login credentials')) {
        setError('Incorrect email or password.')
      } else {
        setError(error.message)
      }
    }
    setLoading(false)
  }

  async function handleGoogle() {
    setGoogleLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: REDIRECT_URL },
    })
    if (error) { setError('Google login is not configured yet.'); setGoogleLoading(false) }
  }

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="auth-logo">🎟 TicketMarket</div>

        <button className="btn-google" onClick={handleGoogle} disabled={googleLoading || loading}>
          <GoogleIcon />
          {googleLoading ? 'Redirecting…' : 'Continue with Google'}
        </button>

        <div className="auth-divider"><span>or</span></div>

        <h2 style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '1rem' }}>Log in to your account</h2>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" autoComplete="email" autoFocus />
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Password</span>
              <Link to="/forgot-password" style={{ fontSize: '.8rem', color: 'var(--accent2)' }}>Forgot password?</Link>
            </label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" autoComplete="current-password" />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '.25rem' }} disabled={loading}>
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <p style={{ fontSize: '.85rem', color: 'var(--muted)', textAlign: 'center', marginTop: '1.25rem' }}>
          Don't have an account? <Link to="/signup" style={{ color: 'var(--accent2)', fontWeight: 600 }}>Sign up</Link>
        </p>
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
