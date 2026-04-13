import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const REDIRECT_URL = import.meta.env.PROD
  ? 'https://ticket-marketplace-lyart.vercel.app/auth/callback'
  : `${window.location.origin}/auth/callback`

export default function Login() {
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('tab') === 'signup' ? 'signup' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const { user } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  function switchTab(t) {
    setTab(t)
    setError('')
    setMessage('')
  }

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.message.includes('Email not confirmed')) {
        setError('Please confirm your email first. Check your inbox for a confirmation link.')
      } else if (error.message.includes('Invalid login credentials')) {
        setError('Incorrect email or password.')
      } else {
        setError(error.message)
      }
    }
    setLoading(false)
  }

  async function handleSignup(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: REDIRECT_URL },
    })
    if (error) { setError(error.message); setLoading(false); return }
    if (data.user) {
      await supabase.from('profiles').upsert({ id: data.user.id, email, name })
    }
    setMessage('Account created! Check your email and click the confirmation link to activate it.')
    setLoading(false)
  }

  async function handleGoogle() {
    setGoogleLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: REDIRECT_URL },
    })
    if (error) {
      setError('Google login is not configured yet.')
      setGoogleLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="auth-logo">🎟 TicketMarket</div>

        {/* Google button */}
        <button
          className="btn-google"
          onClick={handleGoogle}
          disabled={googleLoading || loading}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.96L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          {googleLoading ? 'Redirecting…' : 'Continue with Google'}
        </button>

        <div className="auth-divider"><span>or</span></div>

        {/* Tabs */}
        <div className="auth-tabs">
          <button className={`auth-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => switchTab('login')}>Log in</button>
          <button className={`auth-tab ${tab === 'signup' ? 'active' : ''}`} onClick={() => switchTab('signup')}>Sign up</button>
        </div>

        {error   && <div className="alert alert-error">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}

        {tab === 'login' ? (
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" autoComplete="email" />
            </div>
            <div className="form-group">
              <label>
                Password
                <Link to="/forgot-password" style={{ float: 'right', fontSize: '.8rem', color: 'var(--accent2)' }}>
                  Forgot password?
                </Link>
              </label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" autoComplete="current-password" />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '.25rem' }} disabled={loading}>
              {loading ? 'Logging in…' : 'Log in'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSignup}>
            <div className="form-group">
              <label>Full name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} required placeholder="Your name" autoComplete="name" />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" autoComplete="email" />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Min. 6 characters" minLength={6} autoComplete="new-password" />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '.25rem' }} disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
            <p style={{ fontSize: '.78rem', color: 'var(--muted)', textAlign: 'center', marginTop: '.75rem' }}>
              By signing up you agree to our Terms of Service.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
