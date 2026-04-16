import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

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

// ── CORS ───────────────────────────────────────────────────────
// Allow-list of origins; defaults cover local dev + the deployed app.
// Override in production via ALLOWED_ORIGINS="https://a.com,https://b.com".
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  'https://ticket-marketplace-lyart.vercel.app',
]
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean)
const ORIGINS = ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : DEFAULT_ORIGINS

export function corsHeaders(req) {
  const origin = req?.headers?.origin || ''
  const allowed = ORIGINS.includes(origin) ? origin : ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  }
}

// Legacy export kept for files that haven't been updated yet. This is
// the "first allowed origin" variant and no longer reflects the caller.
export const CORS = {
  'Access-Control-Allow-Origin': ORIGINS[0],
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin',
}

// ── Verify Supabase JWT and return user ───────────────────────
export async function getAuthUser(req) {
  const { user } = await requireUser(req)
  return user
}

// Verify the caller is authenticated AND has role='admin'.
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

// ── Raw body + JSON parser ────────────────────────────────────
export function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', c => {
      const buf = typeof c === 'string' ? Buffer.from(c) : c
      total += buf.length
      // Hard cap to prevent memory DoS. Upload endpoint (~7MB base64
      // for a 5MB file) is the biggest legitimate payload.
      if (total > 12 * 1024 * 1024) {
        reject(new Error('payload_too_large'))
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export async function parseBody(req) {
  const raw = await getRawBody(req)
  try { return JSON.parse(raw.toString()) } catch { return {} }
}

// ── Security-aware JSON responder ─────────────────────────────
// Applies per-request CORS + basic security headers on every response.
export function json(res, statusCode, data, extra = {}) {
  const req = res.req
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'no-store',
    ...corsHeaders(req),
    ...extra,
  })
  res.end(JSON.stringify(data))
}

// ── Input validators ──────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(v) { return typeof v === 'string' && UUID_RE.test(v) }

export function asUuid(v, field = 'id') {
  if (!isUuid(v)) { const err = new Error(`Invalid ${field}`); err.statusCode = 400; throw err }
  return v
}

export function asPositiveNumber(v, { max = 1_000_000, field = 'amount' } = {}) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0 || n > max) {
    const err = new Error(`Invalid ${field}`); err.statusCode = 400; throw err
  }
  return n
}

export function asBoundedString(v, { min = 1, max = 2000, field = 'value' } = {}) {
  if (typeof v !== 'string') { const err = new Error(`Invalid ${field}`); err.statusCode = 400; throw err }
  const s = v.trim()
  if (s.length < min || s.length > max) {
    const err = new Error(`Invalid ${field} length`); err.statusCode = 400; throw err
  }
  return s
}

// ── Idempotency keys for Stripe ───────────────────────────────
// Build a deterministic key per logical Stripe operation so retries
// don't create duplicate PaymentIntents / Transfers.
export function idempotencyKey(...parts) {
  return crypto.createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 40)
}

// ── Rate limiting (token bucket via DB RPC) ───────────────────
// Returns { allowed, count }. Caller short-circuits with 429 when !allowed.
export async function rateLimit({ subject, action, limit, windowSeconds }) {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase.rpc('rate_limit_hit', {
      p_subject: String(subject),
      p_action: String(action),
      p_window_seconds: Number(windowSeconds),
    })
    if (error) {
      console.error(`[rate-limit] RPC failed for ${subject}/${action}:`, error.message)
      return { allowed: true, count: 0 } // fail-open on infra error
    }
    const count = Number(data) || 0
    return { allowed: count <= limit, count }
  } catch (err) {
    console.error(`[rate-limit] exception for ${subject}/${action}:`, err.message)
    return { allowed: true, count: 0 }
  }
}

// ── Audit logging ──────────────────────────────────────────────
// Writes are never blocked by RLS (service role). Never throws —
// audit-log failures must not break the user-facing flow.
export async function logAudit({
  userId = null,
  action,
  targetType = null,
  targetId = null,
  metadata = {},
  req = null,
}) {
  try {
    const ip =
      (req?.headers?.['x-forwarded-for']?.split(',')[0] || '').trim() ||
      req?.socket?.remoteAddress ||
      null
    const userAgent = req?.headers?.['user-agent'] || null
    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('audit_log').insert({
      user_id: userId,
      action,
      target_type: targetType,
      target_id: targetId,
      metadata,
      ip,
      user_agent: userAgent,
    })
    if (error) console.error('[audit] insert failed:', error.message)
  } catch (err) {
    console.error('[audit] exception:', err.message)
  }
}

// ── Email (Resend) ─────────────────────────────────────────────
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

// ── Admin allow-list guard ────────────────────────────────────
// Optional belt-and-braces check: ADMIN_EMAILS="a@b.com,c@d.com" in
// env lets you pin admin access to a specific mailbox in addition to
// the profiles.is_admin / role flag.
export function isAllowedAdminEmail(email) {
  const raw = process.env.ADMIN_EMAILS || ''
  if (!raw.trim()) return true // not configured → rely on DB flag only
  const list = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  return list.includes(String(email || '').toLowerCase())
}
