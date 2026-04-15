import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

// ── Stripe ────────────────────────────────────────────────────
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
})

// ── Supabase admin (service role) ─────────────────────────────
// Falls back to the VITE_-prefixed vars in case only those were set on Vercel.
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars')
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

// ── CORS headers ───────────────────────────────────────────────
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// ── Verify Supabase JWT and return user ───────────────────────
// Legacy helper kept for backward compatibility.
export async function getAuthUser(req) {
  const { user } = await requireUser(req)
  return user
}

// Verify the caller is authenticated AND has role='admin'. Returns
// { user, profile, reason } — profile is non-null only when the user is
// a real admin, so endpoints can gate with `if (!profile) return 403`.
export async function requireAdmin(req) {
  const { user, reason } = await requireUser(req)
  if (!user) return { user: null, profile: null, reason }
  const supabase = getSupabaseAdmin()
  const { data: profile, error } = await supabase
    .from('profiles').select('id, role, is_admin').eq('id', user.id).single()
  if (error) return { user, profile: null, reason: `profile_lookup_failed: ${error.message}` }
  const isAdmin = profile?.role === 'admin' || profile?.is_admin === true
  if (!isAdmin) return { user, profile: null, reason: 'not_admin' }
  return { user, profile, reason: null }
}

// New helper that returns a diagnostic reason on failure so callers can
// surface specific 401 details to the client instead of a black-box
// "Unauthorized".
export async function requireUser(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'] || ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { user: null, reason: 'missing_authorization_header' }
  let supabase
  try {
    supabase = getSupabaseAdmin()
  } catch (err) {
    return { user: null, reason: `server_misconfigured: ${err.message}` }
  }
  try {
    const { data, error } = await supabase.auth.getUser(token)
    if (error) return { user: null, reason: `token_rejected: ${error.message}` }
    if (!data?.user) return { user: null, reason: 'no_user_for_token' }
    return { user: data.user, reason: null }
  } catch (err) {
    return { user: null, reason: `auth_call_failed: ${err.message}` }
  }
}

// ── Read raw request body as Buffer ───────────────────────────
export function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(typeof c === 'string' ? Buffer.from(c) : c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// ── JSON body parser ───────────────────────────────────────────
export async function parseBody(req) {
  const raw = await getRawBody(req)
  try { return JSON.parse(raw.toString()) } catch { return {} }
}

// ── Send JSON response ─────────────────────────────────────────
export function json(res, statusCode, data, extra = {}) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', ...CORS, ...extra })
  res.end(JSON.stringify(data))
}

// ── Send admin notification email (via Resend) ────────────────
// Silently no-ops if RESEND_API_KEY or ADMIN_EMAIL are not configured.
export async function sendAdminEmail(subject, html) {
  const apiKey     = process.env.RESEND_API_KEY
  const adminEmail = process.env.ADMIN_EMAIL
  const from       = process.env.RESEND_FROM || 'TicketMarket <onboarding@resend.dev>'
  if (!apiKey || !adminEmail) {
    console.log('[email] skipped (no RESEND_API_KEY or ADMIN_EMAIL):', subject)
    return
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: adminEmail, subject, html }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[email] send failed:', res.status, text)
    }
  } catch (err) {
    console.error('[email] send error:', err.message)
  }
}
