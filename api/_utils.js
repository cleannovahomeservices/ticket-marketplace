import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

// ── Stripe ────────────────────────────────────────────────────
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
})

// ── Supabase admin (service role) ─────────────────────────────
export function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )
}

// ── CORS headers ───────────────────────────────────────────────
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// ── Verify Supabase JWT and return user ───────────────────────
export async function getAuthUser(req) {
  const auth = req.headers['authorization'] || ''
  const token = auth.replace('Bearer ', '').trim()
  if (!token) return null
  const supabase = getSupabaseAdmin()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  return user
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
