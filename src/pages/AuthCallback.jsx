import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    async function handleCallback() {
      // PKCE flow: exchange code for session
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const type = params.get('type') // 'recovery', 'signup', etc.
      const errorParam = params.get('error')
      const errorDesc = params.get('error_description')

      if (errorParam) {
        setError(errorDesc || errorParam)
        return
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) { setError(error.message); return }

        // If it's a recovery type, redirect to reset password
        if (type === 'recovery') {
          navigate('/reset-password', { replace: true })
          return
        }
        navigate('/', { replace: true })
        return
      }

      // Implicit flow: tokens in URL hash
      const hash = new URLSearchParams(window.location.hash.slice(1))
      const accessToken = hash.get('access_token')
      const refreshToken = hash.get('refresh_token')
      const hashType = hash.get('type')

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        if (error) { setError(error.message); return }

        if (hashType === 'recovery') {
          navigate('/reset-password', { replace: true })
          return
        }
        navigate('/', { replace: true })
        return
      }

      // Nothing to handle
      navigate('/', { replace: true })
    }

    handleCallback()
  }, [navigate])

  if (error) {
    return (
      <div className="auth-page">
        <div className="auth-card card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
          <h2 style={{ marginBottom: '.75rem' }}>Link expired or invalid</h2>
          <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
            This link has expired or already been used. Request a new one below.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            <a href="/forgot-password" className="btn btn-primary" style={{ justifyContent: 'center' }}>Request new password reset</a>
            <a href="/login" className="btn btn-ghost" style={{ justifyContent: 'center' }}>Back to login</a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card card" style={{ textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 1rem' }} />
        <p style={{ color: 'var(--muted)' }}>Confirming your account…</p>
      </div>
    </div>
  )
}
